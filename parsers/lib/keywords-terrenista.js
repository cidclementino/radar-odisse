// Keywords de terrenista — evita "permuta" isolado (ruidoso: troca por carro,
// outro imóvel etc.). Lista fechada em TERRENOS.md.

const KEYWORDS_TERRENISTA = [
  'permuta com construtora',
  'permuta com incorporadora',
  'aceito apartamento',
  'aceito imovel',
  'parceria para incorporacao',
  'terreno para construtora',
  'terreno para incorporadora',
  'sociedade para construir',
  'estudo de permuta',
  'troco por apartamento',
];

/** Testa um título (ou texto bruto) normalizado contra a lista de keywords. */
function bateKeywordTerrenista(textoNormalizado) {
  return KEYWORDS_TERRENISTA.some(k => textoNormalizado.includes(k));
}

// Heurística de maturidade por força do sinal — default ajustável manualmente.
// Nível 3: intenção explícita e imediata de troca. Nível 2: aberto a
// parceria/sociedade, mais formal, mas sem confirmação de processo aberto.
// Nível 1: sinal mais fraco/genérico.
const NIVEL_3 = ['aceito apartamento', 'troco por apartamento', 'permuta com construtora', 'permuta com incorporadora'];
const NIVEL_2 = ['parceria para incorporacao', 'sociedade para construir', 'terreno para construtora', 'terreno para incorporadora'];

function nivelPorKeyword(textoNormalizado) {
  if (NIVEL_3.some(k => textoNormalizado.includes(k))) return 3;
  if (NIVEL_2.some(k => textoNormalizado.includes(k))) return 2;
  return 1;
}

module.exports = { KEYWORDS_TERRENISTA, bateKeywordTerrenista, nivelPorKeyword };
