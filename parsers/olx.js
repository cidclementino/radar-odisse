// Parser: OLX (terrenista)
//
// ATENÇÃO — seletores best-effort: este parser faz scraping de HTML (a OLX
// não tem RSS), escrito a partir do padrão observado via pesquisa, sem poder
// testar contra o HTML bruto ao vivo (rede do sandbox não alcança olx.com.br).
// Pode precisar de ajuste fino na primeira rodada real — ver TERRENOS.md.
//
// Estratégia de extração: em vez de depender de nomes de classe CSS (que
// mudam sem aviso), procura âncoras cujo href aponta pra uma página de
// anúncio (`/terrenos/...-<id-numérico>`) e sobe pelos ancestrais até achar
// texto de local/timestamp/selo de "Direto com o proprietário" por perto.
// Mais resiliente a mudanças de markup do que depender de classes exatas.

const cheerio = require('cheerio');
const { generateId, normalizeText } = require('./lib/normalize');
const { parseTimestampRelativoPT } = require('./lib/normalize');
const { bateKeywordTerrenista } = require('./lib/keywords-terrenista');
const { nivelPorKeyword } = require('./lib/keywords-terrenista');

const FONTE = 'olx.com.br';

// URLs de busca por região — uma entrada por cidade/região que interessa.
// Ver TERRENOS.md para a lista de regiões (RM João Pessoa, Litoral Norte,
// Campina Grande, Recife, Natal).
const URLS_BUSCA = [
  'https://www.olx.com.br/imoveis/terrenos/estado-pb/paraiba/joao-pessoa',
  'https://www.olx.com.br/imoveis/terrenos/estado-pb/paraiba/santa-rita',
  'https://www.olx.com.br/imoveis/terrenos/estado-pb/paraiba/bayeux',
  'https://www.olx.com.br/imoveis/terrenos/estado-pb/paraiba/cabedelo',
  'https://www.olx.com.br/imoveis/terrenos/estado-pb/paraiba/conde',
  'https://www.olx.com.br/imoveis/terrenos/estado-pb/paraiba/campina-grande',
  'https://www.olx.com.br/imoveis/terrenos/estado-pe/recife-e-regiao/recife',
  'https://www.olx.com.br/imoveis/terrenos/estado-rn/natal-e-regiao/natal',
];

const REGEX_LINK_ANUNCIO = /\/terrenos\/.+-\d{6,}$/;
const REGEX_PRIVADO = /direto com o propriet[aá]rio/i;
const REGEX_TIMESTAMP = /(hoje|ontem),\s*\d{1,2}:\d{2}|\d{1,2}\s+de\s+[a-z]{3},\s*\d{1,2}:\d{2}/i;

// Janela de frescor — descarta anúncios com publicado_em mais antigo que isso.
// 30 dias pro levantamento inicial; reduzir pra 7 depois de validar volume.
const JANELA_DIAS = 30;

function dentroDaJanela(publicadoEm) {
  if (!publicadoEm) return true; // sem data extraída -> não descarta por frescor, só por falta de dado
  const dias = Math.round((Date.now() - new Date(publicadoEm + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
  return dias <= JANELA_DIAS;
}

/** Sobe pelos ancestrais até achar um bloco de texto que pareça o card do anúncio inteiro. */
function acharBlocoAnuncio($, $anchor) {
  let $el = $anchor;
  for (let i = 0; i < 5; i++) {
    const texto = $el.text();
    if (REGEX_TIMESTAMP.test(texto)) return $el;
    if (!$el.parent().length) break;
    $el = $el.parent();
  }
  return $anchor.parent(); // fallback — melhor um bloco pequeno que nenhum
}

function extrairLocal(texto) {
  // Local costuma aparecer como "João Pessoa, Bairro" ou "Cidade - UF" na
  // linha imediatamente antes do timestamp.
  const m = texto.match(/([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)*,?\s?[A-ZÀ-Ú][a-zà-ú\s]*)\s*(?:Hoje|Ontem|\d{1,2}\s+de)/);
  return m ? m[1].trim().replace(/,$/, '') : null;
}

function extrairTimestamp(texto) {
  const m = texto.match(REGEX_TIMESTAMP);
  return m ? m[0] : null;
}

async function buscarUmaUrl(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OdisseRadarBot/1.0)' },
  });
  if (!res.ok) throw new Error(`OLX retornou ${res.status} para ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const oportunidades = [];

  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (!REGEX_LINK_ANUNCIO.test(href)) return;

    const titulo = $a.attr('title') || $a.text().trim();
    if (!titulo) return;

    const tituloNormalizado = normalizeText(titulo);
    if (!bateKeywordTerrenista(tituloNormalizado)) return; // filtro de keyword

    const $bloco = acharBlocoAnuncio($, $a);
    const textoBloco = $bloco.text();

    if (!REGEX_PRIVADO.test(textoBloco)) return; // só "Direto com o proprietário"

    const timestampTexto = extrairTimestamp(textoBloco);
    const local = extrairLocal(textoBloco);
    const publicadoEm = parseTimestampRelativoPT(timestampTexto || '');

    if (!dentroDaJanela(publicadoEm)) return; // fora da janela de frescor (30 dias)

    oportunidades.push({
      id: generateId(FONTE, href, titulo),
      persona: 'terrenista',
      fonte: FONTE,
      titulo: titulo.trim(),
      local: local || null,
      nivel_maturidade: nivelPorKeyword(tituloNormalizado),
      corretor_vinculado_id: null,
      link_original: href.startsWith('http') ? href : `https://www.olx.com.br${href}`,
      texto_bruto: titulo.trim(),
      publicado_em: publicadoEm,
      coletado_em: new Date().toISOString(),
      status_interno: 'monitorando',
    });
  });

  return oportunidades;
}

async function parse() {
  const resultados = [];
  for (const url of URLS_BUSCA) {
    try {
      const itens = await buscarUmaUrl(url);
      resultados.push(...itens);
    } catch (err) {
      console.error(`[olx.com.br] falhou em ${url}:`, err.message);
    }
  }
  return resultados;
}

module.exports = { parse, FONTE };

if (require.main === module) {
  parse()
    .then(itens => console.log(JSON.stringify(itens, null, 2)))
    .catch(err => { console.error('Erro ao coletar OLX:', err.message); process.exit(1); });
}
