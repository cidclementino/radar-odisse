// Documentos do PNCP: o contrato assinado e o termo de referência da contratação (links para consulta
// rápida) e o que dá para tirar do texto do termo de referência nos contratos só de projeto (área,
// fases, disciplinas, prazo), para o mapa de preços. Funções puras, testadas sem rede; a busca fica
// em parsers/pncp-documentos.js. Ver LICITACOES.md, "Documentos e termo de referência".

const { normalizeText } = require('./normalize');

// tipoDocumentoId do PNCP (pncp.gov.br/app/entidades-dominio)
const TIPO = { AVISO_DIRETA: 1, EDITAL: 2, MINUTA_CONTRATO: 3, TERMO_REFERENCIA: 4, PROJETO_BASICO: 6, ETP: 7, PROJETO_EXECUTIVO: 8 };

const doc = d => (d && d.url ? { url: d.url, titulo: (d.titulo || d.tipoDocumentoNome || '').trim().slice(0, 140) || null, tipo: d.tipoDocumentoNome || null } : null);
const ativos = arquivos => (Array.isArray(arquivos) ? arquivos.filter(d => d && d.url && d.statusAtivo !== false) : []);

/** O documento assinado entre os arquivos do contrato (o primeiro "Contrato"; senão o primeiro). */
function escolherContrato(arquivos) {
  const lista = ativos(arquivos);
  return doc(lista.find(d => /contrato/i.test(d.tipoDocumentoNome || '')) || lista[0]);
}

/**
 * O termo de referência entre os arquivos da contratação. Muitos órgãos não publicam o TR em separado:
 * na falta dele vale o projeto básico, um arquivo com "termo de referência" no título, o edital (que
 * costuma trazer o TR como anexo) ou o aviso de contratação direta.
 */
function escolherTR(arquivos) {
  const lista = ativos(arquivos);
  const titulo = d => normalizeText(d.titulo);
  const ordem = [
    d => d.tipoDocumentoId === TIPO.TERMO_REFERENCIA,
    d => /termo de referencia|\btr\b/.test(titulo(d)),
    d => d.tipoDocumentoId === TIPO.PROJETO_BASICO,
    d => d.tipoDocumentoId === TIPO.EDITAL && /edital/.test(titulo(d)),
    d => d.tipoDocumentoId === TIPO.EDITAL,
    d => d.tipoDocumentoId === TIPO.AVISO_DIRETA,
  ];
  for (const teste of ordem) {
    const achado = lista.find(teste);
    if (achado) return doc(achado);
  }
  return null;
}

/** O edital (abertas). */
function escolherEdital(arquivos) {
  return doc(ativos(arquivos).find(d => d.tipoDocumentoId === TIPO.EDITAL));
}

// ---------------------------------------------------------------- leitura do termo de referência

const FASES = [
  ['levantamento', /levantamento (cadastral|arquitetonico|fisico|planialtimetrico|topografico)|\bas is\b/],
  ['estudo_preliminar', /estudos? preliminar/],
  ['anteprojeto', /anteprojet/],
  ['projeto_legal', /projeto legal|aprovacao (junto|na|no|nos|nas|perante)|\balvara\b/],
  ['projeto_basico', /projetos? basicos?/],
  ['projeto_executivo', /projetos? executivos?/],
  ['detalhamento', /detalhamento/],
  ['as_built', /as ?built/],
  ['assistencia_obra', /assistencia tecnica (a|na|durante a) (execucao|obra)|acompanhamento (tecnico )?(da|das) obras?|assessoramento (a|durante a) obra/],
];
const DISCIPLINAS = [
  ['arquitetura', /arquitetonic|projetos? (\S+ ){0,2}?de arquitetura|servicos de arquitetura|arquitetura e urbanismo/],
  ['interiores', /interiores|layout|mobiliario/],
  ['paisagismo', /paisagis/],
  ['urbanismo', /urbanis/],
  ['restauro', /restaur/],
  ['estrutura', /estrutura(l|is)|fundac/],
  ['eletrica', /eletric/],
  ['hidrossanitario', /hidrossanit|hidraulic|sanitari/],
  ['incendio', /incendio|pscip|avcb/],
  ['climatizacao', /climatiza|ar condicionado|hvac/],
  ['dados_e_voz', /cabeamento|rede logica|dados e voz|telecomunica/],
  ['spda', /spda|descargas atmosfericas/],
  ['orcamento', /planilha orcamentaria|orcamento/],
  ['acessibilidade', /acessibilidade|nbr 9050/],
];

// "1.234,56 m²", "450 m2", "450,00 metros quadrados" (a área e o trecho em volta)
const RE_AREA = /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s*(m²|m2|m 2|metros quadrados)(?![\w])/gi;
const RE_HECTARE = /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s*(ha|hectares?)\b/gi;
// O que diz que o número é a área do objeto (e não preço por m², espessura, etc.)
const RE_AREA_DO_OBJETO = /\b(area|areas)\s+(total|construida|construidas|edificada|util|de intervencao|de projeto|do imovel|do terreno|aproximada|estimada|a ser|de aproximadamente|de cerca)|\bcom (cerca de |aproximadamente )?\d/;
// Logo antes do número (texto já normalizado, sem "$"): é preço, custo ou medida de outra coisa.
const RE_NAO_AREA = /(\br\s*$|\bus\s*$|preco|valor|custo|\bcub\b|espessura|largura|altura|comprimento)/;

const numeroBR = s => Number(String(s).replace(/\./g, '').replace(',', '.'));
const trecho = (texto, ini, fim, folga = 90) => texto.slice(Math.max(0, ini - folga), Math.min(texto.length, fim + folga)).replace(/\s+/g, ' ').trim();

/**
 * Lê o texto do TR. Devolve { area_m2, areas, fases, disciplinas, bim, prazo } — tudo palpite:
 * os trechos vão junto para conferir no documento.
 */
function lerTR(textoBruto) {
  const texto = String(textoBruto || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  if (texto.replace(/\s/g, '').length < 200) return { legivel: false };
  const t = normalizeText(texto);

  const areas = [];
  const vistos = new Set();
  for (const [re, fator, unidade] of [[RE_AREA, 1, 'm²'], [RE_HECTARE, 10000, 'ha']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(texto)) && areas.length < 12) {
      const valor = numeroBR(m[1]) * fator;
      if (!(valor >= 4) || valor > 50000000) continue;
      const ctx = trecho(texto, m.index, m.index + m[0].length);
      const ctxN = normalizeText(trecho(texto, m.index, m.index + m[0].length, 60));
      const antes = normalizeText(texto.slice(Math.max(0, m.index - 30), m.index));
      if (RE_NAO_AREA.test(antes)) continue;
      const chave = `${valor}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      areas.push({ m2: Math.round(valor * 100) / 100, unidade, trecho: ctx.slice(0, 240), do_objeto: RE_AREA_DO_OBJETO.test(ctxN) });
    }
  }
  // Melhor palpite: a primeira que o texto diz ser a área do objeto; senão, a maior.
  const area = areas.find(a => a.do_objeto) || [...areas].sort((a, b) => b.m2 - a.m2)[0] || null;

  const prazoM = texto.match(/prazo (de|para)? ?(a )?(execu[çc][ãa]o|entrega|conclus[ãa]o|vig[êe]ncia|elabora[çc][ãa]o)[^.;]{0,80}?(\d{1,3})\s*(\([^)]{0,30}\)\s*)?(dias|meses|semanas)/i);

  return {
    legivel: true,
    area_m2: area ? area.m2 : null,
    areas: areas.slice(0, 5),
    fases: FASES.filter(([, re]) => re.test(t)).map(([k]) => k),
    disciplinas: DISCIPLINAS.filter(([, re]) => re.test(t)).map(([k]) => k),
    bim: /\bbim\b|modelagem da informacao/.test(t),
    prazo: prazoM ? { valor: Number(prazoM[4]), unidade: prazoM[6].toLowerCase(), trecho: trecho(texto, prazoM.index, prazoM.index + prazoM[0].length, 20).slice(0, 200) } : null,
  };
}

module.exports = { escolherContrato, escolherTR, escolherEdital, lerTR, TIPO };
