// Helpers compartilhados por todos os parsers de fonte do Radar Odisse.
// Mantém a lógica de normalização/hash consistente entre parser e worker,
// já que a regra de dedup depende dos dois lados calcularem a mesma coisa.

const MESES_PT = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04',
  maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09',
  outubro: '10', novembro: '11', dezembro: '12',
};

const MESES_EN = {
  january: '01', february: '02', march: '03', april: '04', may: '05',
  june: '06', july: '07', august: '08', september: '09', october: '10',
  november: '11', december: '12',
};

/** Remove acentos, pontuação e normaliza espaços/maiúsculas — usado pra comparação de nome/local. */
function normalizeText(str) {
  if (!str) return '';
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Similaridade por bigramas (coeficiente de Dice) — 0 (nada em comum) a 1 (idêntico). */
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

/** Hash FNV-1a simples, suficiente pra gerar um id curto e estável (não é criptográfico). */
function hashString(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Gera o id do Concurso a partir de fonte + link + título (dedup de nível 1, mesma fonte). */
function generateId(fonte, link, titulo) {
  const prefix = fonte.split('.')[0].slice(0, 4);
  const hash = hashString(`${link}|${titulo}`);
  const ano = new Date().getFullYear();
  return `${prefix}-${ano}-${hash}`;
}

/**
 * Extração best-effort de datas a partir de texto livre (EN/PT).
 * Não tem garantia de cobrir todos os formatos — por isso `texto_bruto`
 * sempre é preservado no schema como fallback pra revisão manual.
 *
 * Reconhece padrões como:
 *   "Submission: 30th September 2026"
 *   "Registration: 20th July 2026"
 *   "até 15 de julho de 2026"
 *   "15/07/2026"
 */
function extractDates(texto) {
  if (!texto) return { inscricao_fim: null, entrega_fim: null };

  const t = texto;
  let inscricao_fim = null;
  let entrega_fim = null;

  // EN: "Registration: 20th July 2026" / "Registration ends July 20, 2026"
  const enDateRe = '(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + Object.keys(MESES_EN).join('|') + ')\\s+(\\d{4})';
  const regInscEn = new RegExp('registration[^\\n]*?' + enDateRe, 'i');
  const regEntEn = new RegExp('submission[^\\n]*?' + enDateRe, 'i');

  const mInsc = t.match(regInscEn);
  if (mInsc) inscricao_fim = `${mInsc[3]}-${MESES_EN[mInsc[2].toLowerCase()]}-${mInsc[1].padStart(2, '0')}`;

  const mEnt = t.match(regEntEn);
  if (mEnt) entrega_fim = `${mEnt[3]}-${MESES_EN[mEnt[2].toLowerCase()]}-${mEnt[1].padStart(2, '0')}`;

  // PT: "até 15 de julho de 2026" — usado tanto pra inscrição quanto entrega,
  // dependendo do contexto textual (a primeira ocorrência geralmente é inscrição).
  if (!inscricao_fim) {
    const ptDateRe = new RegExp('at[ée]\\s+(\\d{1,2})\\s+de\\s+(' + Object.keys(MESES_PT).join('|') + ')\\s+de\\s+(\\d{4})', 'i');
    const mPt = t.match(ptDateRe);
    if (mPt) inscricao_fim = `${mPt[3]}-${MESES_PT[mPt[2].toLowerCase()]}-${mPt[1].padStart(2, '0')}`;
  }

  // Formato numérico dd/mm/yyyy como último recurso pra inscrição
  if (!inscricao_fim) {
    const mNum = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (mNum) inscricao_fim = `${mNum[3]}-${mNum[2]}-${mNum[1]}`;
  }

  return { inscricao_fim, entrega_fim };
}

module.exports = { normalizeText, similarity, hashString, generateId, extractDates };
