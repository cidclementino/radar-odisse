// Parser: ZAP Imóveis (terrenista + enriquecimento de Corretor)
//
// Mesma ressalva do parsers/olx.js: scraping de HTML best-effort, seletores
// não testados contra HTML bruto ao vivo. Ver TERRENOS.md.
//
// Papel duplo (decisão da sessão de fechamento):
//   1. Se o título bate keyword de terrenista -> gera Oportunidade
//   2. SEMPRE (bate keyword ou não) -> gera um "candidato a Corretor" com
//      nome/empresa/CRECI (quando visível) e região, pro worker rodar a
//      cadeia de fusão nome -> CRECI -> empresa.

const cheerio = require('cheerio');
const { generateId, normalizeText, parseTimestampRelativoPT } = require('./lib/normalize');
const { bateKeywordTerrenista, nivelPorKeyword } = require('./lib/keywords-terrenista');

const FONTE = 'zapimoveis.com.br';

const URLS_BUSCA = [
  'https://www.zapimoveis.com.br/venda/terrenos-lotes-condominios/pb+joao-pessoa/',
  'https://www.zapimoveis.com.br/venda/terrenos-lotes-condominios/pb+santa-rita/',
  'https://www.zapimoveis.com.br/venda/terrenos-lotes-condominios/pb+bayeux/',
  'https://www.zapimoveis.com.br/venda/terrenos-lotes-condominios/pb+cabedelo/',
  'https://www.zapimoveis.com.br/venda/terrenos-lotes-condominios/pb+conde/',
  'https://www.zapimoveis.com.br/venda/terrenos-lotes-condominios/pb+campina-grande/',
  'https://www.zapimoveis.com.br/venda/terrenos-lotes-condominios/pe+recife/',
  'https://www.zapimoveis.com.br/venda/terrenos-lotes-condominios/rn+natal/',
];

const REGEX_LINK_ANUNCIO = /\/imovel\/.+-id-\d+\/?/;
const REGEX_CRECI = /creci:?\s*([a-z0-9-]+)/i;

/** Sobe pelos ancestrais até achar um bloco com preço (R$) — assume ser o card inteiro. */
function acharBlocoAnuncio($, $anchor) {
  let $el = $anchor;
  for (let i = 0; i < 5; i++) {
    if (/R\$\s?[\d.,]+/.test($el.text())) return $el;
    if (!$el.parent().length) break;
    $el = $el.parent();
  }
  return $anchor.parent();
}

/** Extrai o nome da imobiliária/corretor do texto do bloco, quando presente. */
function extrairAnunciante(texto) {
  // Nomes de anunciante no ZAP tendem a aparecer como texto próprio, título,
  // frequentemente seguido de "| Creci: XXXX" ou antecedendo o preço.
  const mCreci = texto.match(/([A-ZÀ-Ú][\w À-ú.&-]{2,60}?)\s*\|\s*Creci:?\s*[a-z0-9-]+/i);
  if (mCreci) return mCreci[1].trim();
  return null;
}

function extrairRegiao(url) {
  const m = url.match(/terrenos-lotes-condominios\/([a-z]{2})\+([a-z-]+)/);
  if (!m) return null;
  const cidade = m[2].split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return cidade;
}

async function buscarUmaUrl(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OdisseRadarBot/1.0)' },
  });
  if (!res.ok) throw new Error(`ZAP retornou ${res.status} para ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const regiao = extrairRegiao(url);

  const oportunidades = [];
  const corretoresCandidatos = [];

  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (!REGEX_LINK_ANUNCIO.test(href)) return;

    const titulo = $a.attr('title') || $a.text().trim();
    if (!titulo) return;

    const $bloco = acharBlocoAnuncio($, $a);
    const textoBloco = $bloco.text();

    const anunciante = extrairAnunciante(textoBloco);
    const creciMatch = textoBloco.match(REGEX_CRECI);
    const creci = creciMatch ? creciMatch[1].toUpperCase() : null;

    // Papel 1: enriquecimento de Corretor — sempre, quando há nome de anunciante.
    if (anunciante) {
      corretoresCandidatos.push({
        nome: anunciante,
        empresa: anunciante,
        creci,
        regiao,
        fonte: FONTE,
      });
    }

    // Papel 2: sinal de terrenista — só se bater keyword.
    const tituloNormalizado = normalizeText(titulo);
    if (bateKeywordTerrenista(tituloNormalizado)) {
      oportunidades.push({
        id: generateId(FONTE, href, titulo),
        persona: 'terrenista',
        fonte: FONTE,
        titulo: titulo.trim(),
        local: regiao,
        nivel_maturidade: nivelPorKeyword(tituloNormalizado),
        corretor_vinculado_id: null, // resolvido pelo worker na fusão
        link_original: href.startsWith('http') ? href : `https://www.zapimoveis.com.br${href}`,
        texto_bruto: titulo.trim(),
        publicado_em: null, // ZAP não expõe timestamp granular por anúncio de forma confiável
        coletado_em: new Date().toISOString(),
        status_interno: 'monitorando',
      });
    }
  });

  return { oportunidades, corretoresCandidatos };
}

async function parse() {
  const oportunidades = [];
  const corretoresCandidatos = [];

  for (const url of URLS_BUSCA) {
    try {
      const resultado = await buscarUmaUrl(url);
      oportunidades.push(...resultado.oportunidades);
      corretoresCandidatos.push(...resultado.corretoresCandidatos);
    } catch (err) {
      console.error(`[zapimoveis.com.br] falhou em ${url}:`, err.message);
    }
  }

  return { oportunidades, corretoresCandidatos };
}

module.exports = { parse, FONTE };

if (require.main === module) {
  parse()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error('Erro ao coletar ZAP:', err.message); process.exit(1); });
}
