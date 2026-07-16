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

const { generateId } = require('./lib/normalize');

const FONTE = 'youtube.com';
const API_KEY = process.env.YOUTUBE_API_KEY;

// Disparo manual pela aba Actions ("Run workflow") vem com este evento.
// Em cron automático o evento é 'schedule'.
const EXECUCAO_MANUAL = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';

// 0 = domingo ... 6 = sábado (Date#getDay())
const ROTACAO = {
  1: { grupo: 'RM João Pessoa', queries: ['corretor terreno permuta João Pessoa', 'terreno permuta Santa Rita PB', 'terreno permuta Bayeux'] },
  2: { grupo: 'Litoral Norte', queries: ['corretor terreno permuta Cabedelo', 'terreno permuta Conde PB', 'terreno permuta Jacumã'] },
  3: { grupo: 'Campina Grande', queries: ['corretor terreno permuta Campina Grande'] },
  4: { grupo: 'Recife', queries: ['corretor terreno permuta Recife'] },
  5: { grupo: 'Natal', queries: ['corretor terreno permuta Natal RN'] },
};

/** Termos que indicam disposição explícita de permuta/parceria no anúncio. */
const RE_PERMUTA = /(permuta|parceria|incorpora|sociedade)/;

/** Nome do canal batendo com padrão de corretor/imobiliária. */
const RE_CANAL_IMOBILIARIO = /(imob|imóve|imove|corretor|realty|construtora|incorporadora)/i;

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

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
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
 * Classifica o vídeo em um dos dois níveis de sinal, ou null se for ruído.
 *   - 2 (qualificado): "terreno" + termo explícito de permuta no título/descrição.
 *   - 1 (observação): "terreno" no título/descrição + canal reconhecido como
 *     corretor/imobiliária, mesmo sem termo de permuta.
 *   - null: não menciona "terreno", ou menciona mas o canal não é reconhecível
 *     como corretor/imobiliária — ruído demais pra virar candidato.
 */
function classificarNivel(item) {
  const texto = `${item.snippet.title} ${item.snippet.description}`.toLowerCase();
  if (!/terreno/.test(texto)) return null;

  if (RE_PERMUTA.test(texto)) return 2;
  if (RE_CANAL_IMOBILIARIO.test(item.snippet.channelTitle || '')) return 1;
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
  const oportunidades = [];
  const corretoresCandidatos = [];

  for (const grupo of grupos) {
    for (const query of grupo.queries) {
      try {
        const items = await buscarQuery(query, publishedAfter);

        // Diagnóstico: mostra quantos itens a API devolveu e como cada um
        // foi classificado, antes de qualquer descarte. Ajuda a distinguir
        // "a API não retornou o vídeo" de "o filtro descartou o vídeo".
        const contagem = { 2: 0, 1: 0, descartado: 0 };
        for (const it of items) {
          const n = classificarNivel(it);
          contagem[n === null ? 'descartado' : n]++;
        }
        console.log(
          `[youtube.com] "${query}": API retornou ${items.length} item(ns) — ` +
          `nível 2: ${contagem[2]}, nível 1: ${contagem[1]}, descartado: ${contagem.descartado}`
        );

        for (const item of items) {
          const nivel = classificarNivel(item);
          if (nivel === null) continue;

          const videoId = item.id.videoId;
          const link = `https://www.youtube.com/watch?v=${videoId}`;
          const canal = item.snippet.channelTitle;

          oportunidades.push({
            id: generateId(FONTE, link, item.snippet.title),
            persona: 'corretor',
            fonte: FONTE,
            titulo: item.snippet.title,
            local: grupo.grupo,
            nivel_maturidade: nivel,
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
            regiao: grupo.grupo,
            fonte: FONTE,
          });
        }
      } catch (err) {
        console.error(`[youtube.com] falhou na query "${query}":`, err.message);
      }
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
