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
//   GET    /api/revisao            -> lista pendências de revisão manual (fase 2 da UI)
//   POST   /api/collect            -> recebe candidatos brutos de um parser de Concurso (Authorization: Bearer <secret>)
//   PATCH  /api/concursos/:id      -> atualiza status_interno e/ou apelido de um Concurso (ex: descartar/restaurar, renomear exibição)
//   DELETE /api/concursos/:id      -> apaga um Concurso definitivamente do KV
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

import { classificarConcursos } from './dedup.js';
import { processarCandidatosCorretor } from './dedup-terrenos.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const STATUS_VALIDOS = new Set(['monitorando', 'descartado', 'inscrito']);

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
async function listAll(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ cursor });
    const valores = await Promise.all(page.keys.map(key => kv.get(key.name, 'json')));
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

  const existentes = await listAll(env.CONCURSOS);
  const resultado = classificarConcursos(existentes, candidatos);

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

  if (!('status_interno' in body) && !('apelido' in body)) {
    return json({ error: 'nada pra atualizar — envie status_interno e/ou apelido' }, 400);
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

  await env.CONCURSOS.put(id, JSON.stringify(atualizado));

  return json(atualizado);
}

/**
 * DELETE /api/concursos/:id — apaga o Concurso definitivamente do KV.
 * Irreversível — o front-end pede confirmação antes de chamar essa rota.
 */
async function handleDeleteConcurso(env, id) {
  const existente = await env.CONCURSOS.get(id, 'json');
  if (!existente) {
    return json({ error: 'concurso não encontrado' }, 404);
  }
  await env.CONCURSOS.delete(id);
  return json({ deletado: true, id });
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

    if (request.method === 'POST' && url.pathname === '/api/collect') {
      return handleCollect(request, env);
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
