// Radar Odisse — Licitações (PNCP)
//
// Duas fases, em abas na mesma página:
//   - Abertas: contratações de projeto com propostas abertas. Cartão no desenho dos concursos (borda
//     pelo prazo, clique abre o detalhe).
//   - Contratadas: contratos de obra assinados; a pista é a construtora vencedora, que vai precisar de
//     arquitetura. Cartão no desenho de Terrenos (borda pelo nível 1–3), com o contato da vencedora.
//     Os contratos só de projeto (Brasil inteiro) também estão aqui, mas ocultos por padrão: servem ao
//     mapa de preços do Universo, não ao Radar. Aparecem com o filtro "Só projeto (mapa de preços)".
// Dados do Worker com cache no navegador (carregarComCache, em comum.js): a página abre na hora com a
// última cópia e atualiza por baixo.

const LICITACOES_URL = `${WORKER}/api/licitacoes`;
const CHAVE = 'licitacoes';

const SITUACOES = {
  abertas: { monitorando: 'Monitorando', acompanhando: 'Acompanhando', participando: 'Participando', descartado: 'Descartada' },
  contratadas: { monitorando: 'Monitorando', contatado: 'Contatada', parceria: 'Parceria', descartado: 'Descartada' },
};
const EM_CURSO = new Set(['acompanhando', 'participando', 'contatado', 'parceria']);
const ESCOPO_LABELS = { arquitetura: 'Arquitetura', urbanismo: 'Urbanismo', paisagismo: 'Paisagismo', interiores: 'Interiores', restauro: 'Restauro', complementares: 'Complementares' };
const TIPO_LABELS = { projeto: 'Só projeto', projeto_e_obra: 'Projeto e obra', obra: 'Obra' };
const NIVEL_LABELS = { 3: 'Nível 3 · Vencedora entrega projeto', 2: 'Nível 2 · Obra nova ou grande', 1: 'Nível 1 · Reforma' };
const ESFERA = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };

let licitacoes = [];
let vistaAtual = () => 'cartoes';
// ?fase=abertas|contratadas (vindo do Início do Universo) escolhe a aba
let fase = (() => { try { const f = new URLSearchParams(location.search).get('fase'); if (f === 'abertas' || f === 'contratadas') return f; } catch { /* segue */ } return prefLer('licitacoes:fase', 'abertas'); })();

const ehContratada = l => l.fase === 'contratada';
const ehProjetoContratado = l => ehContratada(l) && l.tipo_objeto === 'projeto';
const daFase = l => ehContratada(l) === (fase === 'contratadas');

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
const valorDe = l => (ehContratada(l) ? l.valor_global : l.valor_estimado) ?? null;

/** Muitos órgãos escrevem o objeto em maiúsculas: vira frase comum, só para ler melhor (nomes de órgão e empresa ficam como vêm). */
function legivel(t) {
  if (!t) return '';
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const maiusculas = letras.replace(/[^A-ZÀ-Þ]/g, '').length;
  if (letras.length < 12 || maiusculas / letras.length < 0.7) return t;
  const m = t.toLocaleLowerCase('pt-BR');
  return m.charAt(0).toLocaleUpperCase('pt-BR') + m.slice(1);
}

/** +558332221100 → (83) 3222-1100 */
function telefone(tel) {
  const d = (tel || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel || '';
}
const celular = tel => /^\+55\d{2}9\d{8}$/.test(tel || '');

function cnpjFormatado(c) {
  return /^\d{14}$/.test(c || '') ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '');
}

/** Contatos públicos da vencedora (Receita): telefone (WhatsApp se for celular) e e-mail, como links. */
function contatosVencedora(v = {}) {
  const itens = (v.telefones || []).map(t => (celular(t)
    ? `<a href="https://wa.me/${escapeHTML(t.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp ${escapeHTML(telefone(t))}</a>`
    : `<a href="tel:${escapeHTML(t)}">Tel. ${escapeHTML(telefone(t))}</a>`));
  if (v.email) itens.push(`<a href="mailto:${escapeHTML(v.email)}">${escapeHTML(v.email)}</a>`);
  return itens;
}

// ---------------------------------------------------------------- filtros (um conjunto por fase)

const PADRAO = {
  abertas: { busca: '', situacao: 'ativas', prazo: '', nivel: '', tipo: '', escopo: '', uf: '', modalidade: '' },
  contratadas: { busca: '', situacao: 'ativas', prazo: '', nivel: '', tipo: '', escopo: '', uf: '', modalidade: '' },
};
const filtrosDe = f => ({ ...PADRAO[f], ...prefLer(`licitacoes:filtros:${f}`, {}), busca: '' });
let filtros = filtrosDe(fase);

const CAMPOS = { busca: 'f-busca', situacao: 'f-situacao', prazo: 'f-prazo', nivel: 'f-nivel', tipo: 'f-tipo', escopo: 'f-escopo', uf: 'f-uf', modalidade: 'f-modalidade' };

function passa(l) {
  if (NOVOS_DIA) return novoNoDia(l) && l.status_interno !== 'descartado' && !ehProjetoContratado(l); // vindo do Início do Universo
  const descartada = l.status_interno === 'descartado';
  const fora = descartada || (!ehContratada(l) && encerrada(l));
  if (filtros.situacao === 'ativas' && fora) return false;
  if (filtros.situacao === 'emcurso' && !EM_CURSO.has(l.status_interno)) return false;
  if (filtros.situacao === 'ocultas' && !fora) return false;
  if (filtros.busca) {
    const alvo = normalizar(`${l.objeto} ${l.orgao || ''} ${l.unidade || ''} ${l.municipio || ''} ${l.vencedor?.nome || ''} ${l.vencedor?.nome_fantasia || ''} ${l.observacoes || ''}`);
    if (!normalizar(filtros.busca).split(/\s+/).filter(Boolean).every(t => alvo.includes(t))) return false;
  }
  if (fase === 'abertas' && filtros.prazo) {
    const d = diasDe(l);
    if (d === null || d < 0) return false;
    if (filtros.prazo === '15' && d > 15) return false;
    if (filtros.prazo === '45' && (d <= 15 || d > 45)) return false;
    if (filtros.prazo === 'mais' && d <= 45) return false;
  }
  if (fase === 'contratadas' && filtros.nivel && filtros.tipo !== 'projeto') {
    if (filtros.nivel === '2+' ? (l.nivel || 0) < 2 : String(l.nivel) !== filtros.nivel) return false;
  }
  // Contratos só de projeto: só com o filtro próprio (são do mapa de preços, não pistas).
  if (fase === 'contratadas' && !filtros.tipo && ehProjetoContratado(l)) return false;
  if (filtros.tipo && l.tipo_objeto !== filtros.tipo) return false;
  if (filtros.escopo && !(l.escopo || []).includes(filtros.escopo)) return false;
  if (filtros.uf && l.uf !== filtros.uf) return false;
  if (fase === 'abertas' && filtros.modalidade && l.modalidade !== filtros.modalidade) return false;
  return true;
}

/** Monta os controles que mudam de uma fase para a outra. */
function prepararControles() {
  const sit = document.getElementById('f-situacao');
  sit.innerHTML = fase === 'abertas'
    ? '<option value="ativas">Propostas abertas</option><option value="emcurso">Acompanhando ou participando</option><option value="ocultas">Encerradas ou descartadas</option><option value="todas">Todas as situações</option>'
    : '<option value="ativas">Não descartadas</option><option value="emcurso">Contatadas ou em parceria</option><option value="ocultas">Descartadas</option><option value="todas">Todas as situações</option>';
  const tipo = document.getElementById('f-tipo');
  tipo.innerHTML = fase === 'abertas'
    ? '<option value="">Projeto ou projeto e obra</option><option value="projeto">Só projeto</option><option value="projeto_e_obra">Projeto e obra</option>'
    : '<option value="">Obra ou projeto e obra</option><option value="projeto_e_obra">Projeto e obra</option><option value="obra">Só obra</option><option value="projeto">Só projeto (mapa de preços)</option>';
  document.getElementById('f-prazo').hidden = fase !== 'abertas';
  document.getElementById('f-modalidade').hidden = fase !== 'abertas';
  document.getElementById('f-nivel').hidden = fase !== 'contratadas' || filtros.tipo === 'projeto';
  document.getElementById('f-busca').placeholder = fase === 'abertas' ? 'Buscar no objeto, órgão ou município' : 'Buscar no objeto, órgão, município ou construtora';
  document.getElementById('intro-abertas').hidden = fase !== 'abertas';
  document.getElementById('intro-contratadas').hidden = fase !== 'contratadas';
  for (const [k, id] of Object.entries(CAMPOS)) document.getElementById(id).value = filtros[k];
}

function ligarFiltros() {
  for (const [k, id] of Object.entries(CAMPOS)) {
    const el = document.getElementById(id);
    el.addEventListener(k === 'busca' ? 'input' : 'change', () => {
      filtros[k] = el.value;
      if (k === 'tipo') document.getElementById('f-nivel').hidden = fase !== 'contratadas' || filtros.tipo === 'projeto';
      const { busca, ...lembrar } = filtros;
      prefGravar(`licitacoes:filtros:${fase}`, lembrar);
      render();
    });
  }
  document.getElementById('f-limpar').addEventListener('click', () => {
    filtros = { ...PADRAO[fase] };
    prefGravar(`licitacoes:filtros:${fase}`, {});
    prepararControles();
    atualizarOpcoes();
    render();
  });
}

function ligarFases() {
  const grupo = document.getElementById('fase');
  const marcar = () => grupo.querySelectorAll('button').forEach(b => {
    const ativo = b.dataset.fase === fase;
    b.classList.toggle('is-ativo', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  });
  grupo.addEventListener('click', e => {
    const b = e.target.closest('button[data-fase]');
    if (!b || b.dataset.fase === fase) return;
    fase = b.dataset.fase;
    prefGravar('licitacoes:fase', fase);
    filtros = filtrosDe(fase);
    marcar();
    prepararControles();
    atualizarOpcoes();
    render();
  });
  marcar();
}

function atualizarContagemFases() {
  const n = f => licitacoes.filter(l => ehContratada(l) === (f === 'contratadas') && !ehProjetoContratado(l) && l.status_interno !== 'descartado' && !(f === 'abertas' && encerrada(l))).length;
  for (const f of ['abertas', 'contratadas']) {
    const el = document.getElementById(`contador-${f}`);
    const v = n(f);
    el.textContent = v;
    el.hidden = !v;
  }
}

function atualizarOpcoes() {
  const itens = licitacoes.filter(daFase);
  const unicos = f => [...new Set(itens.flatMap(f).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  const escopos = unicos(l => l.escopo || []);
  preencherSelect(document.getElementById('f-escopo'), escopos.map(e => [e, ESCOPO_LABELS[e] || e]), 'Todos os escopos');
  const ufs = unicos(l => [l.uf]);
  preencherSelect(document.getElementById('f-uf'), ufs.map(u => [u, u]), 'Todos os estados');
  const modalidades = unicos(l => [l.modalidade]);
  preencherSelect(document.getElementById('f-modalidade'), modalidades.map(m => [m, m]), 'Todas as modalidades');
  for (const [k, lista] of [['escopo', escopos], ['uf', ufs], ['modalidade', modalidades]]) {
    document.getElementById(`f-${k}`).value = lista.includes(filtros[k]) ? filtros[k] : '';
  }
  atualizarContagemFases();
}

// ---------------------------------------------------------------- peças comuns

function campo(rotulo, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `<div class="detalhe__item"><span class="u-rotulo">${escapeHTML(rotulo)}</span><div>${escapeHTML(valor)}</div></div>`;
}

function seletorSituacao(l) {
  const opcoes = SITUACOES[ehContratada(l) ? 'contratadas' : 'abertas'];
  return `<select class="licitacao__situacao js-situacao" aria-label="Situação">${Object.entries(opcoes)
    .map(([v, r]) => `<option value="${v}"${(l.status_interno || 'monitorando') === v ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
}

/** Links do PNCP para consulta rápida: contrato assinado, termo de referência, edital. */
function linksDocumentos(l) {
  const d = l.documentos || {};
  const a = (doc, rotulo) => (doc?.url ? `<a class="detalhe__link" href="${escapeHTML(doc.url)}" target="_blank" rel="noopener" title="${escapeHTML(doc.titulo || '')}">${rotulo} ↗</a>` : '');
  const trRotulo = !d.tr ? '' : /termo de refer/i.test(d.tr.tipo || d.tr.titulo || '') ? 'Termo de referência' : `Termo de referência (${(d.tr.tipo || 'documento').toLowerCase()})`;
  return [a(d.contrato, 'Contrato'), d.tr ? a(d.tr, trRotulo) : '', a(d.edital, 'Edital')].filter(Boolean).join('');
}

const tagsEscopo = l => (l.escopo || []).map(e => `<span class="u-etiqueta suave">${escapeHTML(ESCOPO_LABELS[e] || e)}</span>`).join('');
const obsCampo = l => `<label class="u-campo licitacao__obs"><span>Observações</span><textarea class="js-obs" rows="2" maxlength="4000">${escapeHTML(l.observacoes || '')}</textarea></label>`;

// ---------------------------------------------------------------- abertas: cartão

function detalheAberta(l) {
  const contrato = l.contrato_id && licitacoes.find(x => x.id === l.contrato_id);
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
        ${contrato ? campo('Contratada', `${contrato.vencedor?.nome || ''} · ${dinheiro(contrato.valor_global) || ''}`) : ''}
      </div>
      ${l.informacao_complementar ? `<p class="u-apoio licitacao__complemento">${escapeHTML(l.informacao_complementar)}</p>` : ''}
      ${obsCampo(l)}
      <div class="licitacao__links">
        ${l.link_pncp ? `<a class="detalhe__link" href="${escapeHTML(l.link_pncp)}" target="_blank" rel="noopener">Edital no PNCP ↗</a>` : ''}
        ${l.link_sistema ? `<a class="detalhe__link" href="${escapeHTML(l.link_sistema)}" target="_blank" rel="noopener">Sistema de propostas ↗</a>` : ''}
        ${linksDocumentos(l)}
      </div>
    </div>`;
}

function renderCartaoAberta(l) {
  const d = diasDe(l);
  const fim = encerrada(l);
  const el = document.createElement('article');
  el.className = `concurso licitacao concurso--${urgencia(d, fim)}${fim || l.status_interno === 'descartado' ? ' is-apagado' : ''}`;
  el.tabIndex = 0;
  const tags = `<span class="u-etiqueta${l.tipo_objeto === 'projeto' ? ' selo-novo' : ''}">${escapeHTML(TIPO_LABELS[l.tipo_objeto] || '')}</span>${l.contrato_id ? '<span class="u-etiqueta">Contratada</span>' : ''}${tagsEscopo(l)}`;
  el.innerHTML = `
    <div class="concurso__corpo">
      <div class="concurso__topo"><div class="concurso__tags">${tags}</div></div>
      <h2 class="concurso__titulo licitacao__objeto">${escapeHTML(legivel(l.objeto))}</h2>
      <p class="concurso__local">${escapeHTML([l.orgao, localDe(l)].filter(Boolean).join(' · '))}</p>
      <p class="licitacao__meta">${escapeHTML([l.modalidade, dinheiro(l.valor_estimado)].filter(Boolean).join(' · '))}</p>
    </div>
    <div class="concurso__prazo">
      <span class="concurso__dias">${!fim && d !== null ? d : '—'}</span>
      <span class="concurso__prazo-texto">${fim ? 'Propostas encerradas' : d === null ? 'Prazo não informado' : `${d === 1 ? 'dia' : 'dias'} para o fim das propostas · ${formatarData(l.encerramento.slice(0, 10), { curta: true })}`}</span>
      ${seletorSituacao(l)}
    </div>
    ${detalheAberta(l)}`;
  ligarItem(el, l);
  ligarAbrir(el);
  return el;
}

function ligarAbrir(el) {
  const alternar = e => {
    if (e.target.closest('select, textarea, a, label, button')) return;
    const abrir = !el.classList.contains('is-aberto');
    document.querySelectorAll('.licitacao.is-aberto').forEach(o => o.classList.remove('is-aberto'));
    el.classList.toggle('is-aberto', abrir);
  };
  el.addEventListener('click', alternar);
  el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); alternar(e); } });
}

// ---------------------------------------------------------------- contratadas: cartão

function renderCartaoContratada(l) {
  if (ehProjetoContratado(l)) return renderCartaoProjeto(l);
  const v = l.vencedor || {};
  const el = document.createElement('article');
  el.className = `oportunidade contratada oportunidade--nivel-${l.nivel}${l.status_interno === 'descartado' ? ' is-apagado' : ''}`;
  const contatos = contatosVencedora(v);
  el.innerHTML = `
    <div class="oportunidade__tags">
      <span class="u-etiqueta ${l.nivel >= 3 ? 'nivel-3' : l.nivel === 2 ? 'nivel-2' : 'nivel-1'}">${escapeHTML(NIVEL_LABELS[l.nivel] || `Nível ${l.nivel}`)}</span>
      ${tagsEscopo(l)}
    </div>
    <h3 class="oportunidade__titulo licitacao__objeto">${l.link_pncp ? `<a href="${escapeHTML(l.link_pncp)}" target="_blank" rel="noopener">${escapeHTML(legivel(l.objeto))}</a>` : escapeHTML(legivel(l.objeto))}</h3>
    <p class="oportunidade__local">${escapeHTML([l.orgao, localDe(l)].filter(Boolean).join(' · '))}</p>
    <div class="contratada__vencedora">
      <span class="u-rotulo">Vencedora</span>
      <p class="corretor__nome">${escapeHTML(v.nome || '—')}</p>
      <p class="u-apoio">${escapeHTML([v.nome_fantasia && v.nome_fantasia !== v.nome ? v.nome_fantasia : null, `CNPJ ${cnpjFormatado(v.cnpj)}`, v.cidade || null].filter(Boolean).join(' · '))}</p>
      ${contatos.length ? `<div class="corretor__contatos">${contatos.join('')}</div>` : '<p class="u-apoio">Sem contato público na Receita.</p>'}
    </div>
    ${linksDocumentos(l) ? `<div class="licitacao__links">${linksDocumentos(l)}</div>` : ''}
    <details class="contratada__mais"><summary>Observações</summary>${obsCampo(l)}</details>
    <div class="oportunidade__rodape">
      <span>${escapeHTML([dinheiro(l.valor_global), l.assinatura ? `assinado ${formatarData(l.assinatura)}` : null].filter(Boolean).join(' · '))}</span>
      ${seletorSituacao(l)}
    </div>`;
  ligarItem(el, l);
  return el;
}

// ---------------------------------------------------------------- contratadas só de projeto (mapa de preços)

const FASE_LABELS = { levantamento: 'Levantamento', estudo_preliminar: 'Estudo preliminar', anteprojeto: 'Anteprojeto', projeto_legal: 'Projeto legal', projeto_basico: 'Projeto básico', projeto_executivo: 'Projeto executivo', detalhamento: 'Detalhamento', as_built: 'As built', assistencia_obra: 'Assistência à obra' };
const DISCIPLINA_LABELS = { arquitetura: 'Arquitetura', interiores: 'Interiores', paisagismo: 'Paisagismo', urbanismo: 'Urbanismo', restauro: 'Restauro', estrutura: 'Estrutura', eletrica: 'Elétrica', hidrossanitario: 'Hidrossanitário', incendio: 'Incêndio', climatizacao: 'Climatização', dados_e_voz: 'Dados e voz', spda: 'SPDA', orcamento: 'Orçamento', acessibilidade: 'Acessibilidade' };
const m2 = n => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m²`;
const porM2 = l => (l.tr?.area_m2 && l.valor_global ? Math.round(l.valor_global / l.tr.area_m2) : null);

/** O que o termo de referência diz (palpite: os trechos estão no detalhe, para conferir no documento). */
function resumoTR(l) {
  const tr = l.tr;
  if (!tr) return l.documentos?.tr ? '<p class="u-apoio">Termo de referência ainda não lido.</p>' : '<p class="u-apoio">Sem termo de referência publicado no PNCP.</p>';
  if (tr.legivel === false) return `<p class="u-apoio">Termo de referência não lido${tr.erro ? `: ${escapeHTML(tr.erro)}` : ' (sem texto: escaneado?)'}.</p>`;
  return `<div class="detalhe__grade">
    ${campo('Área (palpite do TR)', tr.area_m2 ? m2(tr.area_m2) : 'Não achada')}
    ${campo('Preço por m²', porM2(l) ? `${dinheiro(porM2(l))}/m²` : null)}
    ${campo('Fases citadas', (tr.fases || []).map(f => FASE_LABELS[f] || f).join(', '))}
    ${campo('Disciplinas citadas', (tr.disciplinas || []).map(d => DISCIPLINA_LABELS[d] || d).join(', '))}
    ${campo('BIM', tr.bim ? 'Sim' : null)}
    ${campo('Prazo', tr.prazo ? `${tr.prazo.valor} ${tr.prazo.unidade}` : null)}
  </div>`;
}

/** Trechos do TR (o registro inteiro, buscado ao abrir). */
async function carregarTrechos(el, l) {
  const alvo = el.querySelector('.js-trechos');
  if (!alvo || alvo.dataset.carregado) return;
  alvo.dataset.carregado = '1';
  alvo.innerHTML = '<p class="u-apoio">Carregando os trechos…</p>';
  try {
    const res = await fetch(`${WORKER}/api/licitacoes/${encodeURIComponent(l.id)}`);
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || res.status);
    const areas = r.tr?.areas || [];
    alvo.innerHTML = [
      ...areas.map(a => `<p class="licitacao__trecho"><strong>${escapeHTML(m2(a.m2))}${a.do_objeto ? '' : ' (?)'}</strong> — “${escapeHTML(a.trecho)}”</p>`),
      r.tr?.prazo?.trecho ? `<p class="licitacao__trecho"><strong>Prazo</strong> — “${escapeHTML(r.tr.prazo.trecho)}”</p>` : '',
      r.tr?.documento ? `<p class="u-apoio">Lido de: ${escapeHTML(r.tr.documento)}</p>` : '',
    ].join('') || '<p class="u-apoio">Nenhum trecho com área ou prazo.</p>';
  } catch (err) {
    alvo.innerHTML = `<p class="u-apoio">Não deu para carregar: ${escapeHTML(err.message)}</p>`;
  }
}

function renderCartaoProjeto(l) {
  const v = l.vencedor || {};
  const el = document.createElement('article');
  el.className = `oportunidade contratada contratada--projeto${l.status_interno === 'descartado' ? ' is-apagado' : ''}`;
  el.innerHTML = `
    <div class="oportunidade__tags">
      <span class="u-etiqueta selo-novo">Só projeto · mapa de preços</span>
      ${tagsEscopo(l)}
    </div>
    <h3 class="oportunidade__titulo licitacao__objeto">${l.link_pncp ? `<a href="${escapeHTML(l.link_pncp)}" target="_blank" rel="noopener">${escapeHTML(legivel(l.objeto))}</a>` : escapeHTML(legivel(l.objeto))}</h3>
    <p class="oportunidade__local">${escapeHTML([l.orgao, localDe(l), ESFERA[l.esfera]].filter(Boolean).join(' · '))}</p>
    <div class="contratada__vencedora">
      <span class="u-rotulo">Contratada</span>
      <p class="corretor__nome">${escapeHTML(v.nome || '—')}</p>
      <p class="u-apoio">${escapeHTML(v.pessoa === 'fisica' ? 'Pessoa física' : v.cnpj ? `CNPJ ${cnpjFormatado(v.cnpj)}` : '')}</p>
    </div>
    ${resumoTR(l)}
    ${linksDocumentos(l) ? `<div class="licitacao__links">${linksDocumentos(l)}</div>` : ''}
    ${l.tr?.legivel ? '<details class="contratada__mais js-abrir-trechos"><summary>Trechos do termo de referência</summary><div class="js-trechos"></div></details>' : ''}
    <details class="contratada__mais"><summary>Observações</summary>${obsCampo(l)}</details>
    <div class="oportunidade__rodape">
      <span>${escapeHTML([dinheiro(l.valor_global), l.assinatura ? `assinado ${formatarData(l.assinatura)}` : null].filter(Boolean).join(' · '))}</span>
      ${seletorSituacao(l)}
    </div>`;
  el.querySelector('.js-abrir-trechos')?.addEventListener('toggle', e => { if (e.target.open) carregarTrechos(el, l); });
  ligarItem(el, l);
  return el;
}

// ---------------------------------------------------------------- lista

const COLUNAS = {
  abertas: [
    { id: 'objeto', rotulo: 'Objeto' },
    { id: 'prazo', rotulo: 'Dias', classe: 'col-num' },
    { id: 'local', rotulo: 'Local', classe: 'col-media' },
    { id: 'tipo', rotulo: 'Tipo', classe: 'col-media' },
    { id: 'modalidade', rotulo: 'Modalidade', classe: 'col-larga' },
    { id: 'valor', rotulo: 'Valor estimado', classe: 'col-num col-larga' },
    { id: 'situacao', rotulo: 'Situação', classe: 'col-media', ordena: false },
  ],
  contratadas: [
    { id: 'objeto', rotulo: 'Obra' },
    { id: 'nivel', rotulo: 'Nível', classe: 'col-num' },
    { id: 'vencedora', rotulo: 'Vencedora' },
    { id: 'contato', rotulo: 'Contato', classe: 'col-larga', ordena: false },
    { id: 'local', rotulo: 'Local', classe: 'col-media' },
    { id: 'valor', rotulo: 'Valor', classe: 'col-num col-larga' },
    { id: 'assinatura', rotulo: 'Assinado', classe: 'col-num col-larga' },
    { id: 'situacao', rotulo: 'Situação', classe: 'col-media', ordena: false },
  ],
};
// Só projeto (mapa de preços): sem nível nem contato; o valor leva a área e o preço por m².
COLUNAS.precos = [
  { id: 'objeto', rotulo: 'Projeto contratado' },
  { id: 'vencedora', rotulo: 'Contratada' },
  { id: 'documentos', rotulo: 'Documentos', classe: 'col-larga', ordena: false },
  { id: 'local', rotulo: 'Local', classe: 'col-media' },
  { id: 'valor', rotulo: 'Valor', classe: 'col-num col-larga' },
  { id: 'porm2', rotulo: 'R$/m²', classe: 'col-num' },
  { id: 'assinatura', rotulo: 'Assinado', classe: 'col-num col-larga' },
  { id: 'situacao', rotulo: 'Situação', classe: 'col-media', ordena: false },
];
const ordens = {
  abertas: prefLer('licitacoes:ordem', { coluna: 'prazo', direcao: 'asc' }),
  contratadas: prefLer('licitacoes:ordem:contratadas', { coluna: 'nivel', direcao: 'desc' }),
};
const VALOR = {
  objeto: l => normalizar(l.objeto),
  prazo: l => (encerrada(l) ? null : diasDe(l)),
  nivel: l => l.nivel ?? null,
  vencedora: l => normalizar(l.vencedor?.nome),
  local: l => localDe(l),
  tipo: l => TIPO_LABELS[l.tipo_objeto] || null,
  modalidade: l => l.modalidade || null,
  valor: l => valorDe(l),
  assinatura: l => l.assinatura || null,
  porm2: l => porM2(l),
};

function renderLista(itens) {
  const lista = document.getElementById('lista');
  const ordem = ordens[fase];
  const f = VALOR[ordem.coluna] || VALOR.objeto;
  const desempate = fase === 'abertas' ? (a, b) => comparar(VALOR.prazo(a), VALOR.prazo(b), 'asc') : (a, b) => comparar(VALOR.assinatura(a), VALOR.assinatura(b), 'desc');
  const ordenados = [...itens].sort((a, b) => comparar(f(a), f(b), ordem.direcao) || desempate(a, b));
  const colunas = fase === 'contratadas' && filtros.tipo === 'projeto' ? COLUNAS.precos : COLUNAS[fase];
  lista.innerHTML = `<div class="tabela-rolagem"><table class="u-tabela tabela">${theadOrdenavel(colunas, ordem)}<tbody></tbody></table></div>`;
  const corpo = lista.querySelector('tbody');
  for (const l of ordenados) {
    const tr = document.createElement('tr');
    const objeto = `<a class="linha__titulo licitacao__objeto-linha" href="${escapeHTML(l.link_pncp || l.link_sistema || '#')}" target="_blank" rel="noopener">${escapeHTML(legivel(l.objeto))}</a>`;
    if (fase === 'abertas') {
      const d = diasDe(l);
      const fim = encerrada(l);
      tr.className = `linha linha--${urgencia(d, fim)}${fim || l.status_interno === 'descartado' ? ' is-apagado' : ''}`;
      tr.innerHTML = `
        <td>${objeto}<div class="u-apoio">${escapeHTML(l.orgao || '')}</div></td>
        <td class="col-num"><span class="dias">${!fim && d !== null ? d : '—'}</span></td>
        <td class="col-media">${escapeHTML(localDe(l))}</td>
        <td class="col-media">${escapeHTML(TIPO_LABELS[l.tipo_objeto] || '')}</td>
        <td class="col-larga">${escapeHTML(l.modalidade || '')}</td>
        <td class="col-num col-larga">${escapeHTML(dinheiro(l.valor_estimado) || '')}</td>
        <td class="col-media">${seletorSituacao(l)}</td>`;
    } else if (ehProjetoContratado(l)) {
      tr.className = `linha${l.status_interno === 'descartado' ? ' is-apagado' : ''}`;
      tr.innerHTML = `
        <td>${objeto}<div class="u-apoio">${escapeHTML(l.orgao || '')}</div></td>
        <td>${escapeHTML(l.vencedor?.nome || '')}</td>
        <td class="col-larga"><div class="licitacao__links">${linksDocumentos(l)}</div></td>
        <td class="col-media">${escapeHTML(localDe(l))}</td>
        <td class="col-num col-larga">${escapeHTML(dinheiro(l.valor_global) || '')}${l.tr?.area_m2 ? `<div class="u-apoio">${escapeHTML(m2(l.tr.area_m2))}</div>` : ''}</td>
        <td class="col-num">${porM2(l) ? escapeHTML(dinheiro(porM2(l))) : ''}</td>
        <td class="col-num col-larga">${formatarData(l.assinatura)}</td>
        <td class="col-media">${seletorSituacao(l)}</td>`;
    } else {
      tr.className = `linha linha--nivel-${l.nivel}${l.status_interno === 'descartado' ? ' is-apagado' : ''}`;
      tr.innerHTML = `
        <td>${objeto}<div class="u-apoio">${escapeHTML(l.orgao || '')}</div></td>
        <td class="col-num">${l.nivel ?? ''}</td>
        <td>${escapeHTML(l.vencedor?.nome || '')}<div class="u-apoio">${escapeHTML(cnpjFormatado(l.vencedor?.cnpj))}</div></td>
        <td class="col-larga"><div class="corretor__contatos corretor__contatos--lista">${contatosVencedora(l.vencedor).join('')}</div></td>
        <td class="col-media">${escapeHTML(localDe(l))}</td>
        <td class="col-num col-larga">${escapeHTML(dinheiro(l.valor_global) || '')}</td>
        <td class="col-num col-larga">${formatarData(l.assinatura)}</td>
        <td class="col-media">${seletorSituacao(l)}</td>`;
    }
    ligarItem(tr, l);
    corpo.appendChild(tr);
  }
  ligarOrdenacao(lista.querySelector('table'), ordem, () => {
    prefGravar(fase === 'abertas' ? 'licitacoes:ordem' : 'licitacoes:ordem:contratadas', ordem);
    render();
  });
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
      notificar(`Situação: ${SITUACOES[ehContratada(l) ? 'contratadas' : 'abertas'][e.target.value]}.`);
      atualizarContagemFases();
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
  const visiveis = licitacoes.filter(daFase).filter(passa);
  const vista = vistaAtual();
  const grade = document.getElementById('grade');
  const lista = document.getElementById('lista');
  grade.hidden = vista !== 'cartoes';
  lista.hidden = vista !== 'lista';
  grade.classList.toggle('grade--compacta', fase === 'contratadas');
  if (vista === 'cartoes') {
    const ordenados = fase === 'abertas'
      ? [...visiveis].sort((a, b) => comparar(encerrada(a) ? null : diasDe(a), encerrada(b) ? null : diasDe(b), 'asc'))
      : [...visiveis].sort((a, b) => ((b.nivel || 0) - (a.nivel || 0)) || comparar(a.assinatura, b.assinatura, 'desc'));
    grade.replaceChildren(...ordenados.map(fase === 'abertas' ? renderCartaoAberta : renderCartaoContratada));
    lista.innerHTML = '';
  } else {
    grade.replaceChildren();
    renderLista(visiveis);
  }
  document.getElementById('empty-state').textContent = fase === 'abertas' ? 'Nenhuma licitação com esses filtros.' : 'Nenhum contrato com esses filtros.';
  document.getElementById('empty-state').hidden = visiveis.length > 0;
  document.getElementById('f-limpar').hidden = !Object.keys(PADRAO[fase]).some(k => filtros[k] !== PADRAO[fase][k]);

  const partes = [];
  if (fase === 'abertas') {
    partes.push(plural(visiveis.length, 'licitação', 'licitações'));
    const soProjeto = visiveis.filter(l => l.tipo_objeto === 'projeto').length;
    const urgentes = visiveis.filter(l => { const d = diasDe(l); return d !== null && d >= 0 && d <= 15; }).length;
    if (soProjeto) partes.push(`${soProjeto} só de projeto`);
    if (urgentes) partes.push(`${urgentes} fecha${urgentes === 1 ? '' : 'm'} em até 15 dias`);
  } else if (filtros.tipo === 'projeto') {
    partes.push(plural(visiveis.length, 'contrato só de projeto', 'contratos só de projeto'));
    const comArea = visiveis.filter(l => l.tr?.area_m2).length;
    if (comArea) partes.push(`${comArea} com área lida do termo de referência`);
  } else {
    partes.push(plural(visiveis.length, 'contrato de obra', 'contratos de obra'));
    const altos = visiveis.filter(l => l.nivel >= 2).length;
    const comContato = visiveis.filter(l => contatosVencedora(l.vencedor).length).length;
    if (altos) partes.push(`${altos} de nível 2 ou 3`);
    if (comContato) partes.push(`${comContato} com contato da vencedora`);
  }
  document.getElementById('resumo').textContent = partes.join(' · ');

  const el = document.getElementById('updated-at');
  const vistas = licitacoes.map(l => new Date(l.visto_em || l.coletado_em).getTime()).filter(t => !Number.isNaN(t));
  el.textContent = vistas.length ? `Atualizada em ${formatarData(new Date(Math.max(...vistas)).toISOString())}` : '';
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
  ligarFases();
  prepararControles();
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
