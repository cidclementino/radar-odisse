// Parser: competitions.archi
//
// ATENÇÃO — seletores best-effort: este parser faz scraping de HTML (não há
// RSS confirmado nem acesso validado ao /wp-json/ a partir do sandbox), escrito
// a partir do padrão observado nas páginas reais do site (rede do sandbox não
// alcança competitions.archi). Pode precisar de ajuste fino na primeira rodada
// real — mesma ressalva do parsers/olx.js.
//
// Estratégia: duas etapas.
//   1. Páginas de listagem (/cat/all-competitions/, /cat/awards/) — texto
//      "Submission: X Registration: Y Location: Z Language: W Prizes: V Type: T"
//      logo antes/depois do link pra /competition/<slug>/. Extração por âncora +
//      regex no bloco de texto ao redor, não por classe CSS (mais resiliente).
//   2. Página de detalhe de cada item novo — só ela tem o link oficial de
//      verdade (CTA "Visit Organizer's Website") e as Categories reais do post,
//      que a listagem não expõe.
//
// FILTRO DE SEÇÃO: só /cat/all-competitions/ e /cat/awards/ são chamada aberta.
// /cat/results/ é concurso já julgado (mesmo problema do "Premiados" no
// concursosdeprojeto.org) e /cat/articles/ é conteúdo editorial — nenhum dos
// dois entra aqui.
//
// OTIMIZAÇÃO DE COLETA: o `id` de um Concurso é determinístico (hash de
// fonte+link+titulo — ver generateId em lib/normalize.js), e a listagem já
// entrega link+titulo. Então dá pra saber se o item já é conhecido ANTES de
// gastar o fetch de detalhe. `parse(idsConhecidos)` recebe o Set de ids que
// o Worker já tem (ver scripts/collect-and-send.js) e pula o fetch de
// detalhe — e nem reenvia o item — pra tudo que já está cadastrado.
//
// DECISÃO — "Location: Concept": mantido literal (não normalizado pra
// `null`). "Concept" é informação real (competição de ideias, sem terreno
// físico), não um placeholder de dado ausente.

const cheerio = require('cheerio');
const { generateId, extractDates } = require('./lib/normalize');

const FONTE = 'competitions.archi';
const BASE = 'https://competitions.archi';

// Categorias-fonte de chamada aberta (ver tabela de decisões no RADAR.md).
const CATEGORIAS_LISTAGEM = ['all-competitions', 'awards'];

// Cron semanal só precisa do que é novo; dedup por `id` no worker cobre o
// resto — não vale a pena varrer o histórico inteiro toda semana.
const PAGINAS_MAX = 2;

// Delay entre requests pra não sobrecarregar o site (nem levar rate-limit).
const DELAY_MS = 400;

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; OdisseRadarBot/1.0)' };

// Categorias que são navegação do site, não classificação real do post —
// aparecem em toda página (menu) e não devem virar `escopo`/`destinado_a`.
const CATS_NAVEGACAO = new Set([
  'all competitions', 'awards', 'articles', 'results', 'publish',
  'newsletter', 'yearbook 2025', 'archive',
]);

const REGEX_LINK_COMPETICAO = /^https:\/\/competitions\.archi\/competition\/([^/]+)\/?$/;

const REGEX_BLOCO = /Submission:\s*([^R]+?)\s*Registration:\s*([^L]+?)\s*Location:\s*([^L]+?)\s*Language:\s*([^P]+?)\s*Prizes:\s*([^T]+?)(?:\s*Type:\s*(.+))?$/i;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Sobe pelos ancestrais até achar um bloco de texto com o cabeçalho Submission/Registration. */
function acharBlocoListagem($, $anchor) {
  let $el = $anchor;
  for (let i = 0; i < 6; i++) {
    const texto = $el.text();
    if (/Submission:/i.test(texto) && /Registration:/i.test(texto)) return $el;
    if (!$el.parent().length) break;
    $el = $el.parent();
  }
  return null;
}

/** Extrai os campos estruturados do cabeçalho (Submission/Registration/Location/...). */
function extrairCabecalho(textoBloco) {
  const m = textoBloco.match(REGEX_BLOCO);
  if (!m) return null;
  const [, submission, registration, location, , prizes, type] = m;
  return {
    submissionTexto: submission.trim(),
    registrationTexto: registration.trim(),
    location: location.trim(),
    prizes: prizes.trim(),
    type: type ? type.trim() : null,
  };
}

// Decisão: manter o texto de "Location:" literal, mesmo quando é algo como
// "Concept" (competição de ideias, sem terreno físico) — é informação real
// sobre a natureza do concurso, não um placeholder pra descartar. Só vira
// `null` se a listagem não trouxer o campo de jeito nenhum.
function normalizarLocal(local) {
  return local ? local : null;
}

function normalizarPremio(prizes) {
  if (!prizes) return null;
  if (/^view website$/i.test(prizes)) return null; // sem valor estruturado, remete ao site
  return prizes;
}

/** Heurística de fallback por keyword no título — usada só se as Categories da página de detalhe não renderem nada útil. */
function classificarEscopoPorTitulo(titulo) {
  const t = (titulo || '').toLowerCase();
  const escopo = [];
  if (/urban/.test(t)) escopo.push('urbanismo');
  if (/landscape/.test(t)) escopo.push('paisagismo');
  if (/furniture|product design|interior/.test(t)) escopo.push('design_produto_mobiliario');
  if (escopo.length === 0) escopo.push('arquitetura');
  return escopo;
}

/** Mapeia Categories reais do WordPress (página de detalhe) pro schema de escopo do Radar. */
function classificarEscopoPorCategorias(categorias) {
  const texto = categorias.join(' ').toLowerCase();
  const escopo = [];
  if (/urban/.test(texto)) escopo.push('urbanismo');
  if (/landscape/.test(texto)) escopo.push('paisagismo');
  if (/furniture|product design|interior design/.test(texto)) escopo.push('design_produto_mobiliario');
  if (escopo.length === 0 || /architect/.test(texto)) escopo.unshift('arquitetura');
  return [...new Set(escopo)];
}

/** Busca uma página de listagem e devolve os itens "crus" (sem link oficial, sem categories reais ainda). */
async function buscarPaginaListagem(categoria, pagina) {
  const url = pagina === 1
    ? `${BASE}/cat/${categoria}/`
    : `${BASE}/cat/${categoria}/page/${pagina}/`;

  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`competitions.archi retornou ${res.status} para ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const vistos = new Set(); // um item aparece várias vezes (thumb + título) na mesma listagem
  const itens = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(REGEX_LINK_COMPETICAO);
    if (!m) return;

    const linkCanonico = `${BASE}/competition/${m[1]}/`;
    if (vistos.has(linkCanonico)) return;

    const $bloco = acharBlocoListagem($, $(el));
    if (!$bloco) return; // provavelmente um link de navegação/thumb solto, não um card de competição

    const cabecalho = extrairCabecalho($bloco.text().replace(/\s+/g, ' ').trim());
    if (!cabecalho) return;

    // Título: costuma ser o texto do próprio link, ou de um <a> vizinho em negrito.
    const titulo = ($(el).attr('title') || $(el).text() || '').trim();
    if (!titulo) return;

    vistos.add(linkCanonico);
    itens.push({ link: linkCanonico, titulo, ...cabecalho });
  });

  return itens;
}

/** Busca a página de detalhe e extrai link oficial + categories reais + indício de banca definida. */
async function buscarDetalhe(item) {
  const res = await fetch(item.link, { headers: UA });
  if (!res.ok) throw new Error(`competitions.archi retornou ${res.status} para ${item.link}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Link oficial: o CTA explícito, identificado por texto (não por classe).
  let linkOficial = null;
  $('a[href]').each((_, el) => {
    if (linkOficial) return;
    const texto = $(el).text().trim().toLowerCase();
    if (texto.includes("visit organizer's website") || texto.includes('visit organizers website')) {
      linkOficial = $(el).attr('href') || null;
    }
  });

  // Categories reais do post — filtra fora as de navegação (menu do site).
  const categorias = [];
  $('a[href*="/cat/"]').each((_, el) => {
    const texto = $(el).text().trim();
    if (texto && !CATS_NAVEGACAO.has(texto.toLowerCase())) categorias.push(texto);
  });

  // Indício de banca definida: seção JURY com conteúdo além de "TBA"/"to be announced".
  const textoCompleto = $.text();
  let bancaDefinida = null;
  const idxJury = textoCompleto.search(/JURY/i);
  if (idxJury !== -1) {
    const trechoJury = textoCompleto.slice(idxJury, idxJury + 500);
    if (/to be announced|\bTBA\b/i.test(trechoJury)) bancaDefinida = false;
    else bancaDefinida = true;
  }

  const imagemUrl = $('meta[property="og:image"]').attr('content') || null;

  return { linkOficial, categorias, bancaDefinida, imagemUrl };
}

/**
 * @param {Set<string>} idsConhecidos - ids de Concurso já existentes no Worker
 *   (ver scripts/collect-and-send.js). Opcional — se não vier, roda sem a
 *   otimização de skip (busca detalhe de tudo, igual antes).
 *
 * Como o `id` é determinístico (hash de fonte+link+titulo, ver generateId em
 * lib/normalize.js) e a listagem já entrega link+titulo, dá pra calcular o id
 * ANTES de gastar o fetch de detalhe. Se o Worker já conhece esse id, pula o
 * fetch de detalhe inteiro — a competição já foi processada numa rodada
 * anterior, não há nada novo a extrair de página que não muda.
 */
async function parse(idsConhecidos = new Set()) {
  const brutos = [];
  for (const categoria of CATEGORIAS_LISTAGEM) {
    for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
      try {
        const itens = await buscarPaginaListagem(categoria, pagina);
        if (itens.length === 0) break; // acabou a paginação dessa categoria
        brutos.push(...itens);
      } catch (err) {
        console.error(`[competitions.archi] falhou em /cat/${categoria}/page/${pagina}/:`, err.message);
      }
      await sleep(DELAY_MS);
    }
  }

  // Dedup por link antes de gastar request de detalhe (item pode repetir entre
  // /cat/all-competitions/ e /cat/awards/).
  const porLink = new Map();
  for (const item of brutos) {
    if (!porLink.has(item.link)) porLink.set(item.link, item);
  }

  let puladosPorJaConhecidos = 0;
  const concursos = [];
  for (const item of porLink.values()) {
    const id = generateId(FONTE, item.link, item.titulo);

    if (idsConhecidos.has(id)) {
      puladosPorJaConhecidos++;
      continue; // já cadastrado — não busca detalhe, não reenvia
    }

    let detalhe = { linkOficial: null, categorias: [], bancaDefinida: null, imagemUrl: null };
    try {
      detalhe = await buscarDetalhe(item);
    } catch (err) {
      console.error(`[competitions.archi] falhou ao buscar detalhe de ${item.link}:`, err.message);
      // segue sem os campos de detalhe — melhor entrar incompleto (revisão manual)
      // do que não entrar de jeito nenhum, contanto que os campos fiquem `null`.
    }
    await sleep(DELAY_MS);

    // Defensivo: se por algum motivo um item de Results vazou pro crawl, descarta.
    if (detalhe.categorias.some(c => /results/i.test(c))) continue;

    const { inscricao_fim, entrega_fim } = extractDates(
      `Registration: ${item.registrationTexto} Submission: ${item.submissionTexto}`
    );

    const escopo = detalhe.categorias.length > 0
      ? classificarEscopoPorCategorias(detalhe.categorias)
      : classificarEscopoPorTitulo(item.titulo);

    concursos.push({
      id,
      nome: item.titulo,
      promotor: null, // não estruturado nem na listagem nem no detalhe — revisão manual
      local_projeto: normalizarLocal(item.location),
      destinado_a: item.type || null,
      escopo,
      tipo: 'internacional', // fonte é global por natureza (ver RADAR.md)
      imagem_url: detalhe.imagemUrl,
      premio: normalizarPremio(item.prizes),

      inscricao: { gratuita: null, custo: null, obs: null },

      banca_definida: detalhe.bancaDefinida,
      banca_obs: null,

      datas: {
        inscricao_fim,
        entrega_fim,
        resultado_previsto: null,
        texto_bruto: `Submission: ${item.submissionTexto} | Registration: ${item.registrationTexto}`,
      },

      link_oficial: detalhe.linkOficial, // null se não achou o CTA — nunca usa o link do agregador
      status_interno: 'monitorando',
      motivo_descarte: null,

      fontes: [FONTE],
      fonte_url_original: item.link,
      coletado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    });
  }

  if (puladosPorJaConhecidos > 0) {
    console.log(`[competitions.archi] ${puladosPorJaConhecidos} item(ns) já conhecido(s) — detalhe não buscado.`);
  }

  return concursos;
}

module.exports = { parse, FONTE };

// Permite rodar `node parsers/competitionsarchi.js` isoladamente pra depuração.
if (require.main === module) {
  parse()
    .then(items => console.log(JSON.stringify(items, null, 2)))
    .catch(err => {
      console.error('Erro ao coletar competitions.archi:', err.message);
      process.exit(1);
    });
}
