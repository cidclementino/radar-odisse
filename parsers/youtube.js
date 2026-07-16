// Parser: YouTube Data API v3 (descoberta de Corretor)
//
// Requer a variável de ambiente YOUTUBE_API_KEY (GitHub Secret) — ver
// TERRENOS.md, seção "Pendências", item de criar a chave no Google Cloud
// Console. Sem a chave, o parser falha graciosamente (retorna vazio e loga
// o motivo), sem derrubar a coleta das outras fontes.
//
// Rotação por dia da semana (ver TERRENOS.md): cada grupo roda 1x/semana,
// no dia correspondente. Isola falha de uma Action a um grupo só.

const { generateId } = require('./lib/normalize');

const FONTE = 'youtube.com';
const API_KEY = process.env.YOUTUBE_API_KEY;

// 0 = domingo ... 6 = sábado (Date#getDay())
const ROTACAO = {
  1: { grupo: 'RM João Pessoa', queries: ['corretor terreno permuta João Pessoa', 'terreno permuta Santa Rita PB', 'terreno permuta Bayeux'] },
  2: { grupo: 'Litoral Norte', queries: ['corretor terreno permuta Cabedelo', 'terreno permuta Conde PB', 'terreno permuta Jacumã'] },
  3: { grupo: 'Campina Grande', queries: ['corretor terreno permuta Campina Grande'] },
  4: { grupo: 'Recife', queries: ['corretor terreno permuta Recife'] },
  5: { grupo: 'Natal', queries: ['corretor terreno permuta Natal RN'] },
};

/** Data ISO de N dias atrás — usado como publishedAfter (só vídeos novos desde a última coleta). */
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function buscarQuery(query, publishedAfter) {
  const params = new URLSearchParams({
    key: API_KEY,
    q: query,
    part: 'snippet',
    type: 'video',
    order: 'date',
    regionCode: 'BR',
    relevanceLanguage: 'pt',
    publishedAfter,
    maxResults: '25',
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API retornou ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.items || [];
}

/**
 * Filtro de keyword pós-busca — a busca do YouTube é semântica, não literal,
 * então confirma que o título/descrição realmente menciona terreno + permuta
 * antes de aceitar o vídeo como sinal.
 */
function pareceRelevante(item) {
  const texto = `${item.snippet.title} ${item.snippet.description}`.toLowerCase();
  return /terreno/.test(texto) && /(permuta|parceria|incorpora|sociedade)/.test(texto);
}

async function parse() {
  if (!API_KEY) {
    console.error('[youtube.com] YOUTUBE_API_KEY não configurada — pulando esta fonte.');
    return { oportunidades: [], corretoresCandidatos: [] };
  }

  const diaSemana = new Date().getDay();
  const grupoHoje = ROTACAO[diaSemana];

  if (!grupoHoje) {
    console.log('[youtube.com] Fim de semana — sem grupo de busca agendado.');
    return { oportunidades: [], corretoresCandidatos: [] };
  }

  const publishedAfter = diasAtras(7); // desde a última coleta (roda semanalmente por grupo)
  const oportunidades = [];
  const corretoresCandidatos = [];

  for (const query of grupoHoje.queries) {
    try {
      const items = await buscarQuery(query, publishedAfter);
      for (const item of items) {
        if (!pareceRelevante(item)) continue;

        const videoId = item.id.videoId;
        const link = `https://www.youtube.com/watch?v=${videoId}`;
        const canal = item.snippet.channelTitle;

        oportunidades.push({
          id: generateId(FONTE, link, item.snippet.title),
          persona: 'corretor',
          fonte: FONTE,
          titulo: item.snippet.title,
          local: grupoHoje.grupo,
          nivel_maturidade: 1, // sinal de observação — vídeo não confirma processo aberto
          corretor_vinculado_id: null, // resolvido pelo worker na fusão
          link_original: link,
          texto_bruto: item.snippet.description.slice(0, 500),
          publicado_em: item.snippet.publishedAt?.slice(0, 10) || null,
          coletado_em: new Date().toISOString(),
          status_interno: 'monitorando',
        });

        corretoresCandidatos.push({
          nome: canal,
          empresa: canal,
          creci: null,
          regiao: grupoHoje.grupo,
          fonte: FONTE,
        });
      }
    } catch (err) {
      console.error(`[youtube.com] falhou na query "${query}":`, err.message);
    }
  }

  return { oportunidades, corretoresCandidatos };
}

module.exports = { parse, FONTE };

if (require.main === module) {
  parse()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error('Erro ao coletar YouTube:', err.message); process.exit(1); });
}
