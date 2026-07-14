// Regra de deduplicação do Radar Odisse (ver RADAR.md para o racional completo).
//
// Nota de manutenção: esta é uma reimplementação em ESM de normalize()/similarity()
// de parsers/lib/normalize.js (que é CommonJS, usado pelos parsers rodando em Node
// no GitHub Actions). O Worker roda em V8 isolate e não compartilha módulo com o
// Actions sem um passo de bundling extra — por ora as duas cópias precisam ser
// mantidas em sincronia manualmente se o algoritmo mudar. Vale unificar em um
// pacote compartilhado numa rodada futura se isso virar fonte de bugs.

const SIMILARITY_THRESHOLD = 0.8;
// Pré-filtro: um par só é avaliado pela regra bate/ausente/conflito se o nome
// já tiver ao menos essa similaridade solta. Sem isso, qualquer par não
// relacionado acaba com nome="conflito" e entope a fila de revisão manual
// (ver RADAR.md, seção "Dedup — pré-filtro de candidatos").
const CANDIDATO_THRESHOLD = 0.5;

function normalizeText(str) {
  if (!str) return '';
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const bigrams = str => {
    const s = str.replace(/\s+/g, '');
    const grams = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      grams.set(g, (grams.get(g) || 0) + 1);
    }
    return grams;
  };

  const ga = bigrams(na);
  const gb = bigrams(nb);
  let intersection = 0;
  for (const [g, count] of ga) {
    if (gb.has(g)) intersection += Math.min(count, gb.get(g));
  }
  const totalA = [...ga.values()].reduce((s, v) => s + v, 0);
  const totalB = [...gb.values()].reduce((s, v) => s + v, 0);
  if (totalA + totalB === 0) return 0;
  return (2 * intersection) / (totalA + totalB);
}

function dominio(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Classifica um par de valores como 'bate' | 'ausente' | 'conflito' pra um campo de texto (fuzzy). */
function classificarTexto(a, b) {
  if (!a || !b) return 'ausente';
  return similarity(a, b) >= SIMILARITY_THRESHOLD ? 'bate' : 'conflito';
}

/** Idem, mas pra datas ISO (comparação exata). */
function classificarData(a, b) {
  if (!a || !b) return 'ausente';
  return a === b ? 'bate' : 'conflito';
}

/** Idem, mas pra link_oficial (compara domínio, não a URL inteira). */
function classificarLink(a, b) {
  const da = dominio(a);
  const db = dominio(b);
  if (!da || !db) return 'ausente';
  return da === db ? 'bate' : 'conflito';
}

/**
 * Compara um candidato novo contra um concurso já existente nos 5 campos acordados.
 * Retorna { mesmoDataConflito, classificacoes } — mesmoDataConflito é true se
 * QUALQUER campo vier como 'conflito' (a regra: um conflito já barra a fusão automática).
 */
function comparar(existente, candidato) {
  const classificacoes = {
    nome: classificarTexto(existente.nome, candidato.nome),
    local_projeto: classificarTexto(existente.local_projeto, candidato.local_projeto),
    inscricao_fim: classificarData(existente.datas?.inscricao_fim, candidato.datas?.inscricao_fim),
    entrega_fim: classificarData(existente.datas?.entrega_fim, candidato.datas?.entrega_fim),
    link_oficial: classificarLink(existente.link_oficial, candidato.link_oficial),
  };
  const temConflito = Object.values(classificacoes).some(c => c === 'conflito');
  return { temConflito, classificacoes };
}

/** Funde um candidato num existente: preenche campos ausentes, nunca sobrescreve valor já presente. */
function fundir(existente, candidato) {
  const preencher = (a, b) => (a === null || a === undefined ? b : a);

  return {
    ...existente,
    promotor: preencher(existente.promotor, candidato.promotor),
    local_projeto: preencher(existente.local_projeto, candidato.local_projeto),
    destinado_a: preencher(existente.destinado_a, candidato.destinado_a),
    imagem_url: preencher(existente.imagem_url, candidato.imagem_url),
    banca_definida: existente.banca_definida === null ? candidato.banca_definida : existente.banca_definida,
    banca_obs: preencher(existente.banca_obs, candidato.banca_obs),
    inscricao: {
      gratuita: existente.inscricao?.gratuita ?? candidato.inscricao?.gratuita ?? null,
      custo: preencher(existente.inscricao?.custo, candidato.inscricao?.custo),
      obs: preencher(existente.inscricao?.obs, candidato.inscricao?.obs),
    },
    datas: {
      inscricao_fim: preencher(existente.datas?.inscricao_fim, candidato.datas?.inscricao_fim),
      entrega_fim: preencher(existente.datas?.entrega_fim, candidato.datas?.entrega_fim),
      resultado_previsto: preencher(existente.datas?.resultado_previsto, candidato.datas?.resultado_previsto),
      texto_bruto: existente.datas?.texto_bruto || candidato.datas?.texto_bruto || null,
    },
    fontes: [...new Set([...(existente.fontes || []), ...(candidato.fontes || [])])],
    atualizado_em: new Date().toISOString(),
  };
}

/**
 * Ponto de entrada usado pelo worker: recebe os Concursos já existentes no KV
 * e os candidatos brutos vindos de um parser, retorna a ação a tomar pra cada um.
 */
function classificarConcursos(existentes, candidatos) {
  const fundidos = [];
  const novos = [];
  const pendentes_revisao = [];

  for (const candidato of candidatos) {
    // Dedup nível 1 (mesma fonte, mesmo link+título): id já bate exatamente.
    const igualPorId = existentes.find(e => e.id === candidato.id);
    if (igualPorId) {
      fundidos.push(fundir(igualPorId, candidato));
      continue;
    }

    // Dedup nível 2 (fontes diferentes, possivelmente o mesmo concurso).
    // Passo 1 — pré-filtro: só considera "candidato a mesmo concurso" quem
    // tiver nome minimamente parecido. Isso evita comparar cada item novo
    // contra concursos totalmente não relacionados.
    const candidatosPlausiveis = existentes.filter(
      e => similarity(e.nome, candidato.nome) >= CANDIDATO_THRESHOLD
    );

    // Passo 2 — dentro dos plausíveis, aplica a regra bate/ausente/conflito.
    let melhorFusao = null;   // sem conflito algum -> funde
    let melhorRevisao = null; // com conflito, mas ainda plausível -> revisão manual

    for (const existente of candidatosPlausiveis) {
      const { temConflito, classificacoes } = comparar(existente, candidato);
      const quantosBatem = Object.values(classificacoes).filter(c => c === 'bate').length;

      if (!temConflito) {
        if (!melhorFusao || quantosBatem > melhorFusao.quantosBatem) {
          melhorFusao = { existente, quantosBatem };
        }
      } else if (!melhorFusao) {
        if (!melhorRevisao || quantosBatem > melhorRevisao.quantosBatem) {
          melhorRevisao = { existente, quantosBatem, classificacoes };
        }
      }
    }

    if (melhorFusao) {
      fundidos.push(fundir(melhorFusao.existente, candidato));
    } else if (melhorRevisao) {
      pendentes_revisao.push({
        candidato_existente: melhorRevisao.existente,
        candidato_novo: candidato,
        motivo: melhorRevisao.classificacoes,
      });
    } else {
      novos.push(candidato);
    }
  }

  return { fundidos, novos, pendentes_revisao };
}

export { classificarConcursos, comparar, fundir, similarity, normalizeText };
