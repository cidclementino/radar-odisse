// Radar Odisse — Cloudflare Worker
//
// Bindings esperados (configurar em wrangler.toml / painel Cloudflare):
//   - KV Namespace `CONCURSOS`       -> id -> Concurso (JSON)
//   - KV Namespace `REVISAO`         -> id -> { candidato_existente, candidato_novo, motivo, criado_em }
//   - KV Namespace `OPORTUNIDADES`   -> id -> Oportunidade (JSON) — aba Terrenos
//   - KV Namespace `CORRETORES`      -> id -> Corretor (JSON) — aba Terrenos
//   - Variável de ambiente `COLLECT_SECRET` -> string compartilhada com o GitHub Actions
//
// Rotas:
//   GET    /api/concursos          -> lista todos os Concursos (usado pelo front-end estático)
//   GET    /api/revisao            -> lista pendências de revisão manual (página revisao.html)
//   POST   /api/revisao/resolver   -> resolve uma pendência: funde no existente ou cria como concurso próprio
//   POST   /api/concursos/fundir   -> funde dois concursos já cadastrados (seleção manual na página)
//   GET    /api/concursos/:id/site?url=  -> devolve o HTML do site oficial do concurso (só do mesmo domínio)
//   POST   /api/manutencao/reparar -> conserta datas a partir de texto_bruto (Authorization: Bearer <secret>)
//   POST   /api/manutencao/completar -> preenche campos vazios e o acompanhamento de uma leva (idem)
//   POST   /api/collect            -> recebe candidatos brutos de um parser de Concurso (Authorization: Bearer <secret>)
//   PATCH  /api/concursos/:id      -> atualiza status_interno e/ou apelido de um Concurso (ex: descartar/restaurar, renomear exibição)
//   DELETE /api/concursos/:id      -> apaga um Concurso e deixa uma lápide (`_ignorado:<id>`) para a coleta não trazê-lo de volta
//   GET    /api/oportunidades      -> lista todas as Oportunidades (Terrenos)
//   GET    /api/corretores         -> lista todos os Corretores (Terrenos)
//   POST   /api/collect-terrenos   -> recebe { oportunidades, corretoresCandidatos } de um parser de Terrenos
//
// NOTA DE SEGURANÇA: as rotas PATCH/DELETE de Concursos não exigem
// autenticação, assim como o resto do painel (não há login hoje — ver
// README, seção "Próxima rodada"). Qualquer pessoa com a URL do painel
// pode descartar ou apagar itens. Isso é uma decisão consciente pra manter
// o painel simples enquanto for uso interno de poucas pessoas; se isso
// mudar, vale revisitar (ex: Cloudflare Access na frente do Worker, ou um
// segredo próprio de UI — nunca reaproveitar o COLLECT_SECRET aqui, pois
// ele ficaria exposto no JS público do front-end).

import { classificarConcursos, fundir } from './dedup.js';
import { repararDatas, dataValida } from './datas.js';
import { processarCandidatosCorretor } from './dedup-terrenos.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 'acompanhando' = monitoramento específico: o site oficial é lido e o concurso vai para a página Acompanhamento
const STATUS_VALIDOS = new Set(['monitorando', 'acompanhando', 'inscrito', 'descartado']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// FIX (performance): a versão anterior fazia `await kv.get()` um de cada vez,
// dentro do for — com N chaves no KV, isso soma N idas-e-voltas sequenciais
// (e cresce a cada nova captura). Buscar em paralelo por página faz o tempo
// total ficar próximo do tempo da leitura mais lenta, não da soma de todas.
// Lápides de concursos apagados ficam no mesmo KV, com este prefixo; listAll() as deixa de fora.
const PREFIXO_IGNORADO = '_ignorado:';

async function listAll(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ cursor, prefix });
    const chaves = prefix ? page.keys : page.keys.filter(k => !k.name.startsWith(PREFIXO_IGNORADO));
    const valores = await Promise.all(chaves.map(key => kv.get(key.name, 'json')));
    out.push(...valores.filter(Boolean));
    cursor = page.cursor;
  } while (cursor);
  return out;
}

async function handleCollect(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${env.COLLECT_SECRET}`) {
    return json({ error: 'não autorizado' }, 401);
  }

  const candidatos = await request.json();
  if (!Array.isArray(candidatos)) {
    return json({ error: 'payload deve ser um array de Concursos' }, 400);
  }

  const [ativos, ignorados] = await Promise.all([
    listAll(env.CONCURSOS),
    listAll(env.CONCURSOS, PREFIXO_IGNORADO),
  ]);

  // Concursos apagados entram na comparação como se ainda existissem: assim um candidato que é o
  // mesmo concurso (mesmo id, um id já fundido nele ou outra fonte com nome/datas que batem) é
  // reconhecido. Só que, em vez de ser gravado, ele é descartado em silêncio.
  const idsIgnorados = new Set(ignorados.flatMap(c => [c.id, ...(c.ids_fundidos || [])]));
  const deFora = candidatos.filter(c => idsIgnorados.has(c.id));
  const resultado = classificarConcursos([...ativos, ...ignorados], candidatos.filter(c => !idsIgnorados.has(c.id)));
  const ehIgnorado = id => idsIgnorados.has(id);
  const antes = resultado.fundidos.length + resultado.pendentes_revisao.length;
  resultado.fundidos = resultado.fundidos.filter(c => !ehIgnorado(c.id));
  resultado.pendentes_revisao = resultado.pendentes_revisao.filter(p => !ehIgnorado(p.candidato_existente.id));
  const barrados = deFora.length + antes - resultado.fundidos.length - resultado.pendentes_revisao.length;

  // Aplica fusões automáticas
  for (const item of resultado.fundidos) {
    await env.CONCURSOS.put(item.id, JSON.stringify(item));
  }

  // Novos concursos (sem correspondência) entram direto — `apelido` começa
  // igual ao `nome` capturado (ver RADAR.md, seção "Apelido de exibição");
  // só é definido aqui, na criação, porque fundir() nunca deve mexer nele
  // depois (é editável pelo usuário e não pode ser sobrescrito por uma
  // recaptura, mesmo que o `nome` de origem mude).
  for (const item of resultado.novos) {
    const comApelido = { ...item, apelido: item.apelido || item.nome };
    await env.CONCURSOS.put(comApelido.id, JSON.stringify(comApelido));
  }

  // Conflitos vão pra fila de revisão manual, não sobrescrevem nada ainda
  for (const pendencia of resultado.pendentes_revisao) {
    const chave = `${pendencia.candidato_existente.id}__${pendencia.candidato_novo.id}`;
    await env.REVISAO.put(chave, JSON.stringify({ ...pendencia, criado_em: new Date().toISOString() }));
  }

  return json({
    fundidos: resultado.fundidos.length,
    novos: resultado.novos.length,
    pendentes_revisao: resultado.pendentes_revisao.length,
    ignorados_por_terem_sido_apagados: barrados,
  });
}

/**
 * PATCH /api/concursos/:id — atualiza status_interno e/ou apelido de um
 * Concurso. Aceita os dois campos de forma independente (pode mandar só um
 * dos dois) — usado pelos botões "Descartar"/"Restaurar" (status_interno) e
 * pelo campo de edição de apelido no painel de detalhe (ver js/app.js).
 * Não apaga nada do KV — só muda os campos enviados.
 */
async function handlePatchConcurso(request, env, id) {
  const existente = await env.CONCURSOS.get(id, 'json');
  if (!existente) {
    return json({ error: 'concurso não encontrado' }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'corpo inválido — esperado JSON' }, 400);
  }
  body = body || {};

  if (!('status_interno' in body) && !('apelido' in body) && !('acompanhamento' in body) && !('completar' in body)) {
    return json({ error: 'nada pra atualizar — envie status_interno, apelido, acompanhamento ou completar' }, 400);
  }

  const atualizado = { ...existente, atualizado_em: new Date().toISOString() };

  if ('status_interno' in body) {
    if (!STATUS_VALIDOS.has(body.status_interno)) {
      return json({ error: `status_interno inválido — use um de: ${[...STATUS_VALIDOS].join(', ')}` }, 400);
    }
    atualizado.status_interno = body.status_interno;
  }

  if ('apelido' in body) {
    const apelido = typeof body.apelido === 'string' ? body.apelido.trim() : '';
    if (!apelido) {
      return json({ error: 'apelido não pode ser vazio — envie o nome original se quiser resetar' }, 400);
    }
    atualizado.apelido = apelido;
  }

  if ('acompanhamento' in body) {
    const erro = validarAcompanhamento(body.acompanhamento);
    if (erro) return json({ error: erro }, 400);
    atualizado.acompanhamento = body.acompanhamento;
  }

  if ('completar' in body) aplicarCompletar(atualizado, body.completar);

  await env.CONCURSOS.put(id, JSON.stringify(atualizado));

  return json(atualizado);
}

// ---------------------------------------------------------------- site oficial e completar

// O que veio da leitura do site oficial (js/extrair-site.js) fica em `acompanhamento.site`.
// Limite de tamanho para ninguém encher o KV por esta rota aberta.
function validarAcompanhamento(a) {
  if (a === null) return null;
  if (typeof a !== 'object' || Array.isArray(a)) return 'acompanhamento deve ser um objeto';
  if (JSON.stringify(a).length > 60000) return 'acompanhamento grande demais';
  return null;
}

// Preenche só o que está vazio — nunca troca um valor que já existe.
function aplicarCompletar(alvo, campos) {
  if (!campos || typeof campos !== 'object') return alvo;
  const vazio = v => v === null || v === undefined || v === '';
  const texto = v => (typeof v === 'string' && v.trim() && v.length < 2000 ? v.trim() : null);
  if (vazio(alvo.imagem_url) && texto(campos.imagem_url) && /^https?:\/\//.test(campos.imagem_url)) alvo.imagem_url = campos.imagem_url.trim();
  for (const k of ['local_projeto', 'promotor', 'premio', 'descricao']) {
    if (vazio(alvo[k]) && texto(campos[k])) alvo[k] = texto(campos[k]);
  }
  alvo.datas = { ...(alvo.datas || {}) };
  for (const k of ['inscricao_fim', 'entrega_fim', 'resultado_previsto']) {
    if (!dataValida(alvo.datas[k]) && dataValida(campos[k])) alvo.datas[k] = campos[k];
  }
  return alvo;
}

/**
 * GET /api/concursos/:id/site?url= — busca uma página do site oficial e devolve o HTML, para a
 * página de Acompanhamento ler (o navegador não pode buscar sites de outros domínios direto).
 * Só aceita endereços do mesmo domínio do link oficial (ou da publicação na fonte) do concurso,
 * para não virar um proxy aberto. O HTML passa direto, sem ser processado aqui (o plano gratuito
 * da Cloudflare dá só 10 ms de processamento por pedido).
 */
async function handleSiteOficial(env, id, alvo) {
  const c = await env.CONCURSOS.get(id, 'json');
  if (!c) return json({ error: 'concurso não encontrado' }, 404);
  const base = c.link_oficial || c.fonte_url_original;
  if (!base) return json({ error: 'concurso sem link oficial' }, 422);
  let destino;
  try {
    destino = new URL(alvo || base);
    const host = h => h.replace(/^www\./, '').toLowerCase();
    if (!/^https?:$/.test(destino.protocol) || host(destino.hostname) !== host(new URL(base).hostname)) {
      return json({ error: 'endereço fora do site oficial do concurso' }, 400);
    }
  } catch {
    return json({ error: 'endereço inválido' }, 400);
  }
  let res;
  try {
    res = await fetch(destino.href, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en,pt-BR;q=0.8',
      },
    });
  } catch (err) {
    return json({ error: `não foi possível abrir o site: ${err.message}` }, 502);
  }
  const tipo = res.headers.get('content-type') || '';
  if (!/html|xml|text\/plain/i.test(tipo)) return json({ error: `o site respondeu com ${tipo || 'conteúdo desconhecido'}, não uma página` }, 415);
  return new Response(res.body, {
    status: res.ok ? 200 : 502,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Site-Status': String(res.status),
      'X-Site-Url': res.url,
      'Access-Control-Expose-Headers': 'X-Site-Status, X-Site-Url',
      ...CORS_HEADERS,
    },
  });
}

function autorizado(request, env) {
  return (request.headers.get('Authorization') || '') === `Bearer ${env.COLLECT_SECRET}`;
}

/** POST /api/manutencao/reparar — conserta as datas de todos os concursos a partir de texto_bruto. */
async function handleReparar(request, env) {
  if (!autorizado(request, env)) return json({ error: 'não autorizado' }, 401);
  const todos = await listAll(env.CONCURSOS);
  const consertados = [];
  for (const c of todos) {
    const novo = repararDatas(c);
    if (novo) {
      await env.CONCURSOS.put(novo.id, JSON.stringify({ ...novo, atualizado_em: new Date().toISOString() }));
      consertados.push(novo.id);
    }
  }
  return json({ concursos: todos.length, consertados: consertados.length });
}

/**
 * POST /api/manutencao/completar — recebe { itens: [{ id, campos?, acompanhamento? }] } da coleta
 * (scripts/completar-concursos.js, que lê os sites oficiais). Preenche só campos vazios; o
 * acompanhamento é substituído. Marca `completado_em` para a coleta não tentar de novo toda semana.
 */
async function handleCompletar(request, env) {
  if (!autorizado(request, env)) return json({ error: 'não autorizado' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'corpo inválido' }, 400); }
  const itens = Array.isArray(body?.itens) ? body.itens.slice(0, 40) : [];
  let gravados = 0;
  for (const item of itens) {
    const c = item?.id && await env.CONCURSOS.get(item.id, 'json');
    if (!c) continue;
    const atualizado = aplicarCompletar({ ...c }, item.campos);
    if (item.acompanhamento !== undefined && !validarAcompanhamento(item.acompanhamento)) atualizado.acompanhamento = item.acompanhamento;
    atualizado.completado_em = new Date().toISOString();
    await env.CONCURSOS.put(c.id, JSON.stringify(atualizado));
    gravados++;
  }
  return json({ recebidos: itens.length, gravados });
}

/**
 * DELETE /api/concursos/:id — tira o Concurso do Radar de vez.
 * Antes de apagar, grava uma lápide (`_ignorado:<id>`, com o registro completo e `excluido_em`):
 * sem ela, a coleta seguinte achava o concurso de novo na fonte e o recriava como novo.
 * A coleta compara os candidatos com as lápides e descarta o que bater (ver handleCollect).
 */
async function handleDeleteConcurso(env, id) {
  const existente = await env.CONCURSOS.get(id, 'json');
  if (!existente) {
    return json({ error: 'concurso não encontrado' }, 404);
  }
  await env.CONCURSOS.put(PREFIXO_IGNORADO + id, JSON.stringify({ ...existente, excluido_em: new Date().toISOString() }));
  await env.CONCURSOS.delete(id);
  return json({ deletado: true, id });
}

// Campos que a revisão pode trocar pelo valor do concurso novo (os mesmos 5 da comparação).
const CAMPOS_REVISAO = {
  nome: (alvo, novo) => { alvo.nome = novo.nome; },
  local_projeto: (alvo, novo) => { alvo.local_projeto = novo.local_projeto; },
  inscricao_fim: (alvo, novo) => { alvo.datas = { ...alvo.datas, inscricao_fim: novo.datas?.inscricao_fim ?? null }; },
  entrega_fim: (alvo, novo) => { alvo.datas = { ...alvo.datas, entrega_fim: novo.datas?.entrega_fim ?? null }; },
  link_oficial: (alvo, novo) => { alvo.link_oficial = novo.link_oficial; },
};

/**
 * POST /api/revisao/resolver — decide uma pendência da fila de revisão.
 *
 * Corpo: { existente_id, novo_id, acao, usar_novo? }
 *   acao 'fundir'    -> é o mesmo concurso: o novo entra no existente (fundir() preenche o que
 *                       falta; `usar_novo` lista os campos em conflito em que o valor novo vence).
 *                       O id do novo vai para `ids_fundidos`, para a próxima coleta reconhecê-lo
 *                       direto (nível 1 do dedup) em vez de recriar a pendência.
 *   acao 'separar'   -> são concursos diferentes: o novo entra como concurso próprio.
 *   acao 'arquivar'  -> diferente, mas sem interesse: entra já arquivado (some da lista ativa e
 *                       não volta para a fila nas próximas coletas).
 * Em todos os casos a pendência sai da fila, junto com outras pendências do mesmo concurso novo.
 * Sem autenticação, como PATCH/DELETE (ver nota de segurança no topo).
 */
async function handleResolverPendencia(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'corpo inválido — esperado JSON' }, 400); }
  const { existente_id, novo_id, acao, usar_novo = [] } = body || {};
  if (!existente_id || !novo_id || !['fundir', 'separar', 'arquivar'].includes(acao)) {
    return json({ error: 'envie existente_id, novo_id e acao (fundir | separar | arquivar)' }, 400);
  }

  const chave = `${existente_id}__${novo_id}`;
  const pendencia = await env.REVISAO.get(chave, 'json');
  if (!pendencia) return json({ error: 'pendência não encontrada (já resolvida?)' }, 404);
  const novo = pendencia.candidato_novo;
  const agora = new Date().toISOString();
  let resultado;

  if (acao === 'fundir') {
    // usa a versão atual do existente (pode ter mudado desde que a pendência foi criada)
    const existente = await env.CONCURSOS.get(existente_id, 'json');
    if (!existente) return json({ error: 'o concurso existente não está mais no Radar — use "separar"' }, 409);
    const fundido = fundir(existente, novo);
    for (const campo of usar_novo) CAMPOS_REVISAO[campo]?.(fundido, novo);
    fundido.ids_fundidos = [...new Set([...(existente.ids_fundidos || []), novo.id])];
    fundido.atualizado_em = agora;
    await env.CONCURSOS.put(fundido.id, JSON.stringify(fundido));
    resultado = fundido;
  } else {
    const jaExiste = await env.CONCURSOS.get(novo.id, 'json');
    const item = jaExiste || {
      ...novo,
      apelido: novo.apelido || novo.nome,
      status_interno: acao === 'arquivar' ? 'descartado' : (novo.status_interno || 'monitorando'),
      coletado_em: novo.coletado_em || agora,
    };
    if (jaExiste && acao === 'arquivar') item.status_interno = 'descartado';
    item.atualizado_em = agora;
    await env.CONCURSOS.put(item.id, JSON.stringify(item));
    resultado = item;
  }

  // tira da fila esta e qualquer outra pendência do mesmo concurso novo
  const removidas = [];
  let cursor;
  do {
    const page = await env.REVISAO.list({ cursor });
    for (const k of page.keys) {
      if (k.name === chave || k.name.endsWith(`__${novo_id}`)) {
        await env.REVISAO.delete(k.name);
        removidas.push(k.name);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return json({ ok: true, acao, concurso: resultado, pendencias_removidas: removidas.length });
}

// Campos que a fusão manual pode tirar do concurso absorvido (escolha feita no popup da página).
const CAMPOS_FUSAO_MANUAL = {
  apelido: (a, b) => { a.apelido = b.apelido || b.nome; },
  nome: (a, b) => { a.nome = b.nome; },
  imagem_url: (a, b) => { a.imagem_url = b.imagem_url; },
  local_projeto: (a, b) => { a.local_projeto = b.local_projeto; },
  promotor: (a, b) => { a.promotor = b.promotor; },
  destinado_a: (a, b) => { a.destinado_a = b.destinado_a; },
  premio: (a, b) => { a.premio = b.premio; },
  link_oficial: (a, b) => { a.link_oficial = b.link_oficial; },
  tipo: (a, b) => { a.tipo = b.tipo; },
  escopo: (a, b) => { a.escopo = b.escopo; },
  inscricao: (a, b) => { a.inscricao = b.inscricao; },
  inscricao_fim: (a, b) => { a.datas = { ...a.datas, inscricao_fim: b.datas?.inscricao_fim ?? null }; },
  entrega_fim: (a, b) => { a.datas = { ...a.datas, entrega_fim: b.datas?.entrega_fim ?? null }; },
};

/**
 * POST /api/concursos/fundir — junta dois concursos que já estão no Radar (duplicado que passou
 * pela coleta). Corpo: { manter_id, absorver_id, usar_absorvido: [campos] }.
 * O `manter` fica com o id; fundir() completa o que falta nele com o `absorver` e soma as fontes;
 * os campos listados em `usar_absorvido` passam a ter o valor do absorvido. O id do absorvido vai
 * para `ids_fundidos` (a próxima coleta o reconhece) e ele é apagado. Pendências de revisão que
 * apontavam para o absorvido saem da fila — na coleta seguinte, se ainda fizer sentido, voltam
 * comparadas com o concurso fundido.
 */
async function handleFundirConcursos(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'corpo inválido — esperado JSON' }, 400); }
  const { manter_id, absorver_id, usar_absorvido = [] } = body || {};
  if (!manter_id || !absorver_id || manter_id === absorver_id) {
    return json({ error: 'envie manter_id e absorver_id (diferentes)' }, 400);
  }
  const [manter, absorver] = await Promise.all([
    env.CONCURSOS.get(manter_id, 'json'),
    env.CONCURSOS.get(absorver_id, 'json'),
  ]);
  if (!manter || !absorver) return json({ error: 'um dos concursos não está mais no Radar' }, 404);

  const fundido = fundir(manter, absorver);
  for (const campo of usar_absorvido) CAMPOS_FUSAO_MANUAL[campo]?.(fundido, absorver);
  fundido.fontes = [...new Set([...(manter.fontes || [manter.fonte]), ...(absorver.fontes || [absorver.fonte])].filter(Boolean))];
  fundido.ids_fundidos = [...new Set([...(manter.ids_fundidos || []), absorver.id, ...(absorver.ids_fundidos || [])])];
  // A situação mais avançada dos dois vence (inscrito > acompanhando > monitorando > arquivado):
  // antes ficava sempre a do `manter`, e um concurso em acompanhamento saía dele ao ser fundido.
  // A leitura do site oficial (`acompanhamento`) vem junto de quem tiver.
  const ORDEM_SITUACAO = ['descartado', 'monitorando', 'acompanhando', 'inscrito'];
  const peso = c => ORDEM_SITUACAO.indexOf(c.status_interno || 'monitorando');
  if (peso(absorver) > peso(manter)) fundido.status_interno = absorver.status_interno;
  if (!fundido.acompanhamento?.lido_em && absorver.acompanhamento?.lido_em) fundido.acompanhamento = absorver.acompanhamento;
  else if (!fundido.acompanhamento && absorver.acompanhamento) fundido.acompanhamento = absorver.acompanhamento;
  // fica a primeira captura, para a etiqueta "Novo" não reaparecer
  const coletas = [manter.coletado_em, absorver.coletado_em].filter(Boolean).sort();
  if (coletas.length) fundido.coletado_em = coletas[0];
  fundido.atualizado_em = new Date().toISOString();

  await env.CONCURSOS.put(fundido.id, JSON.stringify(fundido));
  await env.CONCURSOS.delete(absorver.id);

  let removidas = 0;
  let cursor;
  do {
    const page = await env.REVISAO.list({ prefix: `${absorver.id}__`, cursor });
    for (const k of page.keys) { await env.REVISAO.delete(k.name); removidas++; }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return json({ ok: true, concurso: fundido, removido_id: absorver.id, pendencias_removidas: removidas });
}

async function handleCollectTerrenos(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${env.COLLECT_SECRET}`) {
    return json({ error: 'não autorizado' }, 401);
  }

  const payload = await request.json();
  const { oportunidades = [], corretoresCandidatos = [] } = payload || {};

  // 1. Processa candidatos a Corretor primeiro — oportunidades de persona
  // "corretor" (ex: YouTube) e o enriquecimento do ZAP dependem dos ids
  // resultantes pra preencher corretor_vinculado_id.
  const corretoresExistentes = await listAll(env.CORRETORES);
  const corretoresAtualizados = processarCandidatosCorretor(corretoresExistentes, corretoresCandidatos);

  for (const corretor of corretoresAtualizados.values()) {
    await env.CORRETORES.put(corretor.id, JSON.stringify(corretor));
  }

  // 2. Grava as Oportunidades (sem dedup entre fontes por ora — cada fonte
  // gera seu próprio id; ver TERRENOS.md, não havia decisão de dedup entre
  // fontes de terrenista igual à de Concurso).
  for (const op of oportunidades) {
    await env.OPORTUNIDADES.put(op.id, JSON.stringify(op));
  }

  return json({
    oportunidades_gravadas: oportunidades.length,
    corretores_atualizados: corretoresAtualizados.size,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === 'GET' && url.pathname === '/api/concursos') {
      return json(await listAll(env.CONCURSOS));
    }

    if (request.method === 'GET' && url.pathname === '/api/revisao') {
      return json(await listAll(env.REVISAO));
    }

    if (request.method === 'POST' && url.pathname === '/api/concursos/fundir') {
      return handleFundirConcursos(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/revisao/resolver') {
      return handleResolverPendencia(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/collect') {
      return handleCollect(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/manutencao/reparar') {
      return handleReparar(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/manutencao/completar') {
      return handleCompletar(request, env);
    }

    const matchSite = url.pathname.match(/^\/api\/concursos\/([^/]+)\/site$/);
    if (request.method === 'GET' && matchSite) {
      return handleSiteOficial(env, decodeURIComponent(matchSite[1]), url.searchParams.get('url'));
    }

    // Rotas /api/concursos/:id — checadas antes do GET genérico de cima
    // porque o pathname aqui tem um segmento a mais.
    const matchConcursoId = url.pathname.match(/^\/api\/concursos\/([^/]+)$/);
    if (matchConcursoId) {
      const id = decodeURIComponent(matchConcursoId[1]);
      if (request.method === 'PATCH') {
        return handlePatchConcurso(request, env, id);
      }
      if (request.method === 'DELETE') {
        return handleDeleteConcurso(env, id);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/oportunidades') {
      return json(await listAll(env.OPORTUNIDADES));
    }

    if (request.method === 'GET' && url.pathname === '/api/corretores') {
      return json(await listAll(env.CORRETORES));
    }

    if (request.method === 'POST' && url.pathname === '/api/collect-terrenos') {
      return handleCollectTerrenos(request, env);
    }

    return json({ error: 'não encontrado' }, 404);
  },
};
