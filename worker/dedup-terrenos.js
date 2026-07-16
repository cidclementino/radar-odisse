// Regra de fusão de Corretor (ver TERRENOS.md) — cadeia sequencial:
// 1. Nome bate (fuzzy, mesmo esquema de similaridade do dedup de Concurso)
// 2. Se não bater: CRECI bate (quando disponível nos dois lados)
// 3. Se CRECI não disponível: Empresa bate (fuzzy)
// A primeira que bater confirma a fusão — não verifica as seguintes.
// Se nenhuma bater, cria um Corretor novo. ZAP pode criar Corretor sozinho,
// sem precisar que já tenha aparecido via YouTube antes.

const SIMILARITY_THRESHOLD = 0.8;

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

function bateTexto(a, b) {
  if (!a || !b) return false;
  return similarity(a, b) >= SIMILARITY_THRESHOLD;
}

/**
 * Tenta casar um candidato (nome/empresa/creci/regiao/fonte) contra a lista
 * de Corretores já existentes, seguindo a cadeia nome -> creci -> empresa.
 * Retorna o Corretor casado, ou null se nenhum bateu (cria um novo).
 */
function encontrarCorretor(existentes, candidato) {
  // 1. Nome
  const porNome = existentes.find(c => bateTexto(c.nome, candidato.nome));
  if (porNome) return porNome;

  // 2. CRECI (só se ambos os lados tiverem)
  if (candidato.creci) {
    const porCreci = existentes.find(c => c.creci && c.creci.toUpperCase() === candidato.creci.toUpperCase());
    if (porCreci) return porCreci;
  }

  // 3. Empresa
  const porEmpresa = existentes.find(c => bateTexto(c.empresa, candidato.empresa));
  if (porEmpresa) return porEmpresa;

  return null;
}

/** Cria um Corretor novo a partir de um candidato de qualquer fonte. */
function criarCorretor(candidato) {
  return {
    id: `corretor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    nome: candidato.nome,
    empresa: candidato.empresa || null,
    creci: candidato.creci || null,
    regioes_atuacao: candidato.regiao ? [candidato.regiao] : [],
    volume_zap: candidato.fonte === 'zapimoveis.com.br' ? 1 : 0,
    descoberto_via: [candidato.fonte],
    nivel_maturidade: 1,
    oportunidades_vinculadas: [],
    atualizado_em: new Date().toISOString(),
  };
}

/** Funde um candidato num Corretor já existente — preenche gaps, nunca sobrescreve. */
function fundirCorretor(existente, candidato) {
  const preencher = (a, b) => (a === null || a === undefined ? b : a);
  const regioes = new Set(existente.regioes_atuacao || []);
  if (candidato.regiao) regioes.add(candidato.regiao);

  return {
    ...existente,
    empresa: preencher(existente.empresa, candidato.empresa),
    creci: preencher(existente.creci, candidato.creci),
    regioes_atuacao: [...regioes],
    volume_zap: existente.volume_zap + (candidato.fonte === 'zapimoveis.com.br' ? 1 : 0),
    descoberto_via: [...new Set([...(existente.descoberto_via || []), candidato.fonte])],
    atualizado_em: new Date().toISOString(),
  };
}

/**
 * Processa uma lista de candidatos a Corretor contra os já existentes no KV.
 * Retorna { corretoresAtualizados } — um Map id -> Corretor pronto pra gravar.
 */
function processarCandidatosCorretor(existentes, candidatos) {
  const porId = new Map(existentes.map(c => [c.id, { ...c }]));

  for (const candidato of candidatos) {
    const listaAtual = [...porId.values()];
    const match = encontrarCorretor(listaAtual, candidato);

    if (match) {
      porId.set(match.id, fundirCorretor(match, candidato));
    } else {
      const novo = criarCorretor(candidato);
      porId.set(novo.id, novo);
    }
  }

  return porId;
}

module.exports = { encontrarCorretor, criarCorretor, fundirCorretor, processarCandidatosCorretor, similarity };
