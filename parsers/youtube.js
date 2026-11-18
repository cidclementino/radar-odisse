// Parser: YouTube Data API v3 (descoberta de Corretor)
//
// Requer a variável de ambiente YOUTUBE_API_KEY (GitHub Secret) — ver
// TERRENOS.md, seção "Pendências". Sem a chave, o parser falha graciosamente
// (retorna vazio e loga o motivo), sem derrubar a coleta das outras fontes.
//
// Rotação por dia da semana (ver TERRENOS.md): em execução automática (cron),
// cada grupo roda 1x/semana, no dia correspondente — isola falha de uma
// Action a um grupo só. Em disparo MANUAL (workflow_dispatch), a rotação é
// ignorada e todas as cidades/grupos são buscados na mesma rodada — é uma
// checagem pontual, não precisa esperar a semana inteira pra validar tudo.
//
// Dois níveis de sinal (ver TERRENOS.md, "corretor via YouTube"):
//   - Nível 2 (sinal qualificado): título/descrição menciona "terreno" +
//     um termo de permuta/parceria explícito. Maior precisão, menor volume.
//   - Nível 1 (observação): título/descrição menciona "terreno", sem termo
//     de permuta, mas o canal é claramente de um corretor/imobiliária
//     (nome do canal bate com padrão do setor). Menor precisão — o corretor
//     pode não estar aberto a permuta, mas é candidato legítimo de contato.
//   - Nem um nem outro: descartado (ruído — "terreno" sem contexto de
//     corretor nem de permuta é ruído demais pra entrar como candidato).

const { generateId, normalizeText } = require('./lib/normalize');
const { extrairContatos } = require('./lib/contatos');

const FONTE = 'youtube.com';
const API_KEY = process.env.YOUTUBE_API_KEY;

// Disparo manual pela aba Actions ("Run workflow") vem com este evento.
// Em cron automático o evento é 'schedule'.
const EXECUCAO_MANUAL = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';

// 0 = domingo ... 6 = sábado (Date#getDay())
//
// Queries deliberadamente amplas — só "terreno" + cidade/região. Testado
// e confirmado: incluir "corretor"/"permuta" na própria busca (em vez de
// só no filtro pós-busca) faz a API do YouTube não retornar nada, mesmo
// havendo vídeos relevantes no ar (ex: "terreno Recife" sozinho trouxe 9
// itens recentes; "corretor terreno permuta Recife" trouxe 0). A busca
// larga + classificarNivel() depois é o que dá precisão, não a query.
//
// Geografia revisada: Cabedelo é oficialmente parte da Região Metropolitana
// de João Pessoa (não "litoral norte" separado) — movido pro grupo de
// segunda. Conde e Jacumã são litoral SUL de João Pessoa (litoral norte de
// verdade seria Lucena/Rio Tinto/Baía da Traição) — grupo renomeado e
// completado com Pitimbu, mesma faixa. RM Recife, Campina Grande e RM
// Natal ganharam os municípios satélite com mais atividade imobiliária.
const ROTACAO = {
  1: { grupo: 'RM João Pessoa', queries: ['terreno João Pessoa', 'terreno Santa Rita PB', 'terreno Bayeux', 'terreno Cabedelo'],
    retrofit: ['prédio à venda João Pessoa', 'galpão à venda João Pessoa', 'imóvel comercial à venda João Pessoa', 'casarão Centro Histórico João Pessoa'] },
  2: { grupo: 'Litoral Sul PB', queries: ['terreno Conde PB', 'terreno Jacumã', 'terreno Pitimbu'], retrofit: [] },
  3: { grupo: 'Campina Grande', queries: ['terreno Campina Grande', 'terreno Queimadas PB', 'terreno Lagoa Seca PB'],
    retrofit: ['prédio à venda Campina Grande', 'galpão à venda Campina Grande'] },
  4: { grupo: 'RM Recife', queries: ['terreno Recife', 'terreno Olinda', 'terreno Jaboatão dos Guararapes', 'terreno Paulista PE', 'terreno Camaragibe', 'terreno Cabo de Santo Agostinho'],
    retrofit: ['prédio à venda Recife', 'galpão à venda Recife', 'casarão à venda Olinda'] },
  5: { grupo: 'RM Natal', queries: ['terreno Natal RN', 'terreno Parnamirim RN', 'terreno São Gonçalo do Amarante RN', 'terreno Macaíba RN'],
    retrofit: ['prédio à venda Natal RN', 'galpão à venda Natal RN'] },
};

// Imóveis para retrofit (nov/2026): prédio inteiro, galpão, casarão, imóvel comercial à venda — o
// comprador vai precisar de projeto de reforma. Mesma mecânica dos terrenos (corretor como
// contato), com `categoria: 'imovel'` na oportunidade. Ver TERRENOS.md, "Imóveis para retrofit".

/** Tipo de imóvel que costuma pedir projeto de reforma (texto normalizado, sem acento). */
const RE_IMOVEL_RETROFIT = /(predio inteiro|predio comercial|predio a venda|predio para venda|vendo predio|edificio inteiro|edificio comercial|galpao|casarao|imovel comercial|ponto comercial|sobrado comercial|imovel antigo|casa antiga|imovel historico|pousada a venda|hotel a venda)/;
/** Sinal de que o imóvel vai mudar de uso ou ser reformado: sobe para nível 2. */
const RE_SINAL_RETROFIT = /(retrofit|para reforma|precisa de reforma|a reformar|reformar|mudanca de uso|potencial construtivo|ideal para (clinica|escola|hotel|pousada|escritorio|loja|restaurante|investidor)|oportunidade de investimento|aceita permuta|permuta)/;
/** Lançamentos e apartamentos: ruído na busca de "prédio". */
const RE_RUIDO_RETROFIT = /(apartamento|lancamento|na planta|decorado|cobertura duplex)/;

/** Termos que indicam disposição explícita de permuta/parceria no anúncio. */
const RE_PERMUTA = /(permuta|parceria|incorpora|sociedade)/;

/** Nome do canal batendo com padrão de corretor/imobiliária. */
const RE_CANAL_IMOBILIARIO = /(imob|imóve|imove|corretor|realty|construtora|incorporadora)/i;

/** Descrição do canal de quem se apresenta como corretor/imobiliária. */
const RE_DESCRICAO_CORRETOR = /(creci|corretor|corretora|imobili[aá]ri|consultor imobili|negócios imobili|negocios imobili)/i;

const API = 'https://www.googleapis.com/youtube/v3';

/** Data ISO de N dias atrás — usado como publishedAfter (só vídeos novos desde a última coleta). */
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Monta a lista de grupos a buscar nesta execução: todos (manual) ou só o do dia (cron). */
function gruposDaExecucao() {
  if (EXECUCAO_MANUAL) {
    return Object.values(ROTACAO);
  }
  const diaSemana = new Date().getDay();
  const grupoHoje = ROTACAO[diaSemana];
  return grupoHoje ? [grupoHoje] : [];
}

async function buscarQuery(query, publishedAfter) {
  // IMPORTANTE: não usar order=date aqui. Comportamento observado e
  // confirmado em teste manual: combinar order=date com publishedAfter faz
  // a API devolver items: [] mesmo com totalResults > 0 — inconsistência
  // conhecida da própria API, não um erro de query/chave/cota. A ordenação
  // por data é feita abaixo, no próprio código, depois da resposta.
  const params = new URLSearchParams({
    key: API_KEY,
    q: query,
    part: 'snippet',
    type: 'video',
    regionCode: 'BR',
    relevanceLanguage: 'pt',
    publishedAfter,
    maxResults: '25',
  });

  const res = await fetch(`${API}/search?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API retornou ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const items = data.items || [];

  // Mais recente primeiro — substitui o order=date que tirávamos da API.
  items.sort((a, b) => new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt));

  return items;
}

/**
 * Lê em lote (até 50 ids por chamada, 1 unidade de cota cada) os vídeos ou canais pedidos.
 * Devolve um Map id -> item. Falha de uma chamada não derruba a coleta: os itens dela ficam de fora
 * e o vídeo segue com o resumo que veio da busca.
 */
async function lerEmLote(recurso, ids, part) {
  const porId = new Map();
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 50) {
    const lote = unicos.slice(i, i + 50);
    const params = new URLSearchParams({ key: API_KEY, part, id: lote.join(','), maxResults: '50' });
    try {
      const res = await fetch(`${API}/${recurso}?${params}`);
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      for (const item of data.items || []) porId.set(item.id, item);
    } catch (err) {
      console.error(`[youtube.com] leitura de ${recurso} falhou:`, err.message);
    }
  }
  return porId;
}

/** Endereço público do canal: o @ quando existe, senão o id. */
function enderecoCanal(canalId, canal) {
  const handle = canal?.snippet?.customUrl;
  if (handle) return `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`;
  return canalId ? `https://www.youtube.com/channel/${canalId}` : null;
}

/**
 * Classifica o vídeo em um dos dois níveis de sinal, ou null se for ruído.
 * Usa a descrição completa do vídeo (videos.list) quando disponível — o resumo da busca
 * corta a descrição em ~160 caracteres e deixava de fora "permuta" escrito mais abaixo.
 *   - 2 (qualificado): "terreno" + termo explícito de permuta no título/descrição.
 *   - 1 (observação): "terreno" no título/descrição + canal reconhecido como
 *     corretor/imobiliária (pelo nome ou pela descrição do canal), mesmo sem termo de permuta.
 *   - null: não menciona "terreno", ou menciona mas o canal não é reconhecível
 *     como corretor/imobiliária — ruído demais pra virar candidato.
 */
function classificarNivel({ titulo, descricao, canalTitulo, canalDescricao }) {
  return classificar({ titulo, descricao, canalTitulo, canalDescricao })?.nivel ?? null;
}

/**
 * Nível e categoria do vídeo: terreno (regra acima) ou imóvel para retrofit.
 *   - imóvel, nível 2: tipo de imóvel + sinal de reforma, mudança de uso ou permuta;
 *   - imóvel, nível 1: tipo de imóvel + canal de corretor/imobiliária;
 *   - vídeo de apartamento ou lançamento (pelo título) não entra como imóvel.
 */
function classificar({ titulo, descricao, canalTitulo, canalDescricao }) {
  const texto = `${titulo} ${descricao}`.toLowerCase();
  const canalImobiliario = RE_CANAL_IMOBILIARIO.test(canalTitulo || '') || RE_DESCRICAO_CORRETOR.test(canalDescricao || '');
  if (/terreno/.test(texto)) {
    if (RE_PERMUTA.test(texto)) return { nivel: 2, categoria: 'terreno' };
    if (canalImobiliario) return { nivel: 1, categoria: 'terreno' };
    return null;
  }
  const t = normalizeText(`${titulo} ${descricao}`);
  if (!RE_IMOVEL_RETROFIT.test(t) || RE_RUIDO_RETROFIT.test(normalizeText(titulo))) return null;
  if (RE_SINAL_RETROFIT.test(t)) return { nivel: 2, categoria: 'imovel' };
  if (canalImobiliario) return { nivel: 1, categoria: 'imovel' };
  return null;
}

async function parse() {
  if (!API_KEY) {
    console.error('[youtube.com] YOUTUBE_API_KEY não configurada — pulando esta fonte.');
    return { oportunidades: [], corretoresCandidatos: [] };
  }

  const grupos = gruposDaExecucao();

  if (grupos.length === 0) {
    console.log('[youtube.com] Fim de semana — sem grupo de busca agendado.');
    return { oportunidades: [], corretoresCandidatos: [] };
  }

  if (EXECUCAO_MANUAL) {
    console.log(`[youtube.com] Disparo manual — buscando todos os ${grupos.length} grupos nesta rodada.`);
  }

  const publishedAfter = diasAtras(7);
  // Cota: cada busca custa 100 unidades; as leituras de vídeos e canais, 1 unidade por lote de 50.
  const oportunidades = [];
  const corretoresCandidatos = [];

  for (const grupo of grupos) {
    for (const query of [...grupo.queries, ...(grupo.retrofit || [])]) {
      try {
        const items = await buscarQuery(query, publishedAfter);

        // Descrição completa dos vídeos e descrição dos canais (2 chamadas de 1 unidade cada).
        const videos = await lerEmLote('videos', items.map(it => it.id.videoId), 'snippet');
        const canais = await lerEmLote('channels', items.map(it => it.snippet.channelId), 'snippet');

        const lidos = items.map(item => {
          const videoId = item.id.videoId;
          const canalId = item.snippet.channelId || null;
          const video = videos.get(videoId);
          const canal = canais.get(canalId);
          return {
            item, videoId, canalId, canal,
            titulo: item.snippet.title,
            descricao: video?.snippet?.description ?? item.snippet.description ?? '',
            canalTitulo: item.snippet.channelTitle,
            canalDescricao: canal?.snippet?.description || '',
          };
        });

        // Diagnóstico: mostra quantos itens a API devolveu e como cada um
        // foi classificado, antes de qualquer descarte. Ajuda a distinguir
        // "a API não retornou o vídeo" de "o filtro descartou o vídeo".
        const contagem = { 2: 0, 1: 0, descartado: 0 };
        for (const l of lidos) {
          const n = classificar(l)?.nivel ?? null;
          contagem[n === null ? 'descartado' : n]++;
        }
        console.log(
          `[youtube.com] "${query}": API retornou ${items.length} item(ns) — ` +
          `nível 2: ${contagem[2]}, nível 1: ${contagem[1]}, descartado: ${contagem.descartado} ` +
          `(descrições completas: ${videos.size} vídeos, ${canais.size} canais)`
        );

        for (const l of lidos) {
          const classe = classificar(l);
          if (!classe) continue;
          const { nivel, categoria } = classe;

          const { item, videoId, canalId, canal } = l;
          const link = `https://www.youtube.com/watch?v=${videoId}`;
          const id = generateId(FONTE, link, l.titulo);
          // Contatos: a descrição do canal (identidade do corretor) tem prioridade sobre a do vídeo.
          const contatos = extrairContatos(l.canalDescricao, l.descricao);

          oportunidades.push({
            id,
            persona: 'corretor',
            categoria,
            fonte: FONTE,
            titulo: l.titulo,
            local: grupo.grupo,
            nivel_maturidade: nivel,
            corretor_vinculado_id: null, // resolvido pelo worker na fusão
            link_original: link,
            imagem_url: (() => { const t = item.snippet.thumbnails || {}; return (t.high || t.medium || t.default)?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`; })(),
            texto_bruto: l.descricao.slice(0, 2000),
            publicado_em: item.snippet.publishedAt?.slice(0, 10) || null,
            coletado_em: new Date().toISOString(),
            status_interno: 'monitorando',
          });

          const fotos = canal?.snippet?.thumbnails || {};
          corretoresCandidatos.push({
            nome: l.canalTitulo,
            empresa: l.canalTitulo,
            creci: contatos.creci,
            regiao: grupo.grupo,
            fonte: FONTE,
            oportunidade_id: id,
            nivel,
            canal_id: canalId,
            canal_url: enderecoCanal(canalId, canal),
            foto_url: (fotos.medium || fotos.default)?.url || null,
            whatsapp: contatos.whatsapp,
            telefone: contatos.telefone,
            instagram: contatos.instagram,
            email: contatos.email,
          });
        }
      } catch (err) {
        console.error(`[youtube.com] falhou na query "${query}":`, err.message);
      }
    }
  }

  return { oportunidades, corretoresCandidatos };
}

module.exports = { parse, FONTE, classificar, classificarNivel };

if (require.main === module) {
  parse()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error('Erro ao coletar YouTube:', err.message); process.exit(1); });
}
