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
  // 0. Canal do YouTube: identidade exata, vale antes de tudo.
  if (candidato.canal_id) {
    const porCanal = existentes.find(c => c.canal_id === candidato.canal_id);
    if (porCanal) return porCanal;
  }
  // Dois canais diferentes nunca são o mesmo corretor por semelhança de nome ou empresa.
  const compativeis = existentes.filter(c => !(candidato.canal_id && c.canal_id && c.canal_id !== candidato.canal_id));

  // 1. Nome
  const porNome = compativeis.find(c => bateTexto(c.nome, candidato.nome));
  if (porNome) return porNome;

  // 2. CRECI (só se ambos os lados tiverem)
  if (candidato.creci) {
    const porCreci = compativeis.find(c => c.creci && c.creci.toUpperCase() === candidato.creci.toUpperCase());
    if (porCreci) return porCreci;
  }

  // 3. Empresa
  const porEmpresa = compativeis.find(c => bateTexto(c.empresa, candidato.empresa));
  if (porEmpresa) return porEmpresa;

  return null;
}

/** Campos de identidade e contato que a coleta preenche quando vazios e nunca sobrescreve. */
const CAMPOS_COLETADOS = ['canal_id', 'canal_url', 'foto_url', 'whatsapp', 'telefone', 'instagram', 'email'];

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
    nivel_maturidade: candidato.nivel || 1,
    oportunidades_vinculadas: [],
    ...Object.fromEntries(CAMPOS_COLETADOS.map(k => [k, candidato[k] ?? null])),
    atualizado_em: new Date().toISOString(),
  };
}

/** Funde um candidato num Corretor já existente — preenche gaps, nunca sobrescreve. */
function fundirCorretor(existente, candidato) {
  const preencher = (a, b) => (a === null || a === undefined ? (b ?? null) : a);
  const regioes = new Set(existente.regioes_atuacao || []);
  if (candidato.regiao) regioes.add(candidato.regiao);

  const coletados = Object.fromEntries(CAMPOS_COLETADOS.map(k => [k, preencher(existente[k], candidato[k] ?? null)]));

  return {
    ...existente,
    ...coletados,
    // o nível do corretor sobe com o sinal mais forte já visto; nunca desce sozinho
    nivel_maturidade: Math.max(existente.nivel_maturidade || 1, candidato.nivel || 1),
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
 * Retorna { corretores, vinculos }:
 *   - corretores: Map id -> Corretor pronto pra gravar (só os tocados nesta coleta);
 *   - vinculos: Map id da oportunidade -> id do corretor (candidatos que vieram de um anúncio/vídeo).
 */
function processarCandidatosCorretor(existentes, candidatos) {
  const porId = new Map(existentes.map(c => [c.id, { ...c }]));
  const tocados = new Set();
  const vinculos = new Map();

  for (const candidato of candidatos) {
    const listaAtual = [...porId.values()];
    const match = encontrarCorretor(listaAtual, candidato);

    let corretor;
    if (match) {
      corretor = fundirCorretor(match, candidato);
    } else {
      corretor = criarCorretor(candidato);
    }
    if (candidato.oportunidade_id) {
      const ligadas = new Set(corretor.oportunidades_vinculadas || []);
      ligadas.add(candidato.oportunidade_id);
      corretor.oportunidades_vinculadas = [...ligadas];
      vinculos.set(candidato.oportunidade_id, corretor.id);
    }
    porId.set(corretor.id, corretor);
    tocados.add(corretor.id);
  }

  const corretores = new Map([...tocados].map(id => [id, porId.get(id)]));
  return { corretores, vinculos };
}

module.exports = { encontrarCorretor, criarCorretor, fundirCorretor, processarCandidatosCorretor, similarity };
