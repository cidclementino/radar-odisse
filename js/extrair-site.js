// Radar Odisse — leitura do site oficial de um concurso
//
// Recebe o HTML de uma página e devolve o que dá para tirar dela: banner, descrição, datas (com o
// tipo de prazo e o trecho onde apareceram), taxas, prêmios, júri, quem pode participar, local,
// documentos (regulamento, edital, brief), contatos e links para outras páginas do mesmo site que
// valem a leitura (regras, prêmios, cronograma…).
//
// Só usa texto e expressões regulares — sem DOM — para rodar igual no navegador (página de
// Acompanhamento) e no Node (scripts/completar-concursos.js, na coleta semanal).
// É heurística: os trechos vão para a tela junto com o valor, para conferir no próprio site.

(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.ExtrairSite = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const MESES = {
    jan: 1, january: 1, janeiro: 1, feb: 2, february: 2, fevereiro: 2, fev: 2, mar: 3, march: 3, marco: 3, 'março': 3,
    apr: 4, april: 4, abril: 4, abr: 4, may: 5, maio: 5, mai: 5, jun: 6, june: 6, junho: 6, jul: 7, july: 7, julho: 7,
    aug: 8, august: 8, agosto: 8, ago: 8, sep: 9, sept: 9, september: 9, setembro: 9, set: 9, oct: 10, october: 10,
    outubro: 10, out: 10, nov: 11, november: 11, novembro: 11, dec: 12, december: 12, dezembro: 12, dez: 12,
  };
  const NOME_MES = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');

  // padrões de data, do mais específico para o mais genérico
  const RE_DATAS = [
    // March 14, 2027 · Mar 14th 2027 · Sunday, Oct 4, 2026
    { re: new RegExp(`\\b(${NOME_MES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), d: m => [m[3], MESES[m[1].toLowerCase()], m[2]] },
    // 14 March 2027 · 14th of March, 2027 · 14 de março de 2027
    { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|º)?\\s+(?:of\\s+|de\\s+)?(${NOME_MES})\\.?,?\\s+(?:de\\s+)?(\\d{4})\\b`, 'gi'), d: m => [m[3], MESES[m[2].toLowerCase()], m[1]] },
    // 2027-03-14
    { re: /\b(20\d{2})-(\d{2})-(\d{2})\b/g, d: m => [m[1], m[2], m[3]] },
    // 14/03/2027 · 14.03.2027 (dia primeiro, como no Brasil e na Europa)
    { re: /\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/g, d: m => [m[3], m[2], m[1]] },
  ];

  // tipo do prazo pelo texto logo antes da data (a primeira regra que bater vence)
  const TIPOS = [
    { tipo: 'early', re: /early[\s-]?bird|advance[d]?\s+regist|desconto|promocional|1st\s+round\s+regist/i },
    { tipo: 'perguntas', re: /question|clarification|q\s?&\s?a|perguntas|esclarecimento|consultas/i },
    { tipo: 'resultado', re: /result|winner|announce|ceremony|jury\s+(meeting|deliberat)|resultado|vencedor|premia[çc][ãa]o|divulga/i },
    { tipo: 'entrega', re: /submi|upload|hand[\s-]?in|deliver|entrega|envio|deadline\s+for\s+(entries|projects|proposals)|projects?\s+due/i },
    { tipo: 'inscricao', re: /regist|inscri|sign[\s-]?up|enrol|apply\s+by|application/i },
    { tipo: 'abertura', re: /launch|opens?\b|opening|lan[çc]amento|abertura|start/i },
    { tipo: 'prazo', re: /deadline|due|closes?|closing|prazo|até|until/i },
  ];

  const RE_DINHEIRO = /(?:US\$|R\$|A\$|C\$|€|\$|£|¥|₹|\b(?:USD|EUR|GBP|BRL|CHF|AUD|CAD|JPY|INR|AED|SAR)\s?)\s?\d[\d.,]*(?:\s?(?:k|mil|million|thousand|milhões))?|\b\d[\d.,]*\s?(?:€|EUR|USD|GBP|BRL|euros?|dollars?|reais)\b/i;

  function decodificar(s) {
    return s
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
      .replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&euro;/g, '€').replace(/&pound;/g, '£')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  }

  function absoluto(href, base) {
    try { return new URL(decodificar(href), base).href; } catch { return null; }
  }

  function meta(html, nome) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]*content=["']([^"']+)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${nome}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    return m ? decodificar(m[1]).trim() : null;
  }

  /** HTML → linhas de texto legível */
  function textoDe(html) {
    const corpo = html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer|\/dt|\/dd|\/td|\/th|hr)[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' ');
    return decodificar(corpo)
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(l => l.length > 1);
  }

  function dataISO(a, m, d) {
    const ano = Number(a), mes = Number(m), dia = Number(d);
    if (!ano || !mes || !dia || mes > 12 || dia > 31) return null;
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  function cortar(s, n = 220) {
    s = s.trim();
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }

  function acharDatas(linhas) {
    const hoje = Date.now();
    const min = hoje - 120 * 86400000;
    const max = hoje + 3 * 365 * 86400000;
    const achadas = [];
    linhas.forEach((linha, i) => {
      // o rótulo às vezes vem na linha anterior ("Registration deadline" / "March 14, 2027")
      const anterior = i > 0 && linhas[i - 1].length < 80 ? linhas[i - 1] + ' ' : '';
      const ocupado = [];
      for (const { re, d } of RE_DATAS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(linha))) {
          if (ocupado.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
          ocupado.push([m.index, m.index + m[0].length]);
          const iso = dataISO(...d(m));
          if (!iso) continue;
          const t = new Date(iso + 'T12:00:00').getTime();
          if (Number.isNaN(t) || t < min || t > max) continue;
          // o rótulo é o texto antes da data na própria linha; a linha anterior só conta quando a
          // data vem sozinha (senão "Early bird: …" contaminaria a linha seguinte)
          const prefixo = linha.slice(0, m.index);
          const antes = (prefixo.replace(/[\s•:–-]/g, '').length < 3 ? anterior + prefixo : prefixo).slice(-110);
          const tipo = (TIPOS.find(x => x.re.test(antes)) || { tipo: 'outra' }).tipo;
          achadas.push({ tipo, data: iso, trecho: cortar(anterior && !/\d{4}/.test(anterior) ? anterior + linha : linha) });
        }
      }
    });
    const vistas = new Set();
    return achadas
      .filter(x => { const k = x.tipo + x.data; if (vistas.has(k)) return false; vistas.add(k); return true; })
      .sort((a, b) => a.data.localeCompare(b.data))
      .slice(0, 30);
  }

  function linhasCom(linhas, re, { max = 6, filtro = null } = {}) {
    const out = [];
    for (const l of linhas) {
      if (l.length < 12 || l.length > 600) continue;
      if (!re.test(l)) continue;
      if (filtro && !filtro(l)) continue;
      const c = cortar(l, 260);
      if (!out.includes(c)) out.push(c);
      if (out.length >= max) break;
    }
    return out;
  }

  function links(html, base) {
    const out = [];
    const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && out.length < 600) {
      const url = absoluto(m[1], base);
      if (!url || !/^https?:/i.test(url)) continue;
      const texto = decodificar(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      out.push({ url, texto });
    }
    return out;
  }

  const RE_DOC = /\b(brief|rules|regulations?|terms|guidelines|competition\s+pack|programme|program|regulamento|edital|termo\s+de\s+refer|bases|anexo|kit)\b/i;
  const RE_PAGINA_UTIL = /\b(rules|regulations?|brief|faq|prizes?|awards?|jury|judges|timeline|schedule|calendar|dates|deadlines?|how[\s-]to|register|registration|participate|entry|submission|fees?|regulamento|edital|cronograma|premia[çc][ãa]o|j[úu]ri|inscri[çc][õo]es|como\s+participar)\b/i;

  /**
   * @param {string} html
   * @param {string} url  endereço da página (para resolver links relativos)
   */
  function extrairSite(html, url) {
    html = String(html || '').slice(0, 1500000);
    const linhas = textoDe(html);
    const todosLinks = links(html, url);
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ok */ }

    const imagemBruta = meta(html, 'og:image') || meta(html, 'og:image:url') || meta(html, 'twitter:image') || meta(html, 'twitter:image:src');
    const tituloTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];

    const documentos = [];
    const relacionadas = [];
    for (const l of todosLinks) {
      const ehPdf = /\.pdf(\?|$)/i.test(l.url);
      if ((ehPdf || RE_DOC.test(l.texto)) && !documentos.some(d => d.url === l.url) && documentos.length < 10) {
        documentos.push({ texto: cortar(l.texto || l.url.split('/').pop(), 90), url: l.url });
      }
      let mesmoSite = false;
      try { mesmoSite = new URL(l.url).hostname.replace(/^www\./, '') === host; } catch { /* ok */ }
      if (mesmoSite && !ehPdf && l.url.split('#')[0] !== String(url).split('#')[0]
        && (RE_PAGINA_UTIL.test(l.texto) || RE_PAGINA_UTIL.test(l.url.replace(/[-_/]/g, ' ')))
        && !relacionadas.includes(l.url) && relacionadas.length < 6) {
        relacionadas.push(l.url);
      }
    }

    const emails = [...new Set([
      ...[...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map(m => decodificar(m[1])),
      ...linhas.join(' ').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [],
    ])].filter(e => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e) && !/sentry|example|wixpress/i.test(e)).slice(0, 4);

    const descricao = meta(html, 'og:description') || meta(html, 'description') || meta(html, 'twitter:description')
      || linhas.find(l => l.length > 140 && !/cookie/i.test(l)) || null;

    return {
      url,
      titulo: meta(html, 'og:title') || (tituloTag ? decodificar(tituloTag).replace(/\s+/g, ' ').trim() : null),
      descricao: descricao ? cortar(descricao, 600) : null,
      imagem: imagemBruta ? absoluto(imagemBruta, url) : null,
      datas: acharDatas(linhas),
      taxas: linhasCom(linhas, RE_DINHEIRO, { filtro: l => /fee|regist|entry|inscri|taxa|price|cost|pay|early|late|standard/i.test(l) && !/prize|winner|award(ed)?\s+(of|with)|1st|first\s+place|prêmio|premia/i.test(l) }),
      premios: linhasCom(linhas, /prize|winner|1st|2nd|3rd|first\s+place|honou?rable|mention|award(ed)?\s+(of|with)|pr[êe]mio|premia|vencedor|men[çc][ãa]o/i, { filtro: l => RE_DINHEIRO.test(l) || /honou?rable|mention|men[çc][ãa]o|publication|publica|exhibit|exposi/i.test(l) }),
      juri: linhasCom(linhas, /\bjury\b|juror|judges?\b|j[úu]ri|jurados|comiss[ãa]o\s+julgadora|banca/i, { max: 5 }),
      participantes: linhasCom(linhas, /open\s+to|eligib|who\s+can|participants?\s+(must|can|may)|teams?\s+of|requirements|podem\s+participar|participa[çc][ãa]o\s+(é|aberta)|estudantes|profissionais/i, { max: 5 }),
      local: linhasCom(linhas, /\blocation\b|\bsite\s*:|located\s+(in|at)|\blocal\s*:|localiza|\bterreno\b|\bcity\s+of\b/i, { max: 3 }),
      idioma: linhasCom(linhas, /\blanguage\b|\bidioma\b/i, { max: 2 }),
      documentos,
      emails,
      relacionadas,
    };
  }

  /** junta o resultado de várias páginas do mesmo concurso */
  function juntar(resultados) {
    const [principal, ...outras] = resultados.filter(Boolean);
    if (!principal) return null;
    const uniq = (arr, k = x => x) => { const v = new Set(); return arr.filter(x => { const c = k(x); if (v.has(c)) return false; v.add(c); return true; }); };
    const r = { ...principal };
    for (const o of outras) {
      r.imagem = r.imagem || o.imagem;
      r.descricao = r.descricao || o.descricao;
      for (const k of ['taxas', 'premios', 'juri', 'participantes', 'local', 'idioma', 'emails']) r[k] = uniq([...(r[k] || []), ...(o[k] || [])]).slice(0, 8);
      r.documentos = uniq([...(r.documentos || []), ...(o.documentos || [])], d => d.url).slice(0, 12);
      r.datas = uniq([...(r.datas || []), ...(o.datas || [])], d => d.tipo + d.data).sort((a, b) => a.data.localeCompare(b.data)).slice(0, 40);
    }
    r.paginas = resultados.filter(Boolean).map(x => x.url);
    delete r.relacionadas;
    return r;
  }

  /** melhor palpite para os campos do concurso a partir das datas achadas */
  function palpites(r) {
    if (!r) return {};
    const ultima = tipo => (r.datas || []).filter(d => d.tipo === tipo).map(d => d.data).sort().pop() || null;
    const inscricao = ultima('inscricao');
    let entrega = ultima('entrega');
    // "Deadline: ..." sem dizer de quê costuma ser a entrega
    if (!entrega && !inscricao) entrega = ultima('prazo');
    return { imagem_url: r.imagem || null, inscricao_fim: inscricao, entrega_fim: entrega, resultado_previsto: ultima('resultado') };
  }

  return { extrairSite, juntar, palpites, textoDe };
});
