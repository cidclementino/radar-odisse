// Parser: sites do IAB (direção nacional e departamentos estaduais)
//
// Os departamentos do IAB organizam boa parte dos concursos públicos de projeto no Brasil e
// publicam o lançamento como notícia no próprio site. Sondagem de nov/2026 (workflow "Sondar
// fontes"): têm site WordPress ativo o IAB nacional, SP, RJ, RS, PR, PB, CE e MS. Os demais estados
// não têm domínio próprio, estão fora do ar ou publicam só em rede social; o IAB/DF usa um site
// estático sem feed (fica de fora por ora).
//
// Cada site entra como uma fonte própria (ex.: "iabrj.org.br"). A leitura usa, nesta ordem:
//   1. a API do WordPress (posts das categorias de concurso + busca por "concurso"), que traz o
//      texto completo e a imagem de destaque;
//   2. o feed RSS, quando a API não responde.
// Só entram publicações dos últimos JANELA_DIAS dias, com cara de chamada aberta (não resultado,
// júri, licitação ou concurso público de emprego). Datas, link oficial e banner saem do texto do
// post (js/extrair-site.js); o que faltar a coleta tenta completar pelo site oficial depois.

const Parser = require('rss-parser');
const { generateId, similarity } = require('./lib/normalize');
const { extrairSite, palpites } = require('../js/extrair-site.js');

const JANELA_DIAS = 150;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const DEPARTAMENTOS = [
  { fonte: 'iab.org.br', sigla: 'IAB', categorias: ['concursos', 'concursos-de-projeto'] },
  { fonte: 'iabsp.org.br', sigla: 'IAB/SP', categorias: ['concursos'], tipoExtra: 'concurso' },
  { fonte: 'iabrj.org.br', sigla: 'IAB/RJ', categorias: ['concursos'] },
  { fonte: 'iabrs.org.br', sigla: 'IAB/RS', categorias: ['concursos'] },
  { fonte: 'iabpr.org.br', sigla: 'IAB/PR', categorias: ['concursos'], feeds: ['/category/concursos/feed/', '/feed/'] },
  { fonte: 'iabpb.org.br', sigla: 'IAB/PB', categorias: [], feeds: ['/feed/'] },
  { fonte: 'iabce.org.br', sigla: 'IAB/CE', categorias: ['concursos'] },
  { fonte: 'iabms.org.br', sigla: 'IAB/MS', categorias: [], feeds: ['/feed/'] },
];

// precisa parecer chamada de concurso…
const RE_INCLUI = /concurso|premia[çc][ãa]o|pr[êe]mio|chamamento|chamada\s+(aberta|p[úu]blica)|competi[çc][ãa]o|open\s+call|bienal.*(cartaz|concurso)/i;
// …e não ser resultado, júri, licitação, emprego público ou notícia institucional
const RE_EXCLUI = /recebe\s+\d+\s+inscri|inscri[çc][õo]es\s+recebidas|resultado|vencedor|premiad[oa]s|homologa|julgamento|comiss[ãa]o\s+julgadora|j[úu]ri\b|cerim[ôo]nia|exposi[çc][ãa]o\s+d|\bata\b|licita[çc][ãa]o|obras|provas?\s+(e|de)\s+t[íi]tulos|concurso\s+p[úu]blico\s+(para\s+(cargo|provimento|professor)|de\s+provas)|t[ée]cnicos?\s+de\s+campo|congratula|\bnota\b|manifesto|elei[çc]|assembleia|parceria\s+para|balan[çc]o/i;
// prefixos de chamada que não fazem parte do nome do concurso
const RE_PREFIXO = /^(?:inscri[çc][õo]es\s+abertas|[úu]ltimos\s+dias(?:\s+para\s+(?:as\s+)?inscri[çc][õo]es)?|aberto\s+o\s+per[íi]odo\s+de\s+inscri[çc][õo]es\s+para\s+o|aberta[s]?\s+as\s+inscri[çc][õo]es\s+(?:para|do|da)\s+o?|prorrogad[oa]s?\s+(?:as\s+)?inscri[çc][õo]es\s+(?:para|do|da)\s+o?|lan[çc]ad[oa]|lan[çc]amento(?:\s+do)?|est[ãa]o\s+abertas\s+as\s+inscri[çc][õo]es\s+(?:para|do|da)\s+o?)\s*[:–—-]?\s*/i;
// "IAB RJ e Prefeitura do Rio lançam concurso de ideias…" → "Concurso de ideias…"
// (só quando quem lança é uma instituição; "15ª Bienal lança concurso para seu cartaz" fica inteiro)
const RE_QUEM_LANCA = /^(?:IAB|Prefeitura|Governo|Secretaria|Funda[çc][ãa]o|Minist[ée]rio|Caixa|Sesc|Sebrae)\b.{0,90}?\b(?:lan[çc]am?|promovem?|abrem?|realizam?|anunciam?)\s+(?=(?:o\s+|um\s+)?concurso)/i;
const RE_REDES = /facebook|instagram|twitter|x\.com|linkedin|youtube|youtu\.be|wa\.me|whatsapp|t\.me|tiktok|flickr|pinterest|google\.com\/maps|goo\.gl|bit\.ly\/?$/i;

const rss = new Parser({ customFields: { item: [['content:encoded', 'contentEncoded'], ['media:content', 'mediaContent', { keepArray: true }]] } });

function decodificar(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&[lr]squo;|&#8217;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

async function json(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** posts pela API do WordPress; devolve null se a API não responder */
async function postsPelaApi(dep, desde) {
  const base = `https://${dep.fonte}/wp-json/wp/v2`;
  const posts = new Map();
  const juntar = lista => { for (const p of lista || []) posts.set(p.link, p); };
  try {
    const ids = [];
    for (const slug of dep.categorias) {
      const cats = await json(`${base}/categories?slug=${encodeURIComponent(slug)}`);
      ids.push(...cats.map(c => c.id));
    }
    if (ids.length) juntar(await json(`${base}/posts?categories=${ids.join(',')}&after=${desde}&per_page=30&_embed=wp:featuredmedia`));
    juntar(await json(`${base}/posts?search=concurso&after=${desde}&per_page=30&_embed=wp:featuredmedia`));
  } catch (err) {
    if (!posts.size) return null;
  }
  if (dep.tipoExtra) {
    try { juntar(await json(`${base}/${dep.tipoExtra}?after=${desde}&per_page=30&_embed=wp:featuredmedia`)); } catch { /* tipo próprio opcional */ }
  }
  return [...posts.values()].map(p => ({
    titulo: decodificar(p.title?.rendered),
    link: p.link,
    data: p.date,
    html: p.content?.rendered || p.excerpt?.rendered || '',
    imagem: p._embedded?.['wp:featuredmedia']?.[0]?.source_url || null,
  }));
}

async function postsPeloFeed(dep, desdeMs) {
  for (const caminho of dep.feeds || ['/feed/']) {
    try {
      const feed = await rss.parseURL(`https://${dep.fonte}${caminho}`);
      return feed.items
        .filter(i => new Date(i.isoDate || i.pubDate).getTime() >= desdeMs)
        .map(i => ({
          titulo: decodificar(i.title),
          link: i.link,
          data: i.isoDate || i.pubDate,
          html: i.contentEncoded || i.content || '',
          imagem: i.mediaContent?.[0]?.$?.url || null,
        }));
    } catch { /* tenta o próximo feed */ }
  }
  return [];
}

function classificarEscopo(texto) {
  const t = texto.toLowerCase();
  const escopo = [];
  if (/urban|requalifica[çc][ãa]o\s+(urbana|da\s+avenida|da\s+pra[çc]a)|bairro|cidade|orla|avenida|pra[çc]a/.test(t)) escopo.push('urbanismo');
  if (/paisag|parque|jardim|renaturaliza|rio\s/.test(t)) escopo.push('paisagismo');
  if (/mobili[áa]rio|design\s+de\s+produto|cartaz|identidade\s+visual/.test(t)) escopo.push('design_produto_mobiliario');
  if (!escopo.length || /arquitet|edif[íi]cio|sede|museu|escola|centro|teatro|biblioteca|habita/.test(t)) escopo.unshift('arquitetura');
  return [...new Set(escopo)];
}

// "…Avenida Júlio de Castilhos, em Caxias do Sul" → "Caxias do Sul"
function localDoTitulo(titulo) {
  const m = titulo.match(/\bem\s+((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ú'-]+)(?:\s+(?:do|da|de|dos|das)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ú'-]+|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ú'-]+)*)\s*(?:[-–—,(/]|$)/);
  return m ? m[1] : null;
}

function linkOficial(html, link) {
  let host = '';
  try { host = new URL(link).hostname.replace(/^www\./, ''); } catch { /* ok */ }
  const links = [...String(html).matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ url: m[1], texto: decodificar(m[2]) }));
  const externos = links.filter(l => /^https?:/i.test(l.url) && !RE_REDES.test(l.url) && !/wp-content|\.(jpe?g|png|webp)(\?|$)/i.test(l.url)
    && (() => { try { return new URL(l.url).hostname.replace(/^www\./, '') !== host; } catch { return false; } })());
  // preferência para quem fala de site/edital/inscrição/concurso
  const melhor = externos.find(l => /site|edital|inscri|concurso|regulamento|acesse|saiba\s+mais|clique/i.test(l.texto + ' ' + l.url));
  return (melhor || externos[0])?.url || null;
}

function paraConcurso(dep, post) {
  let nome = post.titulo.replace(RE_PREFIXO, '').replace(RE_QUEM_LANCA, '').replace(/^(?:o|um)\s+/i, '').replace(/^[“"']|[”"']$/g, '').trim();
  if (nome === nome.toUpperCase()) nome = nome.toLowerCase(); // título todo em maiúsculas
  const site = extrairSite(post.html, post.link);
  const p = palpites(site);
  const texto = decodificar(post.html);
  return {
    id: generateId(dep.fonte, post.link, post.titulo),
    nome: nome.charAt(0).toUpperCase() + nome.slice(1),
    promotor: dep.sigla,
    local_projeto: localDoTitulo(post.titulo),
    destinado_a: null,
    escopo: classificarEscopo(`${post.titulo} ${texto.slice(0, 1500)}`),
    tipo: 'nacional',
    imagem_url: post.imagem || (post.html.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || null,
    premio: null,
    inscricao: { gratuita: /inscri[çc][ãa]o\s+(gratuita|sem\s+custo)|gratuitas?\b/i.test(texto) ? true : null, custo: null, obs: null },
    banca_definida: null,
    banca_obs: null,
    datas: {
      inscricao_fim: p.inscricao_fim || null,
      entrega_fim: p.entrega_fim || null,
      resultado_previsto: p.resultado_previsto || null,
      texto_bruto: texto.slice(0, 500),
    },
    link_oficial: linkOficial(post.html, post.link),
    status_interno: 'monitorando',
    motivo_descarte: null,
    fontes: [dep.fonte],
    fonte_url_original: post.link,
    publicado_em: post.data || null,
    coletado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  };
}

function criarParser(dep) {
  return {
    FONTE: dep.fonte,
    async parse() {
      const desdeMs = Date.now() - JANELA_DIAS * 86400000;
      const desde = new Date(desdeMs).toISOString().slice(0, 19);
      let posts = dep.categorias.length || dep.tipoExtra ? await postsPelaApi(dep, desde) : null;
      if (posts === null) posts = await postsPeloFeed(dep, desdeMs);
      const relevantes = posts.filter(p => RE_INCLUI.test(p.titulo) && !RE_EXCLUI.test(p.titulo));
      const descartados = posts.length - relevantes.length;
      if (descartados) console.log(`[${dep.fonte}] ${descartados} publicação(ões) sem cara de chamada aberta ignorada(s).`);
      return relevantes.map(p => paraConcurso(dep, p));
    },
  };
}

const parsers = DEPARTAMENTOS.map(criarParser);

// O mesmo concurso costuma sair em vários departamentos (e várias vezes no mesmo: lançamento,
// "últimos dias", prorrogação). Junta os que têm o mesmo site oficial ou o mesmo nome antes de
// mandar ao Radar: fica o primeiro, completado com o que os outros tiverem, e as fontes somadas.
function chaveLink(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch { return null; }
}
const chaveNome = n => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function juntarRepetidos(itens) {
  const saida = [];
  for (const c of itens) {
    const k1 = c.link_oficial && !/forms\.gle|docs\.google/.test(c.link_oficial) ? chaveLink(c.link_oficial) : null;
    const k2 = chaveNome(c.nome);
    const igual = saida.find(o => (k1 && o._k1 === k1) || o._k2 === k2 || similarity(o.nome, c.nome) >= 0.8);
    if (!igual) { saida.push({ ...c, _k1: k1, _k2: k2 }); continue; }
    for (const campo of ['local_projeto', 'imagem_url', 'link_oficial']) igual[campo] = igual[campo] || c[campo];
    for (const campo of ['inscricao_fim', 'entrega_fim', 'resultado_previsto']) igual.datas[campo] = igual.datas[campo] || c.datas[campo];
    igual.fontes = [...new Set([...igual.fontes, ...c.fontes])];
  }
  return saida.map(({ _k1, _k2, ...c }) => c);
}

// Um parser só no registro (FONTE "iab"); cada concurso sai com o(s) site(s) do IAB em `fontes`.
module.exports = {
  FONTE: 'iab',
  async parse() {
    const todos = [];
    for (const p of parsers) {
      try {
        const itens = await p.parse();
        console.log(`[iab] ${p.FONTE}: ${itens.length}`);
        todos.push(...itens);
      } catch (err) {
        console.error(`[iab] ${p.FONTE} falhou:`, err.message);
      }
    }
    const juntos = juntarRepetidos(todos);
    if (juntos.length < todos.length) console.log(`[iab] ${todos.length - juntos.length} publicação(ões) repetida(s) juntada(s).`);
    return juntos;
  },
};

// Teste local: node parsers/iab.js [dominio]
if (require.main === module) {
  (async () => {
    const alvo = process.argv[2];
    for (const p of alvo ? parsers.filter(x => x.FONTE === alvo) : [module.exports]) {
      try {
        const itens = await p.parse();
        console.log(`\n=== ${p.FONTE}: ${itens.length}`);
        for (const c of itens) {
          console.log(`- ${c.nome.slice(0, 90)} [${c.fontes.join(', ')}]\n    inscr ${c.datas.inscricao_fim || '—'} · entrega ${c.datas.entrega_fim || '—'} · local ${c.local_projeto || '—'} · img ${c.imagem_url ? 'sim' : 'não'}\n    oficial ${c.link_oficial || '—'}\n    post ${c.fonte_url_original}`);
        }
      } catch (err) {
        console.log(`\n=== ${p.FONTE}: ERRO ${err.message}`);
      }
    }
  })();
}
