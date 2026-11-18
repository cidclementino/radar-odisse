// Radar Odisse — Terrenos: oportunidades (terrenista/corretor) + perfis de corretor
//
// Duas vistas (cartões e lista) com os mesmos filtros, nas duas seções. Dados do Worker com cache
// no navegador (carregarComCache, em comum.js). Os corretores continuam sendo buscados na rede só
// quando a seção entra na tela; se já houver cópia guardada, aparecem na hora.

const OPORTUNIDADES_URL = `${WORKER}/api/oportunidades`;
const CORRETORES_URL = `${WORKER}/api/corretores`;

const STATUS_OCULTOS = new Set(['descartado', 'abordado']);

const NIVEL_LABELS = { 1: 'Nível 1 · Observação', 2: 'Nível 2 · Qualificado', 3: 'Nível 3 · Processo aberto' };
const NIVEL_CURTO = { 1: 'Observação', 2: 'Qualificado', 3: 'Processo aberto' };
const PERSONA_LABELS = { terrenista: 'Terrenista', corretor: 'Corretor' };
const FONTE_LABELS = { 'olx.com.br': 'OLX', 'zapimoveis.com.br': 'ZAP Imóveis', 'youtube.com': 'YouTube' };
const STATUS_LABELS = { monitorando: 'Monitorando', abordado: 'Abordado', descartado: 'Descartado' };

const fonteNome = f => FONTE_LABELS[f] || f;

let oportunidades = [];
let corretores = [];
let corretoresPorId = {};

// "Bessa, João Pessoa" → "João Pessoa"; "RM Recife" fica como está.
function cidadeDe(local) {
  if (!local) return null;
  const partes = String(local).split(',').map(s => s.trim()).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : null;
}

function nivelBate(nivel, filtro) {
  if (!filtro) return true;
  if (filtro === '2+') return nivel >= 2;
  return String(nivel) === filtro;
}

function etiquetaNivel(n, curto = false) {
  const classe = n >= 3 ? 'nivel-3' : n === 2 ? 'nivel-2' : 'nivel-1';
  return `<span class="u-etiqueta ${classe}">${escapeHTML(curto ? `${n} · ${NIVEL_CURTO[n] || ''}` : (NIVEL_LABELS[n] || `Nível ${n}`))}</span>`;
}

let vistaAtual = () => 'cartoes';

// ================================================================ OPORTUNIDADES

const FILTROS_OP_PADRAO = { busca: '', situacao: 'monitorando', nivel: '', persona: '', cidade: '', fonte: '', periodo: '' };
let filtrosOp = { ...FILTROS_OP_PADRAO, ...prefLer('terrenos:filtros', {}), busca: '' };

function passaOp(op) {
  if (filtrosOp.situacao === 'monitorando' && STATUS_OCULTOS.has(op.status_interno)) return false;
  if (filtrosOp.situacao === 'ocultas' && !STATUS_OCULTOS.has(op.status_interno)) return false;
  if (filtrosOp.busca) {
    const alvo = normalizar(`${op.titulo} ${op.local} ${op.texto_bruto || ''}`);
    if (!normalizar(filtrosOp.busca).split(/\s+/).filter(Boolean).every(t => alvo.includes(t))) return false;
  }
  if (!nivelBate(op.nivel_maturidade, filtrosOp.nivel)) return false;
  if (filtrosOp.persona && op.persona !== filtrosOp.persona) return false;
  if (filtrosOp.cidade && cidadeDe(op.local) !== filtrosOp.cidade) return false;
  if (filtrosOp.fonte && op.fonte !== filtrosOp.fonte) return false;
  if (filtrosOp.periodo) {
    const d = diasDesde(op.coletado_em);
    if (d === null || d > Number(filtrosOp.periodo)) return false;
  }
  return true;
}

function ligarFiltrosOp() {
  const campos = { busca: 'f-busca', situacao: 'f-situacao', nivel: 'f-nivel', persona: 'f-persona', cidade: 'f-cidade', fonte: 'f-fonte', periodo: 'f-periodo' };
  for (const [k, id] of Object.entries(campos)) {
    const el = document.getElementById(id);
    el.value = filtrosOp[k];
    el.addEventListener(k === 'busca' ? 'input' : 'change', () => {
      filtrosOp[k] = el.value;
      const { busca, ...lembrar } = filtrosOp;
      prefGravar('terrenos:filtros', lembrar);
      renderOportunidades();
    });
  }
  document.getElementById('f-limpar').addEventListener('click', () => {
    filtrosOp = { ...FILTROS_OP_PADRAO };
    prefGravar('terrenos:filtros', {});
    for (const [k, id] of Object.entries(campos)) document.getElementById(id).value = filtrosOp[k];
    renderOportunidades();
  });
}

function atualizarOpcoesOp() {
  const cidades = [...new Set(oportunidades.map(o => cidadeDe(o.local)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  preencherSelect(document.getElementById('f-cidade'), cidades.map(c => [c, c]), 'Todas as cidades');
  const fontes = [...new Set(oportunidades.map(o => o.fonte).filter(Boolean))].sort();
  preencherSelect(document.getElementById('f-fonte'), fontes.map(f => [f, fonteNome(f)]), 'Todas as fontes');
  document.getElementById('f-cidade').value = cidades.includes(filtrosOp.cidade) ? filtrosOp.cidade : '';
  document.getElementById('f-fonte').value = fontes.includes(filtrosOp.fonte) ? filtrosOp.fonte : '';
}

/** Miniatura do vídeo (YouTube): a que a coleta guardou ou, nos itens antigos, a do próprio id do vídeo. */
function miniaturaDe(op) {
  if (op.imagem_url) return op.imagem_url;
  const id = (op.link_original || '').match(/(?:[?&]v=|youtu\.be\/)([\w-]{11})/)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

function renderOportunidadeCard(op) {
  const el = document.createElement('article');
  el.className = `oportunidade oportunidade--nivel-${op.nivel_maturidade}${STATUS_OCULTOS.has(op.status_interno) ? ' is-apagado' : ''}`;
  if (op.corretor_vinculado_id) el.dataset.corretorId = op.corretor_vinculado_id;
  const corretor = op.corretor_vinculado_id ? corretoresPorId[op.corretor_vinculado_id] : null;
  const quando = op.publicado_em ? `Publicado ${formatarData(op.publicado_em)}` : `Coletado ${formatarData(op.coletado_em)}`;

  const thumb = miniaturaDe(op);
  el.innerHTML = `
    ${thumb ? `<a href="${escapeHTML(op.link_original)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img class="oportunidade__thumb" src="${escapeHTML(thumb)}" alt="" loading="lazy" decoding="async"></a>` : ''}
    <div class="oportunidade__tags">
      <span class="u-etiqueta suave">${escapeHTML(PERSONA_LABELS[op.persona] || op.persona)}</span>
      ${etiquetaNivel(op.nivel_maturidade)}
    </div>
    <h3 class="oportunidade__titulo"><a href="${escapeHTML(op.link_original)}" target="_blank" rel="noopener">${escapeHTML(op.titulo)}</a></h3>
    <p class="oportunidade__local">${escapeHTML(op.local || '')}</p>
    <div class="oportunidade__rodape">
      <span>${escapeHTML(fonteNome(op.fonte))} · ${quando}</span>
      <span class="js-corretor">${corretor ? escapeHTML(corretor.nome) : ''}</span>
    </div>`;
  el.querySelector('img.oportunidade__thumb')?.addEventListener('error', e => e.target.removeAttribute('src'), { once: true });
  return el;
}

const COLUNAS_OP = [
  { id: 'titulo', rotulo: 'Oportunidade' },
  { id: 'nivel', rotulo: 'Nível', classe: 'col-media' },
  { id: 'persona', rotulo: 'Persona', classe: 'col-media' },
  { id: 'local', rotulo: 'Local' },
  { id: 'fonte', rotulo: 'Fonte', classe: 'col-media' },
  { id: 'publicado', rotulo: 'Publicado', classe: 'col-num col-larga' },
  { id: 'coletado', rotulo: 'Coletado', classe: 'col-num' },
  { id: 'corretor', rotulo: 'Corretor', classe: 'col-larga' },
];

let ordemOp = prefLer('terrenos:ordem', { coluna: 'nivel', direcao: 'desc' });

const VALOR_OP = {
  titulo: o => normalizar(o.titulo),
  nivel: o => o.nivel_maturidade ?? null,
  persona: o => o.persona,
  local: o => normalizar(o.local),
  fonte: o => fonteNome(o.fonte),
  publicado: o => o.publicado_em || null,
  coletado: o => o.coletado_em || null,
  corretor: o => corretoresPorId[o.corretor_vinculado_id]?.nome || null,
};

function renderListaOp(itens) {
  const lista = document.getElementById('lista-oportunidades');
  const f = VALOR_OP[ordemOp.coluna] || VALOR_OP.nivel;
  const ordenados = [...itens].sort((a, b) => comparar(f(a), f(b), ordemOp.direcao) || comparar(VALOR_OP.coletado(a), VALOR_OP.coletado(b), 'desc'));
  lista.innerHTML = `<div class="tabela-rolagem"><table class="u-tabela tabela">${theadOrdenavel(COLUNAS_OP, ordemOp)}<tbody>${ordenados.map(o => `
    <tr class="linha linha--nivel-${o.nivel_maturidade}${STATUS_OCULTOS.has(o.status_interno) ? ' is-apagado' : ''}"${o.corretor_vinculado_id ? ` data-corretor-id="${escapeHTML(o.corretor_vinculado_id)}"` : ''}>
      <td><div class="linha__concurso">
        ${miniaturaDe(o) ? `<img class="linha__banner" src="${escapeHTML(miniaturaDe(o))}" alt="" loading="lazy" decoding="async">` : '<span class="linha__banner"></span>'}
        <div><a class="linha__titulo" href="${escapeHTML(o.link_original)}" target="_blank" rel="noopener">${escapeHTML(o.titulo)}</a>
        ${STATUS_OCULTOS.has(o.status_interno) ? `<div class="u-apoio">${escapeHTML(STATUS_LABELS[o.status_interno])}</div>` : ''}</div></div></td>
      <td class="col-media">${etiquetaNivel(o.nivel_maturidade, true)}</td>
      <td class="col-media">${escapeHTML(PERSONA_LABELS[o.persona] || o.persona || '')}</td>
      <td>${escapeHTML(o.local || '')}</td>
      <td class="col-media">${escapeHTML(fonteNome(o.fonte))}</td>
      <td class="col-num col-larga">${formatarData(o.publicado_em) || '<span class="u-apoio">—</span>'}</td>
      <td class="col-num">${formatarData(o.coletado_em)}</td>
      <td class="col-larga js-corretor">${escapeHTML(corretoresPorId[o.corretor_vinculado_id]?.nome || '')}</td>
    </tr>`).join('')}</tbody></table></div>`;
  lista.querySelectorAll('img.linha__banner').forEach(img => img.addEventListener('error', () => img.removeAttribute('src'), { once: true }));
  ligarOrdenacao(lista.querySelector('table'), ordemOp, () => { prefGravar('terrenos:ordem', ordemOp); renderOportunidades(); });
}

function renderOportunidades() {
  const visiveis = oportunidades.filter(passaOp);
  const vista = vistaAtual();
  const grade = document.getElementById('stack-oportunidades');
  const lista = document.getElementById('lista-oportunidades');
  grade.hidden = vista !== 'cartoes';
  lista.hidden = vista !== 'lista';

  if (vista === 'cartoes') {
    const ordenados = [...visiveis].sort((a, b) =>
      (b.nivel_maturidade - a.nivel_maturidade) || comparar(a.coletado_em, b.coletado_em, 'desc'));
    grade.replaceChildren(...ordenados.map(renderOportunidadeCard));
    lista.innerHTML = '';
  } else {
    grade.replaceChildren();
    renderListaOp(visiveis);
  }

  document.getElementById('empty-state').hidden = visiveis.length > 0;
  document.getElementById('f-limpar').hidden = !Object.keys(FILTROS_OP_PADRAO).some(k => filtrosOp[k] !== FILTROS_OP_PADRAO[k]);

  const qualificadas = visiveis.filter(o => o.nivel_maturidade >= 2).length;
  const recentes = visiveis.filter(o => (diasDesde(o.coletado_em) ?? 99) <= 7).length;
  const partes = [plural(visiveis.length, 'oportunidade', 'oportunidades')];
  if (qualificadas) partes.push(`${qualificadas} de nível 2 ou 3`);
  if (recentes) partes.push(`${recentes} coletada${recentes === 1 ? '' : 's'} nos últimos 7 dias`);
  document.getElementById('resumo').textContent = partes.join(' · ');
  renderAtualizado();
}

function renderAtualizado() {
  const el = document.getElementById('updated-at');
  const datas = oportunidades.map(o => new Date(o.coletado_em).getTime()).filter(t => !Number.isNaN(t));
  el.textContent = datas.length ? `Última coleta ${formatarData(new Date(Math.max(...datas)).toISOString())}` : '';
  const copia = cacheIdade('oportunidades');
  el.title = copia ? `Dados guardados neste navegador às ${formatarHora(copia)}` : '';
}

function receberOportunidades(dados) {
  oportunidades = Array.isArray(dados) ? dados : [];
  atualizarOpcoesOp();
  renderOportunidades();
}

// Nome do corretor nas oportunidades já desenhadas, quando a lista de corretores chega depois.
function atualizarCorretorNasOportunidades() {
  document.querySelectorAll('[data-corretor-id]').forEach(el => {
    const c = corretoresPorId[el.dataset.corretorId];
    const alvo = el.querySelector('.js-corretor');
    if (c && alvo) alvo.textContent = c.nome;
  });
}

// ================================================================ CORRETORES

const FILTROS_C_PADRAO = { busca: '', nivel: '', regiao: '', via: '', creci: '' };
let filtrosC = { ...FILTROS_C_PADRAO, ...prefLer('corretores:filtros', {}), busca: '' };
const LOTE = 10;
let corretoresMostrados = LOTE;

function passaCorretor(c) {
  if (filtrosC.busca) {
    const alvo = normalizar(`${c.nome} ${c.empresa || ''} ${c.creci || ''}`);
    if (!normalizar(filtrosC.busca).split(/\s+/).filter(Boolean).every(t => alvo.includes(t))) return false;
  }
  if (!nivelBate(c.nivel_maturidade, filtrosC.nivel)) return false;
  if (filtrosC.regiao && !(c.regioes_atuacao || []).includes(filtrosC.regiao)) return false;
  if (filtrosC.via && !(c.descoberto_via || []).includes(filtrosC.via)) return false;
  if (filtrosC.creci === 'com' && !c.creci) return false;
  if (filtrosC.creci === 'sem' && c.creci) return false;
  return true;
}

function ligarFiltrosC() {
  const campos = { busca: 'c-busca', nivel: 'c-nivel', regiao: 'c-regiao', via: 'c-via', creci: 'c-creci' };
  for (const [k, id] of Object.entries(campos)) {
    const el = document.getElementById(id);
    el.value = filtrosC[k];
    el.addEventListener(k === 'busca' ? 'input' : 'change', () => {
      filtrosC[k] = el.value;
      const { busca, ...lembrar } = filtrosC;
      prefGravar('corretores:filtros', lembrar);
      corretoresMostrados = LOTE;
      renderCorretores();
    });
  }
  document.getElementById('c-limpar').addEventListener('click', () => {
    filtrosC = { ...FILTROS_C_PADRAO };
    prefGravar('corretores:filtros', {});
    for (const [k, id] of Object.entries(campos)) document.getElementById(id).value = filtrosC[k];
    corretoresMostrados = LOTE;
    renderCorretores();
  });
}

function atualizarOpcoesC() {
  const regioes = [...new Set(corretores.flatMap(c => c.regioes_atuacao || []))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  preencherSelect(document.getElementById('c-regiao'), regioes.map(r => [r, r]), 'Todas as regiões');
  const vias = [...new Set(corretores.flatMap(c => c.descoberto_via || []))].sort();
  preencherSelect(document.getElementById('c-via'), vias.map(v => [v, `Via ${fonteNome(v)}`]), 'Descobertos em qualquer fonte');
  document.getElementById('c-regiao').value = regioes.includes(filtrosC.regiao) ? filtrosC.regiao : '';
  document.getElementById('c-via').value = vias.includes(filtrosC.via) ? filtrosC.via : '';
}

function renderCorretorCartao(c) {
  const el = document.createElement('article');
  el.className = 'corretor';
  el.innerHTML = `
    <div>
      <p class="corretor__nome">${escapeHTML(c.nome)}</p>
      ${c.empresa && c.empresa !== c.nome ? `<p class="corretor__empresa">${escapeHTML(c.empresa)}</p>` : ''}
      <div class="corretor__meta">
        ${(c.regioes_atuacao || []).length ? `<span>${escapeHTML(c.regioes_atuacao.join(', '))}</span>` : ''}
        <span>Via ${escapeHTML((c.descoberto_via || []).map(fonteNome).join(', '))}</span>
        ${c.volume_zap ? `<span>${plural(c.volume_zap, 'terreno', 'terrenos')} no ZAP</span>` : ''}
      </div>
    </div>
    <div class="corretor__selos">
      ${c.creci ? `<span class="u-etiqueta suave">CRECI ${escapeHTML(c.creci)}</span>` : ''}
      ${etiquetaNivel(c.nivel_maturidade)}
    </div>`;
  return el;
}

const COLUNAS_C = [
  { id: 'nome', rotulo: 'Corretor' },
  { id: 'nivel', rotulo: 'Nível', classe: 'col-media' },
  { id: 'regioes', rotulo: 'Regiões' },
  { id: 'creci', rotulo: 'CRECI', classe: 'col-media' },
  { id: 'via', rotulo: 'Descoberto via', classe: 'col-larga' },
  { id: 'zap', rotulo: 'Terrenos no ZAP', classe: 'col-num col-media' },
  { id: 'oportunidades', rotulo: 'Oportunidades', classe: 'col-num col-media' },
  { id: 'atualizado', rotulo: 'Atualizado', classe: 'col-num col-larga' },
];

let ordemC = prefLer('corretores:ordem', { coluna: 'nivel', direcao: 'desc' });

const VALOR_C = {
  nome: c => normalizar(c.nome),
  nivel: c => c.nivel_maturidade ?? null,
  regioes: c => (c.regioes_atuacao || []).join(', ') || null,
  creci: c => c.creci || null,
  via: c => (c.descoberto_via || []).map(fonteNome).join(', '),
  zap: c => c.volume_zap || null,
  oportunidades: c => (c.oportunidades_vinculadas || []).length || null,
  atualizado: c => c.atualizado_em || null,
};

function renderListaC(itens) {
  const lista = document.getElementById('lista-corretores');
  const f = VALOR_C[ordemC.coluna] || VALOR_C.nivel;
  const ordenados = [...itens].sort((a, b) => comparar(f(a), f(b), ordemC.direcao) || comparar(VALOR_C.nome(a), VALOR_C.nome(b), 'asc'));
  lista.innerHTML = `<div class="tabela-rolagem"><table class="u-tabela tabela">${theadOrdenavel(COLUNAS_C, ordemC)}<tbody>${ordenados.map(c => `
    <tr class="linha linha--nivel-${c.nivel_maturidade}">
      <td><div class="linha__titulo">${escapeHTML(c.nome)}</div>${c.empresa && c.empresa !== c.nome ? `<div class="u-apoio">${escapeHTML(c.empresa)}</div>` : ''}</td>
      <td class="col-media">${etiquetaNivel(c.nivel_maturidade, true)}</td>
      <td>${escapeHTML((c.regioes_atuacao || []).join(', '))}</td>
      <td class="col-media">${escapeHTML(c.creci || '')}</td>
      <td class="col-larga">${escapeHTML((c.descoberto_via || []).map(fonteNome).join(', '))}</td>
      <td class="col-num col-media">${c.volume_zap || ''}</td>
      <td class="col-num col-media">${(c.oportunidades_vinculadas || []).length || ''}</td>
      <td class="col-num col-larga">${formatarData(c.atualizado_em)}</td>
    </tr>`).join('')}</tbody></table></div>`;
  ligarOrdenacao(lista.querySelector('table'), ordemC, () => { prefGravar('corretores:ordem', ordemC); renderCorretores(); });
}

let corretoresProntos = false;

function renderCorretores() {
  const cartoes = document.getElementById('corretor-list');
  const lista = document.getElementById('lista-corretores');
  const mais = document.getElementById('corretor-load-more');
  const resumo = document.getElementById('resumo-corretores');
  const vista = vistaAtual();
  cartoes.hidden = vista !== 'cartoes';
  lista.hidden = vista !== 'lista';
  mais.innerHTML = '';
  document.getElementById('c-limpar').hidden = !Object.keys(FILTROS_C_PADRAO).some(k => filtrosC[k] !== FILTROS_C_PADRAO[k]);

  if (!corretoresProntos) { resumo.textContent = 'Carregando corretores…'; return; }

  const visiveis = corretores.filter(passaCorretor);
  resumo.textContent = visiveis.length
    ? `${plural(visiveis.length, 'corretor', 'corretores')}${visiveis.filter(c => c.creci).length ? ` · ${visiveis.filter(c => c.creci).length} com CRECI` : ''}`
    : (corretores.length ? 'Nenhum corretor com esses filtros.' : 'Nenhum corretor acumulado ainda.');

  if (vista === 'cartoes') {
    lista.innerHTML = '';
    const ordenados = [...visiveis].sort((a, b) => (b.nivel_maturidade - a.nivel_maturidade) || comparar(VALOR_C.nome(a), VALOR_C.nome(b), 'asc'));
    cartoes.replaceChildren(...ordenados.slice(0, corretoresMostrados).map(renderCorretorCartao));
    const restantes = ordenados.length - corretoresMostrados;
    if (restantes > 0) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'u-botao';
      b.textContent = `Mostrar mais ${Math.min(restantes, LOTE)} (${plural(restantes, 'restante', 'restantes')})`;
      b.addEventListener('click', () => { corretoresMostrados += LOTE; renderCorretores(); });
      mais.appendChild(b);
    }
  } else {
    cartoes.replaceChildren();
    renderListaC(visiveis); // a tabela é leve: mostra todos de uma vez
  }
}

function receberCorretores(dados) {
  corretores = Array.isArray(dados) ? dados : [];
  corretoresPorId = Object.fromEntries(corretores.map(c => [c.id, c]));
  corretoresProntos = true;
  atualizarOpcoesC();
  renderCorretores();
  atualizarCorretorNasOportunidades();
}

// A busca de corretores na rede só acontece quando a seção chega perto da tela.
function observarSecaoCorretores(forcar = false) {
  const carregar = () => carregarComCache('corretores', CORRETORES_URL, receberCorretores, { forcar });
  const alvo = document.getElementById('section-corretores');
  if (!('IntersectionObserver' in window)) { setTimeout(carregar, 300); return; }
  const obs = new IntersectionObserver(entradas => {
    if (entradas.some(e => e.isIntersecting)) { obs.disconnect(); carregar(); }
  }, { rootMargin: '300px' });
  obs.observe(alvo);
}

// ================================================================ início

function init() {
  vistaAtual = ligarVista(document.getElementById('vista'), 'terrenos:vista', () => { renderOportunidades(); renderCorretores(); });
  ligarFiltrosOp();
  ligarFiltrosC();
  atualizarOpcoesOp();
  atualizarOpcoesC();

  // cópia guardada dos corretores: aparece já (e preenche os nomes nas oportunidades)
  const guardados = cacheLer('corretores');
  if (guardados) receberCorretores(guardados.dados);
  else renderCorretores();

  if (!cacheLer('oportunidades')) document.getElementById('resumo').textContent = 'Carregando oportunidades…';
  carregarComCache('oportunidades', OPORTUNIDADES_URL, receberOportunidades);
  observarSecaoCorretores();

  const recarregar = document.getElementById('recarregar');
  recarregar.addEventListener('click', async () => {
    recarregar.disabled = true;
    recarregar.textContent = 'Recarregando…';
    avisar('');
    await Promise.all([
      carregarComCache('oportunidades', OPORTUNIDADES_URL, receberOportunidades, { forcar: true }),
      carregarComCache('corretores', CORRETORES_URL, receberCorretores, { forcar: true }),
    ]);
    recarregar.disabled = false;
    recarregar.textContent = 'Recarregar';
  });
}

init();
