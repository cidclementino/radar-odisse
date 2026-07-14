// Parser: concursosdeprojeto.org
//
// Fonte RSS confirmada em https://concursosdeprojeto.org/feed/
// Contrato: exporta `parse()`, que retorna uma Promise<Concurso[]>
// já normalizado pro schema comum do Radar (ver RADAR.md).
//
// Todo parser de fonte deve seguir esse mesmo contrato — isso é o que
// permite o worker/collect tratar todas as fontes de forma uniforme.

const Parser = require('rss-parser');
const { generateId, extractDates } = require('./lib/normalize');

const FONTE = 'concursosdeprojeto.org';
const FEED_URL = 'https://concursosdeprojeto.org/feed/';

const rssParser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

/** Extrai a primeira URL de imagem do HTML do post (capa/banner). */
function extrairImagem(item) {
  if (item.mediaContent && item.mediaContent[0]?.$?.url) {
    return item.mediaContent[0].$.url;
  }
  const html = item.contentEncoded || item.content || '';
  const m = html.match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}

/**
 * Tenta achar o link oficial do concurso dentro do conteúdo do post — ou seja,
 * o primeiro link de saída que NÃO aponta pro próprio concursosdeprojeto.org.
 * Se não achar nenhum, retorna null (desconhecido) em vez de usar o link do
 * agregador por engano — ver RADAR.md sobre por que isso importa pro dedup.
 */
function extrairLinkOficial(html) {
  if (!html) return null;
  const links = [...html.matchAll(/<a[^>]+href="([^"]+)"/gi)].map(m => m[1]);
  const externo = links.find(l => !l.includes('concursosdeprojeto.org') && l.startsWith('http'));
  return externo || null;
}

/** Classifica nacional/internacional a partir das categorias do post do WordPress. */
function classificarTipo(categorias) {
  const texto = (categorias || []).join(' ').toLowerCase();
  if (texto.includes('internacional')) return 'internacional';
  if (texto.includes('nacional')) return 'nacional';
  return 'nacional'; // default conservador — revisar manualmente se necessário
}

/** Escopo é sempre um array — aqui inferimos por palavras-chave no título/categoria. */
function classificarEscopo(titulo, categorias) {
  const texto = `${titulo} ${(categorias || []).join(' ')}`.toLowerCase();
  const escopo = [];
  if (/urban/.test(texto)) escopo.push('urbanismo');
  if (/paisag/.test(texto)) escopo.push('paisagismo');
  if (/mobili[áa]rio|produto|design/.test(texto)) escopo.push('design_produto_mobiliario');
  if (escopo.length === 0 || /arquitet/.test(texto)) escopo.unshift('arquitetura');
  return [...new Set(escopo)];
}

async function parse() {
  const feed = await rssParser.parseURL(FEED_URL);

  return feed.items.map(item => {
    const categorias = item.categories || [];
    const htmlCompleto = item.contentEncoded || item.content || '';
    const textoBruto = (item.contentSnippet || item.content || '').slice(0, 500);
    const { inscricao_fim, entrega_fim } = extractDates(textoBruto);
    const linkOficial = extrairLinkOficial(htmlCompleto);

    return {
      id: generateId(FONTE, item.link, item.title),
      nome: item.title?.trim() || null,
      promotor: null,               // raramente estruturado no RSS — fica pra revisão manual
      local_projeto: null,          // idem — extraído do texto quando possível em versões futuras
      destinado_a: null,
      escopo: classificarEscopo(item.title, categorias),
      tipo: classificarTipo(categorias),
      imagem_url: extrairImagem(item),
      premio: null, // raramente estruturado no RSS — fica pra revisão manual

      inscricao: { gratuita: null, custo: null, obs: null },

      banca_definida: null,
      banca_obs: null,

      datas: {
        inscricao_fim,
        entrega_fim,
        resultado_previsto: null,
        texto_bruto: textoBruto,
      },

      link_oficial: linkOficial, // null se não encontrado no conteúdo — nunca usa o link do agregador
      status_interno: 'monitorando',
      motivo_descarte: null,

      fontes: [FONTE],
      fonte_url_original: item.link,
      coletado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    };
  });
}

module.exports = { parse, FONTE };

// Permite rodar `node parsers/concursosdeprojeto.js` isoladamente pra depuração.
if (require.main === module) {
  parse()
    .then(items => console.log(JSON.stringify(items, null, 2)))
    .catch(err => {
      console.error('Erro ao coletar concursosdeprojeto.org:', err.message);
      process.exit(1);
    });
}
