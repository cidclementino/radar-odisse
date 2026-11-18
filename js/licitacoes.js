// Radar Odisse — Licitações (PNCP)
//
// Contratações públicas de projeto com propostas abertas. Cartões no mesmo desenho dos concursos
// (borda pelo prazo, clique abre o detalhe) e lista ordenável. Dados do Worker com cache no navegador
// (carregarComCache, em comum.js): a página abre na hora com a última cópia e atualiza por baixo.

const LICITACOES_URL = `${WORKER}/api/licitacoes`;
const CHAVE = 'licitacoes';

const SITUACOES = { monitorando: 'Monitorando', acompanhando: 'Acompanhando', participando: 'Participando', descartado: 'Descartada' };
const ACOMPANHADA = new Set(['acompanhando', 'participando']);
const ESCOPO_LABELS = { arquitetura: 'Arquitetura', urbanismo: 'Urbanismo', paisagismo: 'Paisagismo', interiores: 'Interiores', restauro: 'Restauro', complementares: 'Complementares' };
const TIPO_LABELS = { projeto: 'Só projeto', projeto_e_obra: 'Projeto e obra' };
const ESFERA = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };

let licitacoes = [];
let vistaAtual = () => 'cartoes';

// ---------------------------------------------------------------- regras

/** "2026-12-01T09:30:00" → dias até a data (o horário fica no detalhe) */
const diasDe = l => diasAte((l.encerramento || '').slice(0, 10) || null);
const encerrada = l => { const d = diasDe(l); return d !== null && d < 0; };

function urgencia(d, fim) {
  if (fim || d === null) return 'neutro';
  if (d <= 15) return 'alta';
  if (d <= 45) return 'media';
  return 'baixa';
}

function dinheiro(centavos) {
  if (centavos === null || centavos === undefined) return null;
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: centavos >= 10000000 ? 0 : 2 });
}

function dataHora(iso) {
  if (!iso) return null;
  const [d, h] = iso.split('T');
  return `${formatarData(d)}${h ? `, ${h.slice(0, 5)}` : ''}`;
}

const localDe = l => [l.municipio, l.uf].filter(Boolean).join('/');

/** Muitos órgãos escrevem o objeto todo em maiúsculas: vira frase comum, só para ler melhor. */
function legivel(t) {
  if (!t) return '';
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const maiusculas = letras.replace(/[^A-ZÀ-Þ]/g, '').length;
  if (letras.length < 12 || maiusculas / letras.length < 0.7) return t;
  const m = t.toLocaleLowerCase('pt-BR');
  return m.charAt(0).toLocaleUpperCase('pt-BR') + m.slice(1);
}

// ---------------------------------------------------------------- filtros

const PADRAO = { busca: '', situacao: 'ativas', prazo: '', tipo: '', escopo: '', uf: '', modalidade: '' };
let filtros = { ...PADRAO, ...prefLer('licitacoes:filtros', {}), busca: '' };

function passa(l) {
  const fim = encerrada(l);
  const descartada = l.status_interno === 'descartado';
  if (filtros.situacao === 'ativas' && (fim || descartada)) return false;
  if (filtros.situacao === 'acompanhando' && !ACOMPANHADA.has(l.status_interno)) return false;
  if (filtros.situacao === 'ocultas' && !(fim || descartada)) return false;
  if (filtros.busca) {
    const alvo = normalizar(`${l.objeto} ${l.orgao || ''} ${l.unidade || ''} ${l.municipio || ''} ${l.observacoes || ''}`);
    if (!normalizar(filtros.busca).split(/\s+/).filter(Boolean).every(t => alvo.includes(t))) return false;
  }
  if (filtros.prazo) {
    const d = diasDe(l);
    if (d === null || d < 0) return false;
    if (filtros.prazo === '15' && d > 15) return false;
    if (filtros.prazo === '45' && (d <= 15 || d > 45)) return false;
    if (filtros.prazo === 'mais' && d <= 45) return false;
  }
  if (filtros.tipo && l.tipo_objeto !== filtros.tipo) return false;
  if (filtros.escopo && !(l.escopo || []).includes(filtros.escopo)) return false;
  if (filtros.uf && l.uf !== filtros.uf) return false;
  if (filtros.modalidade && l.modalidade !== filtros.modalidade) return false;
  return true;
}

function ligarFiltros() {
  const campos = { busca: 'f-busca', situacao: 'f-situacao', prazo: 'f-prazo', tipo: 'f-tipo', escopo: 'f-escopo', uf: 'f-uf', modalidade: 'f-modalidade' };
  for (const [k, id] of Object.entries(campos)) {
    const el = document.getElementById(id);
    el.value = filtros[k];
    el.addEventListener(k === 'busca' ? 'input' : 'change', () => {
      filtros[k] = el.value;
      const { busca, ...lembrar } = filtros;
      prefGravar('licitacoes:filtros', lembrar);
      render();
    });
  }
  document.getElementById('f-limpar').addEventListener('click', () => {
    filtros = { ...PADRAO };
    prefGravar('licitacoes:filtros', {});
    for (const [k, id] of Object.entries(campos)) document.getElementById(id).value = filtros[k];
    render();
  });
}

function atualizarOpcoes() {
  const unicos = f => [...new Set(licitacoes.flatMap(f).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  const escopos = unicos(l => l.escopo || []);
  preencherSelect(document.getElementById('f-escopo'), escopos.map(e => [e, ESCOPO_LABELS[e] || e]), 'Todos os escopos');
  const ufs = unicos(l => [l.uf]);
  preencherSelect(document.getElementById('f-uf'), ufs.map(u => [u, u]), 'Todos os estados');
  const modalidades = unicos(l => [l.modalidade]);
  preencherSelect(document.getElementById('f-modalidade'), modalidades.map(m => [m, m]), 'Todas as modalidades');
  for (const [k, lista] of [['escopo', escopos], ['uf', ufs], ['modalidade', modalidades]]) {
    document.getElementById(`f-${k}`).value = lista.includes(filtros[k]) ? filtros[k] : '';
  }
}

// ---------------------------------------------------------------- cartão

function campo(rotulo, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `<div class="detalhe__item"><span class="u-rotulo">${escapeHTML(rotulo)}</span><div>${escapeHTML(valor)}</div></div>`;
}

function seletorSituacao(l) {
  return `<select class="licitacao__situacao js-situacao" aria-label="Situação">${Object.entries(SITUACOES)
    .map(([v, r]) => `<option value="${v}"${(l.status_interno || 'monitorando') === v ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
}

function detalhe(l) {
  return `
    <div class="detalhe">
      <p class="licitacao__objeto-inteiro">${escapeHTML(legivel(l.objeto))}</p>
      <div class="detalhe__grade">
        ${campo('Órgão', l.orgao)}
        ${campo('Unidade', l.unidade && l.unidade !== l.orgao ? l.unidade : null)}
        ${campo('Esfera', ESFERA[l.esfera])}
        ${campo('Modalidade', [l.modalidade, l.modo_disputa].filter(Boolean).join(' · '))}
        ${campo('Valor estimado', dinheiro(l.valor_estimado) || 'Não informado')}
        ${campo('Registro de preços', l.srp === true ? 'Sim' : l.srp === false ? 'Não' : null)}
        ${campo('Abertura das propostas', dataHora(l.abertura))}
        ${campo('Fim das propostas', dataHora(l.encerramento))}
        ${campo('Publicada no PNCP', formatarData(l.publicado_em))}
      </div>
      ${l.informacao_complementar ? `<p class="u-apoio licitacao__complemento">${escapeHTML(l.informacao_complementar)}</p>` : ''}
      <label class="u-campo licitacao__obs"><span>Observações</span><textarea class="js-obs" rows="2" maxlength="4000">${escapeHTML(l.observacoes || '')}</textarea></label>
      <div class="licitacao__links">
        ${l.link_pncp ? `<a class="detalhe__link" href="${escapeHTML(l.link_pncp)}" target="_blank" rel="noopener">Edital no PNCP ↗</a>` : ''}
        ${l.link_sistema ? `<a class="detalhe__link" href="${escapeHTML(l.link_sistema)}" target="_blank" rel="noopener">Sistema de propostas ↗</a>` : ''}
      </div>
    </div>`;
}

function renderCartao(l) {
  const d = diasDe(l);
  const fim = encerrada(l);
  const el = document.createElement('article');
  el.className = `concurso licitacao concurso--${urgencia(d, fim)}${fim || l.status_interno === 'descartado' ? ' is-apagado' : ''}`;
  el.tabIndex = 0;
  const tags = [
    `<span class="u-etiqueta${l.tipo_objeto === 'projeto' ? ' selo-novo' : ''}">${escapeHTML(TIPO_LABELS[l.tipo_objeto] || '')}</span>`,
    ...(l.escopo || []).map(e => `<span class="u-etiqueta suave">${escapeHTML(ESCOPO_LABELS[e] || e)}</span>`),
  ].join('');
  const valor = dinheiro(l.valor_estimado);
  el.innerHTML = `
    <div class="concurso__corpo">
      <div class="concurso__topo"><div class="concurso__tags">${tags}</div></div>
      <h2 class="concurso__titulo licitacao__objeto">${escapeHTML(legivel(l.objeto))}</h2>
      <p class="concurso__local">${escapeHTML([l.orgao, localDe(l)].filter(Boolean).join(' · '))}</p>
      <p class="licitacao__meta">${escapeHTML([l.modalidade, valor].filter(Boolean).join(' · '))}</p>
    </div>
    <div class="concurso__prazo">
      <span class="concurso__dias">${!fim && d !== null ? d : '—'}</span>
      <span class="concurso__prazo-texto">${fim ? 'Propostas encerradas' : d === null ? 'Prazo não informado' : `${d === 1 ? 'dia' : 'dias'} para o fim das propostas · ${formatarData(l.encerramento.slice(0, 10), { curta: true })}`}</span>
      ${seletorSituacao(l)}
    </div>
    ${detalhe(l)}`;
  ligarItem(el, l);
  const alternar = e => {
    if (e.target.closest('select, textarea, a, label')) return;
    const abrir = !el.classList.contains('is-aberto');
    document.querySelectorAll('.licitacao.is-aberto').forEach(o => o.classList.remove('is-aberto'));
    el.classList.toggle('is-aberto', abrir);
  };
  el.addEventListener('click', alternar);
  el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); alternar(e); } });
  return el;
}

// ---------------------------------------------------------------- lista

const COLUNAS = [
  { id: 'objeto', rotulo: 'Objeto' },
  { id: 'prazo', rotulo: 'Dias', classe: 'col-num' },
  { id: 'local', rotulo: 'Local', classe: 'col-media' },
  { id: 'tipo', rotulo: 'Tipo', classe: 'col-media' },
  { id: 'modalidade', rotulo: 'Modalidade', classe: 'col-larga' },
  { id: 'valor', rotulo: 'Valor estimado', classe: 'col-num col-larga' },
  { id: 'situacao', rotulo: 'Situação', classe: 'col-media', ordena: false },
];
let ordem = prefLer('licitacoes:ordem', { coluna: 'prazo', direcao: 'asc' });
const VALOR = {
  objeto: l => normalizar(l.objeto),
  prazo: l => (encerrada(l) ? null : diasDe(l)),
  local: l => localDe(l),
  tipo: l => TIPO_LABELS[l.tipo_objeto] || null,
  modalidade: l => l.modalidade || null,
  valor: l => l.valor_estimado ?? null,
};

function renderLista(itens) {
  const lista = document.getElementById('lista');
  const f = VALOR[ordem.coluna] || VALOR.prazo;
  const ordenados = [...itens].sort((a, b) => comparar(f(a), f(b), ordem.direcao) || comparar(VALOR.prazo(a), VALOR.prazo(b), 'asc'));
  lista.innerHTML = `<div class="tabela-rolagem"><table class="u-tabela tabela">${theadOrdenavel(COLUNAS, ordem)}<tbody></tbody></table></div>`;
  const corpo = lista.querySelector('tbody');
  for (const l of ordenados) {
    const d = diasDe(l);
    const fim = encerrada(l);
    const tr = document.createElement('tr');
    tr.className = `linha linha--${urgencia(d, fim)}${fim || l.status_interno === 'descartado' ? ' is-apagado' : ''}`;
    tr.innerHTML = `
      <td><a class="linha__titulo licitacao__objeto-linha" href="${escapeHTML(l.link_pncp || l.link_sistema || '#')}" target="_blank" rel="noopener">${escapeHTML(legivel(l.objeto))}</a>
        <div class="u-apoio">${escapeHTML(l.orgao || '')}</div></td>
      <td class="col-num"><span class="dias">${!fim && d !== null ? d : '—'}</span></td>
      <td class="col-media">${escapeHTML(localDe(l))}</td>
      <td class="col-media">${escapeHTML(TIPO_LABELS[l.tipo_objeto] || '')}</td>
      <td class="col-larga">${escapeHTML(l.modalidade || '')}</td>
      <td class="col-num col-larga">${escapeHTML(dinheiro(l.valor_estimado) || '')}</td>
      <td class="col-media">${seletorSituacao(l)}</td>`;
    ligarItem(tr, l);
    corpo.appendChild(tr);
  }
  ligarOrdenacao(lista.querySelector('table'), ordem, () => { prefGravar('licitacoes:ordem', ordem); render(); });
}

// ---------------------------------------------------------------- situação e observações

async function salvar(l, corpo) {
  const res = await fetch(`${WORKER}/api/licitacoes/${encodeURIComponent(l.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error || `Worker respondeu ${res.status}`);
  const i = licitacoes.findIndex(x => x.id === r.id);
  if (i >= 0) licitacoes[i] = r;
  cacheGravar(CHAVE, licitacoes);
  return r;
}

function ligarItem(raiz, l) {
  raiz.querySelector('.js-situacao')?.addEventListener('change', async e => {
    const anterior = l.status_interno || 'monitorando';
    try {
      await salvar(l, { status_interno: e.target.value });
      notificar(`Situação: ${SITUACOES[e.target.value]}.`);
      render();
    } catch (err) {
      e.target.value = anterior;
      notificar(`Não foi possível salvar: ${err.message}`, { erro: true });
    }
  });
  raiz.querySelector('.js-obs')?.addEventListener('change', async e => {
    try {
      await salvar(l, { observacoes: e.target.value });
      notificar('Observações salvas.');
    } catch (err) {
      notificar(`Não foi possível salvar: ${err.message}`, { erro: true });
    }
  });
}

// ---------------------------------------------------------------- página

function render() {
  const visiveis = licitacoes.filter(passa);
  const vista = vistaAtual();
  const grade = document.getElementById('grade');
  const lista = document.getElementById('lista');
  grade.hidden = vista !== 'cartoes';
  lista.hidden = vista !== 'lista';
  if (vista === 'cartoes') {
    const ordenados = [...visiveis].sort((a, b) => comparar(encerrada(a) ? null : diasDe(a), encerrada(b) ? null : diasDe(b), 'asc'));
    grade.replaceChildren(...ordenados.map(renderCartao));
    lista.innerHTML = '';
  } else {
    grade.replaceChildren();
    renderLista(visiveis);
  }
  document.getElementById('empty-state').hidden = visiveis.length > 0;
  document.getElementById('f-limpar').hidden = !Object.keys(PADRAO).some(k => filtros[k] !== PADRAO[k]);

  const soProjeto = visiveis.filter(l => l.tipo_objeto === 'projeto').length;
  const urgentes = visiveis.filter(l => { const d = diasDe(l); return d !== null && d >= 0 && d <= 15; }).length;
  const partes = [plural(visiveis.length, 'licitação', 'licitações')];
  if (soProjeto) partes.push(`${soProjeto} só de projeto`);
  if (urgentes) partes.push(`${urgentes} fecha${urgentes === 1 ? '' : 'm'} em até 15 dias`);
  document.getElementById('resumo').textContent = partes.join(' · ');

  const el = document.getElementById('updated-at');
  const vistas = licitacoes.map(l => new Date(l.visto_em || l.coletado_em).getTime()).filter(t => !Number.isNaN(t));
  el.textContent = vistas.length ? `Última coleta ${formatarData(new Date(Math.max(...vistas)).toISOString())}` : '';
  const copia = cacheIdade(CHAVE);
  el.title = copia ? `Dados guardados neste navegador às ${formatarHora(copia)}` : '';
}

function receber(dados) {
  licitacoes = Array.isArray(dados) ? dados : [];
  atualizarOpcoes();
  render();
}

function init() {
  vistaAtual = ligarVista(document.getElementById('vista'), 'licitacoes:vista', render);
  ligarFiltros();
  if (!cacheLer(CHAVE)) document.getElementById('resumo').textContent = 'Carregando licitações…';
  carregarComCache(CHAVE, LICITACOES_URL, receber);

  const recarregar = document.getElementById('recarregar');
  recarregar.addEventListener('click', async () => {
    recarregar.disabled = true;
    recarregar.textContent = 'Recarregando…';
    avisar('');
    await carregarComCache(CHAVE, LICITACOES_URL, receber, { forcar: true });
    recarregar.disabled = false;
    recarregar.textContent = 'Recarregar';
  });
}

init();
