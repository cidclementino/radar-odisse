// Radar Odisse — Terrenos: oportunidades (terrenista/corretor) + perfis de corretor
//
// Duas vistas (cartões e lista) com os mesmos filtros, nas duas seções. Dados do Worker com cache
// no navegador (carregarComCache, em comum.js). Os corretores continuam sendo buscados na rede só
// quando a seção entra na tela; se já houver cópia guardada, aparecem na hora.

const OPORTUNIDADES_URL = `${WORKER}/api/oportunidades`;
const CORRETORES_URL = `${WORKER}/api/corretores`;

const STATUS_OCULTOS = new Set(['descartado', 'abordado', 'no_funil']);

const NIVEL_LABELS = { 1: 'Nível 1 · Observação', 2: 'Nível 2 · Qualificado', 3: 'Nível 3 · Processo aberto' };
const NIVEL_CURTO = { 1: 'Observação', 2: 'Qualificado', 3: 'Processo aberto' };
const PERSONA_LABELS = { terrenista: 'Terrenista', corretor: 'Corretor' };
const FONTE_LABELS = { 'olx.com.br': 'OLX', 'zapimoveis.com.br': 'ZAP Imóveis', 'youtube.com': 'YouTube', manual: 'Cadastro manual' };
const CATEGORIA_LABELS = { terreno: 'Terreno', imovel: 'Imóvel para retrofit' };
const categoriaDe = op => op.categoria || 'terreno';
const STATUS_LABELS = { monitorando: 'Monitorando', abordado: 'Abordado', descartado: 'Descartado', no_funil: 'No funil' };

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

const FILTROS_OP_PADRAO = { busca: '', situacao: 'monitorando', nivel: '', categoria: '', persona: '', cidade: '', fonte: '', periodo: '' };
let filtrosOp = { ...FILTROS_OP_PADRAO, ...prefLer('terrenos:filtros', {}), busca: '' };

function passaOp(op) {
  if (NOVOS_DIA) return novoNoDia(op) && !STATUS_OCULTOS.has(op.status_interno); // vindo do Início do Universo
  if (filtrosOp.situacao === 'monitorando' && STATUS_OCULTOS.has(op.status_interno)) return false;
  if (filtrosOp.situacao === 'ocultas' && !STATUS_OCULTOS.has(op.status_interno)) return false;
  if (filtrosOp.busca) {
    const alvo = normalizar(`${op.titulo} ${op.local} ${op.texto_bruto || ''} ${op.observacoes || ''}`);
    if (!normalizar(filtrosOp.busca).split(/\s+/).filter(Boolean).every(t => alvo.includes(t))) return false;
  }
  if (!nivelBate(op.nivel_maturidade, filtrosOp.nivel)) return false;
  if (filtrosOp.categoria && categoriaDe(op) !== filtrosOp.categoria) return false;
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
  const campos = { busca: 'f-busca', situacao: 'f-situacao', nivel: 'f-nivel', categoria: 'f-categoria', persona: 'f-persona', cidade: 'f-cidade', fonte: 'f-fonte', periodo: 'f-periodo' };
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
    ${thumb && op.link_original ? `<a href="${escapeHTML(op.link_original)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img class="oportunidade__thumb" src="${escapeHTML(thumb)}" alt="" loading="lazy" decoding="async"></a>` : ''}
    <div class="oportunidade__tags">
      ${categoriaDe(op) === 'imovel' ? `<span class="u-etiqueta selo-imovel">${CATEGORIA_LABELS.imovel}</span>` : ''}
      <span class="u-etiqueta suave">${escapeHTML(PERSONA_LABELS[op.persona] || op.persona)}</span>
      ${etiquetaNivel(op.nivel_maturidade)}
      ${STATUS_OCULTOS.has(op.status_interno) ? `<span class="u-etiqueta">${escapeHTML(STATUS_LABELS[op.status_interno])}</span>` : ''}
      ${botaoEditar('Editar terreno')}
    </div>
    <h3 class="oportunidade__titulo">${linkOuTexto(op.link_original, op.titulo)}</h3>
    <p class="oportunidade__local">${escapeHTML(op.local || '')}</p>
    ${op.observacoes ? `<p class="oportunidade__obs">${escapeHTML(op.observacoes)}</p>` : ''}
    <div class="oportunidade__rodape">
      <span>${escapeHTML(fonteNome(op.fonte))} · ${quando}</span>
      <span class="js-corretor">${corretor ? escapeHTML(corretor.nome) : ''}</span>
    </div>`;
  el.querySelector('img.oportunidade__thumb')?.addEventListener('error', e => e.target.removeAttribute('src'), { once: true });
  el.querySelector('.js-editar').addEventListener('click', () => editarOportunidade(op));
  return el;
}

const COLUNAS_OP = [
  { id: 'titulo', rotulo: 'Oportunidade' },
  { id: 'nivel', rotulo: 'Nível', classe: 'col-media' },
  { id: 'categoria', rotulo: 'Tipo', classe: 'col-media' },
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
  categoria: o => CATEGORIA_LABELS[categoriaDe(o)],
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
        <div>${linkOuTexto(o.link_original, o.titulo, 'linha__titulo')}${botaoEditar('Editar terreno', o.id)}
        ${STATUS_OCULTOS.has(o.status_interno) ? `<div class="u-apoio">${escapeHTML(STATUS_LABELS[o.status_interno])}</div>` : ''}</div></div></td>
      <td class="col-media">${etiquetaNivel(o.nivel_maturidade, true)}</td>
      <td class="col-media">${categoriaDe(o) === 'imovel' ? 'Imóvel' : 'Terreno'}</td>
      <td class="col-media">${escapeHTML(PERSONA_LABELS[o.persona] || o.persona || '')}</td>
      <td>${escapeHTML(o.local || '')}</td>
      <td class="col-media">${escapeHTML(fonteNome(o.fonte))}</td>
      <td class="col-num col-larga">${formatarData(o.publicado_em) || '<span class="u-apoio">—</span>'}</td>
      <td class="col-num">${formatarData(o.coletado_em)}</td>
      <td class="col-larga js-corretor">${escapeHTML(corretoresPorId[o.corretor_vinculado_id]?.nome || '')}</td>
    </tr>`).join('')}</tbody></table></div>`;
  lista.querySelectorAll('img.linha__banner').forEach(img => img.addEventListener('error', () => img.removeAttribute('src'), { once: true }));
  lista.querySelectorAll('.js-editar').forEach(b => b.addEventListener('click', () => {
    const o = oportunidades.find(x => x.id === b.dataset.id);
    if (o) editarOportunidade(o);
  }));
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

const FILTROS_C_PADRAO = { busca: '', situacao: 'ativos', nivel: '', regiao: '', via: '', creci: '' };
let filtrosC = { ...FILTROS_C_PADRAO, ...prefLer('corretores:filtros', {}), busca: '' };
const LOTE = 10;
let corretoresMostrados = LOTE;

function passaCorretor(c) {
  if (filtrosC.busca) {
    const alvo = normalizar(`${c.nome} ${c.empresa || ''} ${c.creci || ''} ${c.instagram || ''} ${c.email || ''} ${c.observacoes || ''} ${(c.whatsapp || c.telefone || '').replace(/\D/g, '')}`);
    if (!normalizar(filtrosC.busca).split(/\s+/).filter(Boolean).every(t => alvo.includes(t))) return false;
  }
  if (filtrosC.situacao === 'ativos' && c.status_interno === 'descartado') return false;
  if (filtrosC.situacao === 'descartados' && c.status_interno !== 'descartado') return false;
  if (!nivelBate(c.nivel_maturidade, filtrosC.nivel)) return false;
  if (filtrosC.regiao && !(c.regioes_atuacao || []).includes(filtrosC.regiao)) return false;
  if (filtrosC.via && !(c.descoberto_via || []).includes(filtrosC.via)) return false;
  if (filtrosC.creci === 'com' && !c.creci) return false;
  if (filtrosC.creci === 'sem' && c.creci) return false;
  return true;
}

function ligarFiltrosC() {
  const campos = { busca: 'c-busca', situacao: 'c-situacao', nivel: 'c-nivel', regiao: 'c-regiao', via: 'c-via', creci: 'c-creci' };
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

/** +5583999887766 → (83) 99988-7766 */
function formatarTelefone(tel) {
  const d = (tel || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel || '';
}

/** Contatos lidos na coleta (WhatsApp, telefone, Instagram, e-mail, canal), como links. */
function contatosCorretor(c) {
  const itens = [];
  if (c.whatsapp) itens.push(`<a href="https://wa.me/${escapeHTML(c.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp ${escapeHTML(formatarTelefone(c.whatsapp))}</a>`);
  if (c.telefone) itens.push(`<a href="tel:${escapeHTML(c.telefone)}">Tel. ${escapeHTML(formatarTelefone(c.telefone))}</a>`);
  if (c.instagram) itens.push(`<a href="https://www.instagram.com/${encodeURIComponent(c.instagram)}/" target="_blank" rel="noopener">@${escapeHTML(c.instagram)}</a>`);
  if (c.email) itens.push(`<a href="mailto:${escapeHTML(c.email)}">${escapeHTML(c.email)}</a>`);
  if (c.canal_url) itens.push(`<a href="${escapeHTML(c.canal_url)}" target="_blank" rel="noopener">Canal</a>`);
  return itens;
}

function renderCorretorCartao(c) {
  const el = document.createElement('article');
  el.className = `corretor${c.foto_url ? ' corretor--foto' : ''}${c.status_interno === 'descartado' ? ' is-apagado' : ''}`;
  const contatos = contatosCorretor(c);
  el.innerHTML = `
    ${c.foto_url ? `<img class="corretor__foto" src="${escapeHTML(c.foto_url)}" alt="" loading="lazy" decoding="async">` : ''}
    <div>
      <p class="corretor__nome">${escapeHTML(c.nome)}</p>
      ${c.empresa && c.empresa !== c.nome ? `<p class="corretor__empresa">${escapeHTML(c.empresa)}</p>` : ''}
      <div class="corretor__meta">
        ${(c.regioes_atuacao || []).length ? `<span>${escapeHTML(c.regioes_atuacao.join(', '))}</span>` : ''}
        <span>Via ${escapeHTML((c.descoberto_via || []).map(fonteNome).join(', '))}</span>
        ${c.volume_zap ? `<span>${plural(c.volume_zap, 'terreno', 'terrenos')} no ZAP</span>` : ''}
      </div>
      ${contatos.length ? `<div class="corretor__contatos">${contatos.join('')}</div>` : ''}
      ${c.observacoes ? `<p class="corretor__obs">${escapeHTML(c.observacoes)}</p>` : ''}
    </div>
    <div class="corretor__selos">
      ${c.status_interno === 'descartado' ? '<span class="u-etiqueta">Descartado</span>' : ''}
      ${c.creci ? `<span class="u-etiqueta suave">CRECI ${escapeHTML(c.creci)}</span>` : ''}
      ${etiquetaNivel(c.nivel_maturidade)}
      ${botaoEditar('Editar corretor')}
    </div>`;
  el.querySelector('img.corretor__foto')?.addEventListener('error', e => e.target.remove(), { once: true });
  el.querySelector('.js-editar').addEventListener('click', () => editarCorretor(c));
  return el;
}

const COLUNAS_C = [
  { id: 'nome', rotulo: 'Corretor' },
  { id: 'nivel', rotulo: 'Nível', classe: 'col-media' },
  { id: 'regioes', rotulo: 'Regiões' },
  { id: 'creci', rotulo: 'CRECI', classe: 'col-media' },
  { id: 'contato', rotulo: 'Contato', classe: 'col-larga' },
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
  contato: c => c.whatsapp || c.telefone || c.instagram || c.email || null,
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
    <tr class="linha linha--nivel-${c.nivel_maturidade}${c.status_interno === 'descartado' ? ' is-apagado' : ''}">
      <td><div class="linha__titulo">${escapeHTML(c.nome)}${botaoEditar('Editar corretor', c.id)}</div>${c.empresa && c.empresa !== c.nome ? `<div class="u-apoio">${escapeHTML(c.empresa)}</div>` : ''}</td>
      <td class="col-media">${etiquetaNivel(c.nivel_maturidade, true)}</td>
      <td>${escapeHTML((c.regioes_atuacao || []).join(', '))}</td>
      <td class="col-media">${escapeHTML(c.creci || '')}</td>
      <td class="col-larga"><div class="corretor__contatos corretor__contatos--lista">${contatosCorretor(c).join('')}</div></td>
      <td class="col-larga">${escapeHTML((c.descoberto_via || []).map(fonteNome).join(', '))}</td>
      <td class="col-num col-media">${c.volume_zap || ''}</td>
      <td class="col-num col-media">${(c.oportunidades_vinculadas || []).length || ''}</td>
      <td class="col-num col-larga">${formatarData(c.atualizado_em)}</td>
    </tr>`).join('')}</tbody></table></div>`;
  lista.querySelectorAll('.js-editar').forEach(b => b.addEventListener('click', () => {
    const c = corretoresPorId[b.dataset.id];
    if (c) editarCorretor(c);
  }));
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

// ================================================================ EDIÇÃO MANUAL
//
// Corretor e terreno podem ser corrigidos, completados e criados à mão (a coleta nem sempre traz
// tudo). O Worker marca cada campo mexido em `campos_manuais` e a coleta não mexe mais nele.

/** Lápis; com id, para listas (o clique acha o item pelo id). */
function botaoEditar(rotulo, id = null) {
  return `<button type="button" class="editar-nome js-editar"${id ? ` data-id="${escapeHTML(id)}"` : ''} title="${escapeHTML(rotulo)}" aria-label="${escapeHTML(rotulo)}">${LAPIS_SVG}</button>`;
}

function linkOuTexto(href, texto, classe = '') {
  const c = classe ? ` class="${classe}"` : '';
  return href
    ? `<a${c} href="${escapeHTML(href)}" target="_blank" rel="noopener">${escapeHTML(texto)}</a>`
    : `<span${c}>${escapeHTML(texto)}</span>`;
}

/**
 * Diálogo de formulário. `campos`: { nome, rotulo, tipo ('texto'|'area'|'select'|'tel'|'email'|'url'),
 * valor, opcoes ([[valor, rótulo]]), dica, obrigatorio, largo }. Envia só o que mudou (ou tudo, ao criar).
 */
function abrirFormulario({ titulo, nota, campos, criando, enviar }) {
  let dialogo = document.getElementById('edicao-terrenos');
  if (!dialogo) {
    dialogo = document.createElement('dialog');
    dialogo.id = 'edicao-terrenos';
    dialogo.className = 'fusao edicao edicao--larga';
    document.body.appendChild(dialogo);
  }
  const campoHTML = f => {
    const v = f.valor ?? '';
    const req = f.obrigatorio ? ' required' : '';
    let entrada;
    if (f.tipo === 'select') {
      entrada = `<select name="${f.nome}"${req}>${f.opcoes.map(([val, rot]) => `<option value="${escapeHTML(val)}"${String(val) === String(v) ? ' selected' : ''}>${escapeHTML(rot)}</option>`).join('')}</select>`;
    } else if (f.tipo === 'area') {
      entrada = `<textarea name="${f.nome}" rows="3" maxlength="4000">${escapeHTML(v)}</textarea>`;
    } else {
      const tipo = { tel: 'tel', email: 'email', url: 'url' }[f.tipo] || 'text';
      entrada = `<input type="${tipo}" name="${f.nome}" value="${escapeHTML(v)}"${req}${f.placeholder ? ` placeholder="${escapeHTML(f.placeholder)}"` : ''}>`;
    }
    return `<label class="u-campo${f.largo ? ' edicao__largo' : ''}"><span>${escapeHTML(f.rotulo)}</span>${entrada}${f.dica ? `<small>${escapeHTML(f.dica)}</small>` : ''}</label>`;
  };
  dialogo.innerHTML = `
    <form class="fusao__form" method="dialog" novalidate>
      <header class="fusao__topo"><h2>${escapeHTML(titulo)}</h2><button type="button" class="fusao__fechar js-cancelar" aria-label="Fechar">×</button></header>
      <div class="fusao__corpo edicao__corpo">
        <div class="edicao__grade">${campos.map(campoHTML).join('')}</div>
        ${nota ? `<p class="u-apoio edicao__nota">${escapeHTML(nota)}</p>` : ''}
        <p class="edicao__erro" role="alert" hidden></p>
      </div>
      <footer class="fusao__rodape">
        <button type="button" class="u-botao js-cancelar">Cancelar</button>
        <button type="submit" class="u-botao forte">${criando ? 'Criar' : 'Salvar'}</button>
      </footer>
    </form>`;
  dialogo.querySelectorAll('.js-cancelar').forEach(b => b.addEventListener('click', () => dialogo.close()));
  const form = dialogo.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const erro = form.querySelector('.edicao__erro');
    const corpo = {};
    for (const f of campos) {
      const bruto = form.elements[f.nome].value;
      const v = f.tipo === 'area' ? bruto.trim() : bruto.replace(/\s+/g, ' ').trim();
      if (f.obrigatorio && !v) {
        erro.textContent = `Preencha: ${f.rotulo}.`; erro.hidden = false; return;
      }
      const antes = f.valor === null || f.valor === undefined ? '' : String(f.valor);
      if (criando ? v !== '' : v !== antes) corpo[f.nome] = v === '' ? null : (f.numero ? Number(v) : v);
    }
    if (!Object.keys(corpo).length) { dialogo.close(); return; }
    const botao = form.querySelector('[type=submit]');
    botao.disabled = true; botao.textContent = criando ? 'Criando…' : 'Salvando…';
    try {
      await enviar(corpo);
      dialogo.close();
    } catch (err) {
      erro.textContent = `Não foi possível salvar: ${err.message}`;
      erro.hidden = false;
      botao.disabled = false; botao.textContent = criando ? 'Criar' : 'Salvar';
    }
  });
  dialogo.showModal();
  form.elements[campos[0].nome].focus();
}

async function chamarWorker(metodo, caminho, corpo) {
  const res = await fetch(`${WORKER}${caminho}`, {
    method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error || `Worker respondeu ${res.status}`);
  return r;
}

/** Atualiza um item na lista em memória e na cópia guardada, e redesenha. */
function guardarCorretor(c) {
  const i = corretores.findIndex(x => x.id === c.id);
  if (i >= 0) corretores[i] = c; else corretores.push(c);
  corretoresPorId[c.id] = c;
  if (corretoresProntos) cacheGravar('corretores', corretores);
}

function guardarOportunidade(op) {
  const i = oportunidades.findIndex(x => x.id === op.id);
  if (i >= 0) oportunidades[i] = op; else oportunidades.push(op);
  cacheGravar('oportunidades', oportunidades);
}

const OPCOES_NIVEL = [[1, NIVEL_LABELS[1]], [2, NIVEL_LABELS[2]], [3, NIVEL_LABELS[3]]];
const NOTA_MANUAL = 'O que for corrigido aqui fica valendo: a coleta não mexe mais nesses campos.';

function editarCorretor(c) {
  const criando = !c;
  c = c || {};
  abrirFormulario({
    titulo: criando ? 'Novo corretor' : 'Editar corretor',
    criando,
    nota: criando ? 'Corretor cadastrado à mão (indicação, contato direto…).' : NOTA_MANUAL,
    campos: [
      { nome: 'nome', rotulo: 'Nome', valor: c.nome, obrigatorio: true },
      { nome: 'empresa', rotulo: 'Imobiliária / empresa', valor: c.empresa },
      { nome: 'whatsapp', rotulo: 'WhatsApp', tipo: 'tel', valor: c.whatsapp ? formatarTelefone(c.whatsapp) : '', placeholder: '(83) 99999-9999' },
      { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', valor: c.telefone ? formatarTelefone(c.telefone) : '' },
      { nome: 'instagram', rotulo: 'Instagram', valor: c.instagram, placeholder: '@perfil' },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: c.email },
      { nome: 'creci', rotulo: 'CRECI', valor: c.creci, placeholder: 'PB-12345' },
      { nome: 'nivel_maturidade', rotulo: 'Nível', tipo: 'select', valor: c.nivel_maturidade || 1, opcoes: OPCOES_NIVEL, numero: true },
      { nome: 'regioes_atuacao', rotulo: 'Regiões de atuação', valor: (c.regioes_atuacao || []).join(', '), dica: 'Separadas por vírgula.', largo: true },
      ...(criando ? [] : [{ nome: 'status_interno', rotulo: 'Situação', tipo: 'select', valor: c.status_interno || 'ativo', opcoes: [['ativo', 'Ativo'], ['descartado', 'Descartado']] }]),
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'area', valor: c.observacoes, largo: true },
    ],
    enviar: async corpo => {
      if ('regioes_atuacao' in corpo) corpo.regioes_atuacao = corpo.regioes_atuacao ? corpo.regioes_atuacao.split(',') : [];
      const r = criando
        ? await chamarWorker('POST', '/api/corretores', corpo)
        : await chamarWorker('PATCH', `/api/corretores/${encodeURIComponent(c.id)}`, corpo);
      guardarCorretor(r);
      atualizarOpcoesC();
      renderCorretores();
      renderOportunidades();
      notificar(criando ? 'Corretor criado.' : 'Corretor salvo.');
    },
  });
}

function opcoesCorretor(atualId) {
  const lista = corretores
    .filter(c => c.status_interno !== 'descartado' || c.id === atualId)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(c => [c.id, c.empresa && c.empresa !== c.nome ? `${c.nome} · ${c.empresa}` : c.nome]);
  return [['', '— sem corretor —'], ...lista];
}

async function editarOportunidade(op) {
  const criando = !op;
  op = op || {};
  // a lista de corretores pode ainda não ter vindo (a seção carrega quando entra na tela)
  if (!corretoresProntos) await carregarComCache('corretores', CORRETORES_URL, receberCorretores);
  abrirFormulario({
    titulo: criando ? 'Novo terreno ou imóvel' : (categoriaDe(op) === 'imovel' ? 'Editar imóvel' : 'Editar terreno'),
    criando,
    nota: criando ? 'Terreno cadastrado à mão (indicação, anúncio visto fora do Radar…).' : NOTA_MANUAL,
    campos: [
      { nome: 'titulo', rotulo: 'Título', valor: op.titulo, obrigatorio: true, largo: true },
      { nome: 'categoria', rotulo: 'Tipo', tipo: 'select', valor: categoriaDe(op), opcoes: [['terreno', 'Terreno'], ['imovel', 'Imóvel para retrofit']] },
      { nome: 'local', rotulo: 'Local', valor: op.local, placeholder: 'Bairro, cidade' },
      { nome: 'corretor_vinculado_id', rotulo: 'Corretor', tipo: 'select', valor: op.corretor_vinculado_id || '', opcoes: opcoesCorretor(op.corretor_vinculado_id) },
      { nome: 'nivel_maturidade', rotulo: 'Nível', tipo: 'select', valor: op.nivel_maturidade || 1, opcoes: OPCOES_NIVEL, numero: true },
      { nome: 'persona', rotulo: 'Quem anuncia', tipo: 'select', valor: op.persona || 'terrenista', opcoes: [['terrenista', 'Terrenista (dono)'], ['corretor', 'Corretor']] },
      { nome: 'link_original', rotulo: 'Link do anúncio ou vídeo', tipo: 'url', valor: op.link_original, largo: true },
      ...(criando ? [] : [{ nome: 'status_interno', rotulo: 'Situação', tipo: 'select', valor: op.status_interno || 'monitorando',
        opcoes: [['monitorando', 'Monitorando'], ['descartado', 'Descartado'], ...(op.status_interno === 'no_funil' ? [['no_funil', 'No funil']] : [])] }]),
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'area', valor: op.observacoes, largo: true },
    ],
    enviar: async corpo => {
      const r = criando
        ? await chamarWorker('POST', '/api/oportunidades', corpo)
        : await chamarWorker('PATCH', `/api/oportunidades/${encodeURIComponent(op.id)}`, corpo);
      guardarOportunidade(r.oportunidade);
      for (const c of r.corretores || []) guardarCorretor(c);
      atualizarOpcoesOp();
      renderOportunidades();
      renderCorretores();
      notificar(criando ? 'Terreno criado.' : 'Terreno salvo.');
    },
  });
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

  document.getElementById('novo-terreno').addEventListener('click', () => editarOportunidade(null));
  document.getElementById('novo-corretor').addEventListener('click', () => editarCorretor(null));

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
