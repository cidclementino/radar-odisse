// Parser: Vitruvius (jornal › concursos)
//
// A seção de concursos do Vitruvius (vitruvius.com.br/jornal/concursos) não tem feed; o arquivo
// em /pesquisa/jornal/contests lista título, instituição e prazo ("em 25/05/2024" ou
// "de 29/08/2023 a 19/10/2023"), do mais recente para o mais antigo.
//
// SITUAÇÃO EM NOV/2026: a seção parou em maio de 2024 (último item: /jornal/contests/read/900).
// O parser fica ligado para pegar sozinho se o Vitruvius voltar a publicar; até lá devolve zero.
// Só entram itens com prazo de inscrição ainda aberto. O texto completo é lido da página de cada
// item novo (datas, link oficial e imagem via js/extrair-site.js).

const cheerio = require('cheerio');
const { generateId } = require('./lib/normalize');
const { extrairSite, palpites } = require('../js/extrair-site.js');

const FONTE = 'vitruvius.com.br';
const ARQUIVO = 'https://vitruvius.com.br/pesquisa/jornal/contests?sort=date';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function baixar(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

const iso = br => { const m = String(br).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function classificarEscopo(t) {
  t = t.toLowerCase();
  const e = [];
  if (/urban|cidade|bairro|pra[çc]a/.test(t)) e.push('urbanismo');
  if (/paisag|parque|jardim/.test(t)) e.push('paisagismo');
  if (/mobili|design|cartaz|gr[áa]fic/.test(t)) e.push('design_produto_mobiliario');
  if (!e.length || /arquitet/.test(t)) e.unshift('arquitetura');
  return [...new Set(e)];
}

async function parse(idsConhecidos = new Set()) {
  const $ = cheerio.load(await baixar(ARQUIVO));
  const hoje = new Date().toISOString().slice(0, 10);
  const linhas = $('.table-entry').map((_, el) => {
    const a = $(el).find('a[href*="/jornal/contests/read/"]').first();
    const prazoTexto = $(el).find('.grid_2.omega').text().replace(/\s+/g, ' ').trim();
    const datas = prazoTexto.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
    return {
      titulo: a.text().replace(/\s+/g, ' ').trim(),
      link: a.attr('href'),
      instituicao: $(el).find('.grid_2').not('.omega').text().replace(/\s+/g, ' ').trim() || null,
      inscricao_fim: iso(datas[datas.length - 1]),
    };
  }).get().filter(l => l.titulo && l.link);

  const abertos = linhas.filter(l => !l.inscricao_fim || l.inscricao_fim >= hoje);
  console.log(`[${FONTE}] ${linhas.length} no arquivo, ${abertos.length} com inscrições abertas.`);

  const concursos = [];
  for (const l of abertos) {
    const id = generateId(FONTE, l.link, l.titulo);
    if (idsConhecidos.has(id)) continue;
    let site = null;
    try { site = extrairSite(await baixar(l.link), l.link); } catch { /* fica só com o que veio do arquivo */ }
    const p = palpites(site);
    const externos = (site?.documentos || []).map(d => d.url).concat(site?.relacionadas || []);
    const [nome, ...resto] = l.titulo.split(/:\s+/);
    concursos.push({
      id,
      nome: resto.length && nome.length < 40 ? resto.join(': ') : l.titulo, // "IAB RJ: Premiação…" → "Premiação…"
      promotor: l.instituicao || (resto.length && nome.length < 40 ? nome : null),
      local_projeto: null,
      destinado_a: null,
      escopo: classificarEscopo(l.titulo),
      tipo: /[ãõçáéíóú]|\b(concurso|premia)/i.test(l.titulo) ? 'nacional' : 'internacional',
      imagem_url: site?.imagem || null,
      premio: null,
      inscricao: { gratuita: null, custo: null, obs: null },
      banca_definida: null,
      banca_obs: null,
      datas: {
        inscricao_fim: l.inscricao_fim || p.inscricao_fim || null,
        entrega_fim: p.entrega_fim || null,
        resultado_previsto: p.resultado_previsto || null,
        texto_bruto: (site?.descricao || '').slice(0, 500) || null,
      },
      link_oficial: externos.find(u => !/vitruvius\.com\.br/.test(u)) || null,
      status_interno: 'monitorando',
      motivo_descarte: null,
      fontes: [FONTE],
      fonte_url_original: l.link,
      coletado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    });
  }
  return concursos;
}

module.exports = { parse, FONTE };

if (require.main === module) {
  parse().then(itens => console.log(JSON.stringify(itens, null, 2))).catch(err => { console.error(err.message); process.exit(1); });
}
