// Parser: bustler.net
//
// Fonte RSS confirmada em https://bustler.net/feed/competitions — feed
// dedicado só a Competitions (diferente do concursosdeprojeto.org, cujo feed
// mistura Anúncios de Concursos com Resultados e Projetos no mesmo /feed/).
// Por isso este parser não tem o filtro de "post de resultado" — a própria
// segmentação do Bustler entre /news, /competitions e /events já separa isso
// na origem. Mantém-se um filtro defensivo leve (ver `ehPossivelResultado`)
// só como rede de segurança, caso o feed eventualmente misture algo.
//
// ATENÇÃO — best-effort não testado ao vivo: sandbox sem acesso de rede a
// bustler.net (mesma ressalva do parsers/competitionsarchi.js e parsers/olx.js).
// Escrito a partir do HTML real de bustler.net/ e de trechos indexados de
// páginas de detalhe (via busca), não de uma resposta de feed real. Rodar
// `node parsers/bustler.js` na primeira vez e ajustar regex conforme o que
// vier de verdade — em especial `extrairDatasBustler` e `extrairLinkOficial`.
//
// REDUNDÂNCIA COM OUTRAS FONTES: Bustler é a mesma organização que também
// republica os concursos em archinect.com/competitions (o próprio Archinect
// declara isso: "listings are powered by Bustler.net") — por isso o Archinect
// NÃO tem parser próprio (decisão registrada na conversa que trouxe esta
// fonte). Mas Bustler É logicamente independente de competitions.archi e
// concursosdeprojeto.org, apesar de cobrirem o mesmo universo de concursos
// internacionais — grandes concursos (ex: os promovidos pela Buildner) são
// tipicamente syndicados em vários agregadores ao mesmo tempo, então overlap
// de conteúdo aqui é esperado e normal. Ver RADAR.md / worker/dedup.js: a
// fusão por nome+link+datas (nível 2) é justamente o mecanismo pensado pra
// isso — não há necessidade de lógica especial aqui além de preencher os
// mesmos 5 campos de comparação (nome, local_projeto, inscricao_fim,
// entrega_fim, link_oficial) da forma mais fiel possível ao conteúdo real.

const Parser = require('rss-parser');
const { generateId } = require('./lib/normalize');

const FONTE = 'bustler.net';
const FEED_URL = 'https://bustler.net/feed/competitions';

const rssParser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

const MESES_ABREV_EN = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

const MESES_EN = {
  january: '01', february: '02', march: '03', april: '04', may: '05',
  june: '06', july: '07', august: '08', september: '09', october: '10',
  november: '11', december: '12',
};

/**
 * Filtro defensivo (não confirmado como necessário — ver nota no topo do
 * arquivo): descarta o raro caso de um post de "vencedores anunciados"
 * vazar pro feed de Competitions em vez de ficar só em /news.
 */
const RE_TITULO_RESULTADO = /\b(winners?|shortlist(ed)?)\b.*\b(announc|reveal|select)/i;

function ehPossivelResultado(item) {
  return RE_TITULO_RESULTADO.test((item.title || '').trim());
}

/** Extrai a primeira imagem do post (capa/banner). */
function extrairImagem(item) {
  if (item.mediaContent && item.mediaContent[0]?.$?.url) {
    return item.mediaContent[0].$.url;
  }
  const html = item.contentEncoded || item.content || '';
  const m = html.match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}

/**
 * Datas do Bustler aparecem em pelo menos dois formatos observados:
 *   1. Prosa livre no corpo do post: "Registration closes on April 14th, 2026"
 *      / "submission deadline is on February 28th" (ordinal + mês por extenso).
 *   2. Cabeçalho estruturado das páginas de listagem/detalhe:
 *      "Register: Thu, Jul 30, 2026" / "Submit: Mon, Feb 15, 2027"
 *      (dia da semana abreviado + vírgula + mês abreviado + dia + ano).
 * Tenta (1) primeiro (mais específico por keyword), cai pra (2) se não achar.
 */
function extrairDatasBustler(texto) {
  if (!texto) return { inscricao_fim: null, entrega_fim: null };

  let inscricao_fim = null;
  let entrega_fim = null;

  const ordinalRe = '(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(' + Object.keys(MESES_EN).join('|') + ')\\s+(\\d{4})';
  const mInscOrdinal = texto.match(new RegExp('registration[^.]*?' + ordinalRe, 'i'));
  if (mInscOrdinal) {
    inscricao_fim = `${mInscOrdinal[3]}-${MESES_EN[mInscOrdinal[2].toLowerCase()]}-${mInscOrdinal[1].padStart(2, '0')}`;
  }
  const mEntOrdinal = texto.match(new RegExp('subm(ission|it)[^.]*?' + ordinalRe, 'i'));
  if (mEntOrdinal) {
    entrega_fim = `${mEntOrdinal[3]}-${MESES_EN[mEntOrdinal[2].toLowerCase()]}-${mEntOrdinal[1].padStart(2, '0')}`;
  }

  // Fallback: cabeçalho "Register: <dia sem>, <mês abr> <dd>, <yyyy>"
  if (!inscricao_fim) {
    const m = texto.match(/regist(er|ration)\s*:?\s*[A-Za-z]{3},?\s+([A-Za-z]{3,4}),?\s+(\d{1,2}),?\s+(\d{4})/i);
    if (m) {
      const mes = MESES_ABREV_EN[m[2].toLowerCase().slice(0, 3)];
      if (mes) inscricao_fim = `${m[4]}-${mes}-${m[3].padStart(2, '0')}`;
    }
  }
  if (!entrega_fim) {
    const m = texto.match(/subm(it|ission)\s*:?\s*[A-Za-z]{3},?\s+([A-Za-z]{3,4}),?\s+(\d{1,2}),?\s+(\d{4})/i);
    if (m) {
      const mes = MESES_ABREV_EN[m[2].toLowerCase().slice(0, 3)];
      if (mes) entrega_fim = `${m[4]}-${mes}-${m[3].padStart(2, '0')}`;
    }
  }

  return { inscricao_fim, entrega_fim };
}

/**
 * Link oficial: procura primeiro por frases explícitas observadas em posts
 * reais do Bustler ("official website:", "please visit website", "Website:")
 * seguidas de URL. Cai pro fallback de primeiro link externo (fora de
 * bustler.net e archinect.com — mesma família editorial, não é o organizador)
 * só se a busca por frase não achar nada. Retorna null se nada bater — nunca
 * usa o link do agregador por engano (mesma regra do concursosdeprojeto.js).
 */
function extrairLinkOficial(html) {
  if (!html) return null;
  const texto = html.replace(/<[^>]+>/g, ' ');

  const reFrase = /(?:official website|please visit website|website)\s*:?\s*(?:for[^h]*?)?(https?:\/\/[^\s<"']+)/i;
  const mFrase = texto.match(reFrase);
  if (mFrase) return mFrase[1].replace(/[.,)]+$/, '');

  const links = [...html.matchAll(/<a[^>]+href="([^"]+)"/gi)].map(m => m[1]);
  const externo = links.find(l => {
    if (!l.startsWith('http')) return false;
    return !/bustler\.net|archinect\.com/i.test(l);
  });
  return externo || null;
}

/** Escopo é sempre array — inferido por palavras-chave no título (mesma heurística das outras fontes). */
function classificarEscopo(titulo) {
  const t = (titulo || '').toLowerCase();
  const escopo = [];
  if (/urban/.test(t)) escopo.push('urbanismo');
  if (/landscape/.test(t)) escopo.push('paisagismo');
  if (/furniture|product design|interior/.test(t)) escopo.push('design_produto_mobiliario');
  if (escopo.length === 0) escopo.push('arquitetura');
  return escopo;
}

async function parse() {
  const feed = await rssParser.parseURL(FEED_URL);

  let descartadosResultado = 0;

  const concursos = feed.items
    .filter(item => {
      if (ehPossivelResultado(item)) {
        descartadosResultado++;
        return false;
      }
      return true;
    })
    .map(item => {
      const htmlCompleto = item.contentEncoded || item.content || '';
      const textoBruto = (item.contentSnippet || item.content || '').slice(0, 500);
      const { inscricao_fim, entrega_fim } = extrairDatasBustler(`${textoBruto} ${htmlCompleto}`);

      return {
        id: generateId(FONTE, item.link, item.title),
        nome: item.title?.trim() || null,
        promotor: null,        // não estruturado no feed — revisão manual
        local_projeto: null,   // idem
        destinado_a: null,
        escopo: classificarEscopo(item.title),
        tipo: 'internacional', // fonte é global por natureza (mesma decisão do competitions.archi)
        imagem_url: extrairImagem(item),
        premio: null,          // prosa livre e inconsistente demais no feed — revisão manual

        inscricao: { gratuita: null, custo: null, obs: null },

        banca_definida: null,
        banca_obs: null,

        datas: {
          inscricao_fim,
          entrega_fim,
          resultado_previsto: null,
          texto_bruto: textoBruto,
        },

        link_oficial: extrairLinkOficial(htmlCompleto),
        status_interno: 'monitorando',
        motivo_descarte: null,

        fontes: [FONTE],
        fonte_url_original: item.link,
        coletado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      };
    });

  if (descartadosResultado > 0) {
    console.log(`[bustler.net] ${descartadosResultado} post(s) com jeito de resultado/vencedores descartado(s) por precaução.`);
  }

  return concursos;
}

module.exports = { parse, FONTE };

// Permite rodar `node parsers/bustler.js` isoladamente pra depuração.
if (require.main === module) {
  parse()
    .then(items => console.log(JSON.stringify(items, null, 2)))
    .catch(err => {
      console.error('Erro ao coletar bustler.net:', err.message);
      process.exit(1);
    });
}
