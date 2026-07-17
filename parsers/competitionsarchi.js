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

// Resolve um href (relativo ou absoluto, com ou sem query string/hash) e
// devolve o link canônico de competição, ou `null` se não for um.
// FIX (pós primeira rodada real): a versão anterior usava um regex rígido
// que só batia com URL absoluta e sem query string — zerou os itens porque
// o WordPress provavelmente usa href relativo e/ou params (ex: ?utm_*).
// `new URL(href, BASE)` resolve os dois casos igual, sem precisar advinhar.
function resolverLinkCompeticao(href) {
  if (!href) return null;
  let url;
  try {
    url = new URL(href, BASE);
  } catch {
    return null;
  }
  if (url.hostname.replace(/^www\./, '') !== 'competitions.archi') return null;
  const m = url.pathname.match(/^\/competition\/([^/]+)\/?$/);
  if (!m) return null;
  return `${BASE}/competition/${m[1]}/`;
}

// Labels do cabeçalho, na ordem em que aparecem no site.
const CAMPOS_CABECALHO = ['Submission', 'Registration', 'Location', 'Language', 'Prizes', 'Type'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Sobe pelos ancestrais até achar um bloco de texto com o cabeçalho Submission/Registration. */
function acharBlocoListagem($, $anchor) {
  let $el = $anchor;
  // 8 níveis de folga (subi de 6 pra 8 depois da 1ª rodada real) — o bloco de
  // meta-informação (Submission/Registration/...) pode estar bem mais acima
  // na árvore do que o link do título, dependendo de como o tema organiza o
  // card.
  for (let i = 0; i < 8; i++) {
    const texto = $el.text();
    if (/Submission:/i.test(texto) && /Registration:/i.test(texto)) return $el;
    if (!$el.parent().length) break;
    $el = $el.parent();
  }
  return null;
}

/**
 * Extrai o valor de um campo do tipo "Label: valor" olhando pro próximo label
 * conhecido como fronteira, em vez de tentar excluir caracteres específicos —
 * a primeira versão (REGEX_BLOCO) usava `[^T]` como delimitador, que com a
 * flag /i exclui "t" minúsculo também, e quebrava em qualquer bloco de texto
 * real (que tem "t" a cada duas palavras).
 *
 * Duas etapas propositalmente separadas (uma tentativa de fundir as duas numa
 * regex só com lookahead + limite de tamanho fixo quebrou de novo: quando o
 * campo é o último do cabeçalho — ex: "Type", sem próximo label — o "fim da
 * string" real fica muito além do limite de tamanho, e as duas condições do
 * lookahead nunca se satisfazem ao mesmo tempo):
 *   1. Acha a posição do próximo label conhecido, sem limite de tamanho.
 *   2. Só corta num tamanho razoável (`MAX_TAMANHO_CAMPO`) se não achou
 *      nenhum próximo label — o que significa que o resto do texto é
 *      resumo/título da competição, não mais o cabeçalho.
 *
 * LIMITAÇÃO CONHECIDA: quando `Prizes` ou `Type` são o último campo presente
 * (sem outro label depois), o corte por tamanho é só uma redução de dano —
 * ainda pode vazar o início do título/resumo, porque o texto flatten (via
 * cheerio `.text()`) perde qualquer marcador de onde o valor de fato termina
 * (isso só se resolve olhando a estrutura HTML real, ex: se o valor está num
 * `<span>` próprio). Valores nesse caso podem sair imprecisos — melhor cair
 * pra revisão manual do que perder o item inteiro.
 */
const MAX_TAMANHO_CAMPO = 40;

function extrairCampo(texto, label) {
  const mLabel = texto.match(new RegExp(`\\b${label}\\s*:\\s*`, 'i'));
  if (!mLabel) return null;

  const aposLabel = texto.slice(mLabel.index + mLabel[0].length);
  const outros = CAMPOS_CABECALHO.filter(l => l !== label);

  let fim = null;
  for (const outro of outros) {
    const mOutro = aposLabel.match(new RegExp(`\\b${outro}\\s*:`, 'i'));
    if (mOutro && (fim === null || mOutro.index < fim)) fim = mOutro.index;
  }

  const valor = fim === null
    ? aposLabel.slice(0, MAX_TAMANHO_CAMPO) // sem próximo label -> resto é resumo/título, corta
    : aposLabel.slice(0, fim);

  const limpo = valor.trim();
  return limpo || null;
}

/** Extrai os campos estruturados do cabeçalho (Submission/Registration/Location/...). */
function extrairCabecalho(textoBloco) {
  const submission = extrairCampo(textoBloco, 'Submission');
  const registration = extrairCampo(textoBloco, 'Registration');
  // Submission + Registration são os dois campos que garantem que isso é de
  // fato um card de competição (todo item da listagem tem os dois) — sem
  // eles, não vale a pena tentar os outros campos.
  if (!submission || !registration) return null;

  return {
    submissionTexto: submission,
    registrationTexto: registration,
    location: extrairCampo(textoBloco, 'Location'),
    prizes: extrairCampo(textoBloco, 'Prizes'),
    type: extrairCampo(textoBloco, 'Type'),
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

/**
 * Escolhe o melhor candidato a título entre as âncoras que apontam pro mesmo
 * link. BUG CORRIGIDO: a versão anterior usava o texto da PRIMEIRA âncora
 * encontrada — em vários cards essa âncora envolve o card inteiro (imagem +
 * cabeçalho + resumo), então `nome` saía com o bloco inteiro colado, não só
 * o título (visível na interface — card mostrando o texto todo em vez do
 * nome do concurso).
 *
 * Estratégia: entre todas as âncoras pro mesmo link, descarta qualquer uma
 * cujo texto contenha "Submission:" (é o card inteiro, não é título) e fica
 * com a mais curta das que sobrarem — título de verdade é sempre bem mais
 * curto que um resumo. Se NENHUMA âncora sobrar (ou seja, o card inteiro é
 * uma coisa só, sem link de título isolado), cai no fallback: usa o texto
 * antes da primeira ocorrência de "Submission:" no bloco de cabeçalho — no
 * HTML observado, o título aparece colado logo antes desse ponto.
 */
function escolherTitulo($, anchors, textoBloco) {
  let melhor = null;
  for (const el of anchors) {
    const texto = ($(el).attr('title') || $(el).text() || '').trim().replace(/\s+/g, ' ');
    if (!texto || /Submission:/i.test(texto)) continue;
    if (!melhor || texto.length < melhor.length) melhor = texto;
  }
  if (melhor) return melhor;

  const idx = textoBloco.search(/Submission:/i);
  if (idx <= 0) return null;
  const candidato = textoBloco.slice(0, idx).trim();
  return candidato || null;
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

  // Diagnóstico — fica ligado por padrão (é só uma linha por página, ~4
  // linhas por rodada) porque foi exatamente a falta dela que deixou a
  // primeira rodada real (0 itens coletados) sem pista nenhuma do porquê.
  const anchorsCompeticao = $('a[href]').filter((_, el) => !!resolverLinkCompeticao($(el).attr('href'))).length;
  const mencoesSubmission = (html.match(/Submission:/gi) || []).length;
  console.log(`[competitions.archi] debug ${url}: status=${res.status} bytes=${html.length} links_competicao=${anchorsCompeticao} mencoes_submission=${mencoesSubmission}`);

  // Agrupa TODAS as âncoras por link canônico (não só a primeira) — um card
  // normalmente tem 2+ âncoras pro mesmo link (thumb + título), e precisamos
  // olhar todas pra achar a que tem só o título limpo.
  const anchorsPorLink = new Map();
  $('a[href]').each((_, el) => {
    const linkCanonico = resolverLinkCompeticao($(el).attr('href'));
    if (!linkCanonico) return;
    if (!anchorsPorLink.has(linkCanonico)) anchorsPorLink.set(linkCanonico, []);
    anchorsPorLink.get(linkCanonico).push(el);
  });

  const itens = [];
  let semBloco = 0;
  let semCabecalho = 0;
  let semTitulo = 0;

  for (const [linkCanonico, anchors] of anchorsPorLink) {
    let $bloco = null;
    for (const el of anchors) {
      $bloco = acharBlocoListagem($, $(el));
      if ($bloco) break;
    }
    if (!$bloco) { semBloco++; continue; } // provavelmente um link de navegação/thumb solto, não um card de competição

    const textoBloco = $bloco.text().replace(/\s+/g, ' ').trim();
    const cabecalho = extrairCabecalho(textoBloco);
    if (!cabecalho) { semCabecalho++; continue; }

    const titulo = escolherTitulo($, anchors, textoBloco);
    if (!titulo) { semTitulo++; continue; }

    itens.push({ link: linkCanonico, titulo, ...cabecalho });
  }

  console.log(`[competitions.archi] funil ${url}: itens_ok=${itens.length} sem_bloco=${semBloco} sem_cabecalho=${semCabecalho} sem_titulo=${semTitulo}`);

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
