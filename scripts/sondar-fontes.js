// Radar Odisse — sondagem de fontes candidatas (rodar à mão: workflow "Sondar fontes")
//
// Para cada site da lista, verifica se abre, se é WordPress, se tem feed RSS, se a API do
// WordPress responde e quantas publicações sobre concurso há e de quando é a mais recente.
// Serve para decidir quais fontes valem um parser. Não grava nada.

const SITES = (process.env.SITES || `
iab.org.br iabsp.org.br iabrj.org.br iabpr.org.br iab-rs.org.br iabrs.org.br iabmg.org.br iabsc.org.br
iab-sc.org.br iabdf.org.br iabba.org.br iabpe.org.br iabce.org.br iabpb.org.br iabgo.org.br iabes.org.br
iabms.org.br iabam.org.br iabpa.org.br iabrn.org.br iabal.org.br iabse.org.br iabma.org.br iabto.org.br
iabmt.org.br iabpi.org.br iabro.org.br concursosdeprojeto.org archdaily.com.br vitruvius.com.br
galeriadaarquitetura.com.br caubr.gov.br
`).split(/\s+/).filter(Boolean);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const RE_CONCURSO = /concurso|premia[çc][ãa]o|pr[êe]mio|chamamento|edital/i;

async function get(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow', signal: ctrl.signal });
    const texto = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, tipo: res.headers.get('content-type') || '', texto };
  } catch (err) {
    return { ok: false, status: err.name === 'AbortError' ? 'tempo' : (err.cause?.code || err.message).slice(0, 40), texto: '' };
  } finally {
    clearTimeout(t);
  }
}

const dia = s => (s ? new Date(s).toISOString().slice(0, 10) : '-');

async function sondar(dominio) {
  const r = { dominio };
  const home = await get(`https://${dominio}/`);
  r.home = home.status;
  if (!home.ok) return r;
  r.final = new URL(home.url).hostname;
  r.titulo = (home.texto.match(/<title[^>]*>([^<]{0,70})/i) || [])[1]?.trim();
  r.wp = /wp-content|wp-json|wordpress/i.test(home.texto);
  r.linksConcurso = [...new Set([...home.texto.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{0,80})</gi)]
    .filter(m => RE_CONCURSO.test(m[2]) || /concurso/i.test(m[1])).map(m => m[1]))].slice(0, 4);

  const base = `https://${r.final}`;
  const feed = await get(`${base}/feed/`);
  if (feed.ok && /<rss|<feed/i.test(feed.texto)) {
    const datas = [...feed.texto.matchAll(/<pubDate>([^<]+)</g)].map(m => m[1]);
    const titulos = [...feed.texto.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([^<\]]+)/g)].map(m => m[1]);
    r.feed = `${titulos.length} itens, último ${dia(datas[0])}, ${titulos.filter(t => RE_CONCURSO.test(t)).length} sobre concurso`;
  } else {
    r.feed = `não (${feed.status})`;
  }

  if (r.wp) {
    const busca = await get(`${base}/wp-json/wp/v2/posts?search=concurso&per_page=20&_fields=date,title,link`);
    try {
      const posts = JSON.parse(busca.texto);
      r.apiConcurso = `${posts.length} posts, último ${dia(posts[0]?.date)}`;
      r.exemplos = posts.slice(0, 3).map(p => `${dia(p.date)} ${(p.title?.rendered || '').replace(/<[^>]+>/g, '').slice(0, 70)}`);
    } catch {
      r.apiConcurso = `não (${busca.status})`;
    }
    const cats = await get(`${base}/wp-json/wp/v2/categories?search=concurso&_fields=id,name,count,slug`);
    try { r.categorias = JSON.parse(cats.texto).map(c => `${c.name} [${c.slug}] (${c.count})`); } catch { /* sem categorias */ }
  }
  return r;
}

(async () => {
  for (const d of SITES) {
    const r = await sondar(d);
    console.log(`\n=== ${d}`);
    for (const [k, v] of Object.entries(r)) if (k !== 'dominio' && v !== undefined) console.log(`  ${k}: ${Array.isArray(v) ? (v.length ? '\n    ' + v.join('\n    ') : '-') : v}`);
  }
})();
