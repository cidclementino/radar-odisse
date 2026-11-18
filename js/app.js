// Radar Odisse — Concursos
//
// Duas vistas sobre os mesmos dados e os mesmos filtros: cartões (com banner) e lista (tabela
// ordenável). Os dados vêm do Worker com cache no navegador (ver carregarComCache em comum.js).

const DATA_URL = `${WORKER}/api/concursos`;
const CONCURSO_URL = id => `${WORKER}/api/concursos/${encodeURIComponent(id)}`;
const CACHE_CHAVE = 'concursos';

const STATUS_LABELS = { monitorando: 'Monitorando', acompanhando: 'Acompanhando', inscrito: 'Inscrito', descartado: 'Arquivado' };
const ACOMPANHADO = new Set(['acompanhando', 'inscrito']);

const ESCOPO_LABELS = {
  arquitetura: 'Arquitetura',
  urbanismo: 'Urbanismo',
  paisagismo: 'Paisagismo',
  design_produto_mobiliario: 'Design de produto',
};

// Um concurso é "novo" enquanto a primeira captura tiver menos de uma semana (o ciclo da coleta
// semanal) — depois disso a etiqueta some sozinha.
const NOVO_JANELA_MS = 7 * 24 * 60 * 60 * 1000;

let concursosState = [];

// ---------------------------------------------------------------- regras

function ehNovo(c) {
  if (!c.coletado_em) return false;
  const t = new Date(c.coletado_em).getTime();
  return !Number.isNaN(t) && Date.now() - t < NOVO_JANELA_MS;
}

// Encerrado = o prazo de inscrição já passou, mesmo que ninguém tenha arquivado.
function estaEncerrado(dias) { return dias !== null && dias < 0; }

function urgencia(dias, encerrado) {
  if (encerrado || dias === null || dias === undefined) return 'neutro';
  if (dias <= 15) return 'alta';
  if (dias <= 45) return 'media';
  return 'baixa';
}

function textoPrazo(dias, encerrado) {
  if (encerrado) return 'Inscrições encerradas';
  if (dias === null || dias === undefined) return 'Prazo de inscrição não informado';
  return dias === 1 ? 'dia para o fim das inscrições' : 'dias para o fim das inscrições';
}

function inscricaoTexto(c) {
  if (c.inscricao?.gratuita === true) return 'Gratuita' + (c.inscricao?.obs ? ` — ${c.inscricao.obs}` : '');
  return c.inscricao?.custo || null;
}

function inscricaoTipo(c) {
  if (c.inscricao?.gratuita === true) return 'gratuita';
  if (c.inscricao?.gratuita === false || c.inscricao?.custo) return 'paga';
  return null;
}

const nomeExibido = c => c.apelido || c.nome;
const fontesDe = c => (c.fontes && c.fontes.length ? c.fontes : [c.fonte].filter(Boolean));
// No filtro, os sites do IAB (nacional e departamentos: iabsp.org.br, iabrj.org.br…) viram uma fonte só.
// O detalhe do concurso continua mostrando o site de origem.
const grupoFonte = f => (/^iab[a-z-]*\.org\.br$/i.test(f) ? 'IAB' : f);
const gruposFonteDe = c => [...new Set(fontesDe(c).map(grupoFonte))];

// ---------------------------------------------------------------- filtros

const FILTROS_PADRAO = { busca: '', situacao: 'ativos', prazo: '', escopo: '', tipo: '', inscricao: '', fonte: '' };
let filtros = { ...FILTROS_PADRAO, ...prefLer('concursos:filtros', {}) };
filtros.busca = ''; // a busca não fica lembrada entre visitas

const SITUACOES = {
  novos: c => ehNovo(c) && c.status_interno !== 'descartado' && !estaEncerrado(diasAte(c.datas?.inscricao_fim)),
  ativos: c => c.status_interno !== 'descartado' && !estaEncerrado(diasAte(c.datas?.inscricao_fim)),
  // "Arquivados" reúne quem foi arquivado à mão e quem passou do prazo de inscrição.
  arquivados: c => c.status_interno === 'descartado' || estaEncerrado(diasAte(c.datas?.inscricao_fim)),
  todos: () => true,
};

function passaFiltros(c) {
  if (!(SITUACOES[filtros.situacao] || SITUACOES.ativos)(c)) return false;

  if (filtros.busca) {
    const alvo = normalizar([c.apelido, c.nome, c.promotor, c.local_projeto].join(' '));
    if (!normalizar(filtros.busca).split(/\s+/).filter(Boolean).every(t => alvo.includes(t))) return false;
  }

  if (filtros.prazo) {
    const d = diasAte(c.datas?.inscricao_fim);
    const aberto = d !== null && d >= 0;
    if (filtros.prazo === '15' && !(aberto && d <= 15)) return false;
    if (filtros.prazo === '45' && !(aberto && d > 15 && d <= 45)) return false;
    if (filtros.prazo === 'mais' && !(aberto && d > 45)) return false;
    if (filtros.prazo === 'sem' && d !== null) return false;
  }

  if (filtros.escopo && !(c.escopo || []).includes(filtros.escopo)) return false;
  if (filtros.tipo && c.tipo !== filtros.tipo) return false;
  if (filtros.inscricao && inscricaoTipo(c) !== filtros.inscricao) return false;
  if (filtros.fonte && !gruposFonteDe(c).includes(filtros.fonte)) return false;
  return true;
}

function filtrosAtivos() {
  return Object.keys(FILTROS_PADRAO).some(k => filtros[k] !== FILTROS_PADRAO[k]);
}

function ligarFiltros() {
  const campos = {
    busca: 'f-busca', situacao: 'f-situacao', prazo: 'f-prazo', escopo: 'f-escopo',
    tipo: 'f-tipo', inscricao: 'f-inscricao', fonte: 'f-fonte',
  };
  for (const [k, id] of Object.entries(campos)) {
    const el = document.getElementById(id);
    el.value = filtros[k];
    el.addEventListener(k === 'busca' ? 'input' : 'change', () => {
      filtros[k] = el.value;
      const { busca, ...lembrar } = filtros;
      prefGravar('concursos:filtros', lembrar);
      render();
    });
  }
  document.getElementById('f-limpar').addEventListener('click', () => {
    filtros = { ...FILTROS_PADRAO };
    prefGravar('concursos:filtros', {});
    for (const [k, id] of Object.entries(campos)) document.getElementById(id).value = filtros[k];
    render();
  });
}

// As opções de escopo e fonte saem dos próprios dados (uma fonte nova aparece sozinha).
function atualizarOpcoesFiltros() {
  const escopos = [...new Set(concursosState.flatMap(c => c.escopo || []))];
  preencherSelect(document.getElementById('f-escopo'),
    escopos.map(e => [e, ESCOPO_LABELS[e] || e]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), 'Todos os escopos');
  const fontes = [...new Set(concursosState.flatMap(gruposFonteDe))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  preencherSelect(document.getElementById('f-fonte'), fontes.map(f => [f, f]), 'Todas as fontes');
  document.getElementById('f-escopo').value = escopos.includes(filtros.escopo) ? filtros.escopo : '';
  document.getElementById('f-fonte').value = fontes.includes(filtros.fonte) ? filtros.fonte : '';
}

// ---------------------------------------------------------------- Worker

async function patchConcurso(id, corpo, erro) {
  try {
    const res = await fetch(CONCURSO_URL(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
    if (!res.ok) throw new Error(`Worker retornou ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(err);
    alert(erro);
    return null;
  }
}

async function apagarConcurso(id) {
  try {
    const res = await fetch(CONCURSO_URL(id), { method: 'DELETE' });
    if (!res.ok) throw new Error(`Worker retornou ${res.status}`);
    return true;
  } catch (err) {
    console.error(err);
    alert('Não foi possível apagar esse concurso agora. Tente de novo em instantes.');
    return false;
  }
}

// Toda mudança feita na tela vai para o estado e para o cache, para não exigir nova busca.
function substituir(atualizado) {
  const i = concursosState.findIndex(c => c.id === atualizado.id);
  if (i !== -1) concursosState[i] = atualizado;
  cacheGravar(CACHE_CHAVE, concursosState);
  atualizarContadores();
}

function remover(id) {
  concursosState = concursosState.filter(c => c.id !== id);
  cacheGravar(CACHE_CHAVE, concursosState);
}

// ---------------------------------------------------------------- detalhe (comum às duas vistas)

function campoDetalhe(rotulo, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `<div class="detalhe__item"><div class="u-rotulo">${escapeHTML(rotulo)}</div><div>${escapeHTML(valor)}</div></div>`;
}

function renderDetalhe(c) {
  const link = c.link_oficial || c.fonte_url_original;
  const linkTexto = c.link_oficial ? 'Abrir site oficial ↗' : 'Ver publicação original ↗';
  const banca = c.banca_definida === true ? (c.banca_obs || 'Definida') : c.banca_definida === false ? 'Ainda não definida' : null;
  const arquivado = c.status_interno === 'descartado';

  return `
    <div class="detalhe">
      <label class="u-campo detalhe__apelido">
        <span>Apelido de exibição</span>
        <div class="detalhe__apelido-linha">
          <input type="text" class="js-apelido" value="${escapeHTML(nomeExibido(c))}" maxlength="200">
          <button type="button" class="u-botao js-salvar-apelido">Salvar</button>
        </div>
        ${c.apelido ? `<small>Nome capturado: ${escapeHTML(c.nome)}</small>` : ''}
      </label>
      <div class="detalhe__grade">
        ${campoDetalhe('Promotor', c.promotor)}
        ${campoDetalhe('Destinado a', c.destinado_a)}
        ${campoDetalhe('Inscrição', inscricaoTexto(c))}
        ${campoDetalhe('Prêmio', c.premio)}
        ${campoDetalhe('Banca julgadora', banca)}
        ${campoDetalhe('Fim das inscrições', formatarData(c.datas?.inscricao_fim))}
        ${campoDetalhe('Entrega do projeto', formatarData(c.datas?.entrega_fim))}
        ${campoDetalhe('Fontes', fontesDe(c).join(', '))}
      </div>
      ${link ? `<a class="detalhe__link" href="${escapeHTML(link)}" target="_blank" rel="noopener">${linkTexto}</a>` : ''}
      <div class="detalhe__acoes">
        <button type="button" class="u-botao js-arquivar">${arquivado ? 'Restaurar' : 'Arquivar'}</button>
        <button type="button" class="u-botao perigo js-apagar">Apagar</button>
      </div>
    </div>`;
}

/** liga os botões do painel de detalhe; nenhum clique ali dentro abre/fecha o item */
function ligarDetalhe(raiz, c) {
  const painel = raiz.querySelector('.detalhe');
  painel.addEventListener('click', e => e.stopPropagation());
  painel.addEventListener('keydown', e => e.stopPropagation());

  const input = painel.querySelector('.js-apelido');
  const salvar = painel.querySelector('.js-salvar-apelido');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); salvar.click(); } });
  salvar.addEventListener('click', async () => {
    const apelido = input.value.trim();
    if (!apelido) { alert('O apelido não pode ficar vazio. Para voltar ao nome capturado, cole ele aqui.'); return; }
    salvar.disabled = true;
    const atualizado = await patchConcurso(c.id, { apelido }, 'Não foi possível salvar o apelido agora. Tente de novo em instantes.');
    salvar.disabled = false;
    if (!atualizado) return;
    substituir(atualizado);
    // renomear não muda ordem nem visibilidade: atualiza só o nome, sem fechar o painel
    raiz.querySelectorAll('.js-nome').forEach(el => { el.textContent = nomeExibido(atualizado); });
    if (raiz.previousElementSibling?.matches('tr.linha')) {
      raiz.previousElementSibling.querySelector('.js-nome').textContent = nomeExibido(atualizado);
    }
  });

  const arquivar = painel.querySelector('.js-arquivar');
  arquivar.addEventListener('click', async () => {
    const novo = c.status_interno === 'descartado' ? 'monitorando' : 'descartado';
    arquivar.disabled = true;
    const atualizado = await patchConcurso(c.id, { status_interno: novo }, 'Não foi possível atualizar esse concurso agora. Tente de novo em instantes.');
    arquivar.disabled = false;
    if (!atualizado) return;
    substituir(atualizado);
    render();
  });

  const apagar = painel.querySelector('.js-apagar');
  apagar.addEventListener('click', async () => {
    if (!confirm(`Apagar definitivamente "${nomeExibido(c)}"? Ele sai do Radar e não volta nas próximas coletas. Essa ação não pode ser desfeita.`)) return;
    apagar.disabled = true;
    const ok = await apagarConcurso(c.id);
    apagar.disabled = false;
    if (!ok) return;
    remover(c.id);
    render();
  });
}

// ---------------------------------------------------------------- situação e acompanhamento

/** muda a situação; ao entrar em acompanhamento, lê o site oficial em segundo plano */
async function mudarSituacao(c, novo) {
  if (novo === c.status_interno) return true;
  const atualizado = await patchConcurso(c.id, { status_interno: novo }, 'Não foi possível mudar a situação agora. Tente de novo em instantes.');
  if (!atualizado) return false;
  substituir(atualizado);
  render();
  if (ACOMPANHADO.has(novo) && !atualizado.acompanhamento?.lido_em) {
    notificar(`Lendo o site oficial de “${nomeExibido(atualizado)}”…`, { ms: 0 });
    try {
      await garantirLeitorSite();
      const lido = await lerSiteOficial(atualizado);
      if (lido) {
        substituir(lido);
        render();
        notificar(lido.acompanhamento?.erro
          ? `Não deu para ler o site oficial (${lido.acompanhamento.erro}). O concurso está em Acompanhamento mesmo assim.`
          : 'Pronto: as informações do site oficial estão em Acompanhamento.', { erro: !!lido.acompanhamento?.erro, ms: 7000 });
      }
    } catch (err) {
      notificar(`Não deu para ler o site oficial: ${err.message}`, { erro: true, ms: 7000 });
    }
  } else if (novo === 'acompanhando') {
    notificar('Concurso em Acompanhamento.');
  }
  return true;
}

// O item aberto continua aberto quando a tela é redesenhada (ex.: depois de mudar um filtro).
let abertoId = null;

// ---------------------------------------------------------------- vista: cartões

function renderCard(c) {
  const dias = diasAte(c.datas?.inscricao_fim);
  const encerrado = estaEncerrado(dias);
  const arquivado = c.status_interno === 'descartado';

  const el = document.createElement('article');
  el.className = `concurso concurso--${urgencia(dias, encerrado)}${arquivado || encerrado ? ' is-apagado' : ''}${selecionados.has(c.id) ? ' is-selecionado' : ''}`;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');

  const banner = c.imagem_url
    ? `<img class="concurso__banner" src="${escapeHTML(c.imagem_url)}" alt="" loading="lazy" decoding="async">`
    : '<div class="concurso__banner"></div>';
  const tags = (c.escopo || []).map(e => `<span class="u-etiqueta suave">${escapeHTML(ESCOPO_LABELS[e] || e)}</span>`).join('');
  const situacao = encerrado ? 'Encerrado' : c.status_interno !== 'monitorando' ? (STATUS_LABELS[c.status_interno] || c.status_interno) : '';

  el.innerHTML = `
    ${banner}
    <div class="concurso__selos">
      <span class="concurso__selos-esq">
        <label class="selecionar" title="Selecionar para fundir"><input type="checkbox" class="js-sel" data-id="${escapeHTML(c.id)}"${selecionados.has(c.id) ? ' checked' : ''} aria-label="Selecionar ${escapeHTML(nomeExibido(c))}"></label>
        ${ehNovo(c) ? '<span class="u-etiqueta selo-novo">Novo</span>' : ''}
      </span>
      ${situacao ? `<span class="u-etiqueta">${escapeHTML(situacao)}</span>` : ''}
    </div>
    <div class="concurso__corpo">
      <div class="concurso__tags">${tags}</div>
      <h2 class="concurso__titulo js-nome">${escapeHTML(nomeExibido(c))}</h2>
      <p class="concurso__local">${escapeHTML(c.local_projeto || '')}</p>
    </div>
    <div class="concurso__prazo">
      <span class="concurso__dias">${!encerrado && dias !== null ? dias : '—'}</span>
      <span class="concurso__prazo-texto">${textoPrazo(dias, encerrado)}${!encerrado && dias !== null ? ` · ${formatarData(c.datas.inscricao_fim, { curta: true })}` : ''}</span>
      <button type="button" class="acompanhar js-acompanhar${ACOMPANHADO.has(c.status_interno) ? ' is-ativo' : ''}" title="${ACOMPANHADO.has(c.status_interno) ? 'Em acompanhamento — clique para voltar ao monitoramento geral' : 'Acompanhar: lê o site oficial e leva o concurso para a página Acompanhamento'}">${ACOMPANHADO.has(c.status_interno) ? (c.status_interno === 'inscrito' ? 'Inscrito' : 'Acompanhando') : 'Acompanhar'}</button>
    </div>
    ${renderDetalhe(c)}`;

  const alternar = () => {
    const abrir = !el.classList.contains('is-aberto');
    document.querySelectorAll('.concurso.is-aberto').forEach(o => o.classList.remove('is-aberto'));
    el.classList.toggle('is-aberto', abrir);
    el.setAttribute('aria-expanded', String(abrir));
    abertoId = abrir ? c.id : null;
  };
  el.setAttribute('aria-expanded', 'false');
  if (abertoId === c.id) { el.classList.add('is-aberto'); el.setAttribute('aria-expanded', 'true'); }
  el.addEventListener('click', alternar);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
  const botaoAcomp = el.querySelector('.js-acompanhar');
  botaoAcomp.addEventListener('click', async e => {
    e.stopPropagation();
    if (c.status_interno === 'inscrito') { location.href = 'acompanhamento.html'; return; }
    botaoAcomp.disabled = true;
    await mudarSituacao(c, c.status_interno === 'acompanhando' ? 'monitorando' : 'acompanhando');
    botaoAcomp.disabled = false;
  });
  botaoAcomp.addEventListener('keydown', e => e.stopPropagation());
  // imagem que não carrega vira o mesmo fundo neutro dos concursos sem banner
  el.querySelector('img.concurso__banner')?.addEventListener('error', e => e.target.removeAttribute('src'), { once: true });
  ligarDetalhe(el, c);
  return el;
}

// ---------------------------------------------------------------- vista: lista

const COLUNAS = [
  { id: 'sel', rotulo: '', ordena: false, classe: 'col-sel' },
  { id: 'nome', rotulo: 'Concurso' },
  { id: 'local', rotulo: 'Local' },
  { id: 'escopo', rotulo: 'Escopo', classe: 'col-media' },
  { id: 'tipo', rotulo: 'Abrangência', classe: 'col-media' },
  { id: 'inscricao_fim', rotulo: 'Inscrições até', classe: 'col-num' },
  { id: 'dias', rotulo: 'Dias', classe: 'col-num' },
  { id: 'entrega_fim', rotulo: 'Entrega', classe: 'col-num col-larga' },
  { id: 'inscricao', rotulo: 'Inscrição', classe: 'col-larga' },
  { id: 'situacao', rotulo: 'Situação', classe: 'col-media' },
];

let ordem = prefLer('concursos:ordem', { coluna: 'dias', direcao: 'asc' });

const VALOR_ORDEM = {
  nome: c => normalizar(nomeExibido(c)),
  local: c => normalizar(c.local_projeto),
  escopo: c => (c.escopo || []).map(e => ESCOPO_LABELS[e] || e).join(', '),
  tipo: c => c.tipo,
  inscricao_fim: c => c.datas?.inscricao_fim || null,
  dias: c => { const d = diasAte(c.datas?.inscricao_fim); return d === null || d < 0 ? null : d; },
  entrega_fim: c => c.datas?.entrega_fim || null,
  inscricao: c => inscricaoTipo(c),
  situacao: c => situacaoTexto(c),
};

function seletorSituacao(c, encerrado) {
  const op = (v, r) => `<option value="${v}"${c.status_interno === v ? ' selected' : ''}>${r}</option>`;
  return `<select class="situacao js-situacao situacao--${escapeHTML(c.status_interno)}" aria-label="Situação de ${escapeHTML(nomeExibido(c))}">
      ${op('monitorando', 'Monitorando')}${op('acompanhando', 'Acompanhando')}${op('inscrito', 'Inscrito')}${op('descartado', 'Arquivado')}
      <option disabled>──────</option><option value="excluir">Excluir…</option>
    </select>${encerrado ? '<div class="u-apoio">inscrições encerradas</div>' : ''}`;
}

function situacaoTexto(c) {
  if (estaEncerrado(diasAte(c.datas?.inscricao_fim))) return 'Encerrado';
  return STATUS_LABELS[c.status_interno] || c.status_interno;
}

function renderLista(itens) {
  const lista = document.getElementById('lista');
  const f = VALOR_ORDEM[ordem.coluna] || VALOR_ORDEM.dias;
  const ordenados = [...itens].sort((a, b) => comparar(f(a), f(b), ordem.direcao) || comparar(VALOR_ORDEM.dias(a), VALOR_ORDEM.dias(b), 'asc'));

  lista.innerHTML = `<div class="tabela-rolagem"><table class="u-tabela tabela">${theadOrdenavel(COLUNAS, ordem)}<tbody></tbody></table></div>`;
  const tbody = lista.querySelector('tbody');

  for (const c of ordenados) {
    const dias = diasAte(c.datas?.inscricao_fim);
    const encerrado = estaEncerrado(dias);
    const tr = document.createElement('tr');
    tr.className = `linha linha--${urgencia(dias, encerrado)}${c.status_interno === 'descartado' || encerrado ? ' is-apagado' : ''}${selecionados.has(c.id) ? ' is-selecionado' : ''}`;
    tr.tabIndex = 0;
    tr.innerHTML = `
      <td class="col-sel"><label class="selecionar" title="Selecionar para fundir"><input type="checkbox" class="js-sel" data-id="${escapeHTML(c.id)}"${selecionados.has(c.id) ? ' checked' : ''} aria-label="Selecionar ${escapeHTML(nomeExibido(c))}"></label></td>
      <td><div class="linha__concurso">
        ${c.imagem_url ? `<img class="linha__banner" src="${escapeHTML(c.imagem_url)}" alt="" loading="lazy" decoding="async">` : '<span class="linha__banner"></span>'}
        <div><div class="linha__titulo"><span class="js-nome">${escapeHTML(nomeExibido(c))}</span>${ehNovo(c) ? ' <span class="u-etiqueta selo-novo">Novo</span>' : ''}</div>
        ${c.promotor ? `<div class="u-apoio">${escapeHTML(c.promotor)}</div>` : ''}</div></div></td>
      <td>${escapeHTML(c.local_projeto || '')}</td>
      <td class="col-media">${escapeHTML((c.escopo || []).map(e => ESCOPO_LABELS[e] || e).join(', '))}</td>
      <td class="col-media">${c.tipo === 'nacional' ? 'Nacional' : c.tipo === 'internacional' ? 'Internacional' : ''}</td>
      <td class="col-num">${formatarData(c.datas?.inscricao_fim) || '<span class="u-apoio">—</span>'}</td>
      <td class="col-num"><span class="dias">${!encerrado && dias !== null ? dias : '—'}</span></td>
      <td class="col-num col-larga">${formatarData(c.datas?.entrega_fim) || '<span class="u-apoio">—</span>'}</td>
      <td class="col-larga">${escapeHTML(inscricaoTexto(c) || '')}</td>
      <td class="col-media col-situacao">${seletorSituacao(c, encerrado)}</td>`;

    const det = document.createElement('tr');
    det.className = 'linha-detalhe';
    det.hidden = abertoId !== c.id;
    det.innerHTML = `<td colspan="${COLUNAS.length}">${renderDetalhe(c)}</td>`;
    tr.classList.toggle('is-aberto', abertoId === c.id);

    const alternar = () => {
      const abrir = det.hidden;
      tbody.querySelectorAll('.linha-detalhe').forEach(d => { d.hidden = true; });
      tbody.querySelectorAll('.linha.is-aberto').forEach(l => l.classList.remove('is-aberto'));
      det.hidden = !abrir;
      tr.classList.toggle('is-aberto', abrir);
      abertoId = abrir ? c.id : null;
    };
    tr.addEventListener('click', e => { if (!e.target.closest('.col-situacao')) alternar(); });
    tr.addEventListener('keydown', e => { if (e.target.closest('.col-situacao')) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
    const sel = tr.querySelector('.js-situacao');
    sel.addEventListener('change', async () => {
      const valor = sel.value;
      sel.disabled = true;
      if (valor === 'excluir') {
        if (confirm(`Apagar definitivamente "${nomeExibido(c)}"? Ele sai do Radar e não volta nas próximas coletas. Essa ação não pode ser desfeita.`) && await apagarConcurso(c.id)) {
          remover(c.id);
          render();
          return;
        }
        sel.value = c.status_interno;
        sel.disabled = false;
        return;
      }
      if (!(await mudarSituacao(c, valor))) { sel.value = c.status_interno; sel.disabled = false; }
    });
    tr.querySelector('img.linha__banner')?.addEventListener('error', e => e.target.removeAttribute('src'), { once: true });
    ligarDetalhe(det, c);
    tbody.append(tr, det);
  }

  ligarOrdenacao(lista.querySelector('table'), ordem, () => { prefGravar('concursos:ordem', ordem); render(); });
}

// ---------------------------------------------------------------- seleção e fusão manual
//
// Dois concursos marcados → "Fundir os dois" → popup com os banners e, campo a campo, o que é
// diferente entre eles para escolher qual valor fica. O que só um dos dois tem entra sozinho.

const selecionados = new Set();

function ligarSelecao() {
  // um único ouvinte para cartões e linhas; marcar a caixa não abre nem fecha o item
  document.querySelector('main').addEventListener('click', e => {
    if (e.target.closest('.selecionar')) e.stopPropagation();
  }, true);
  document.querySelector('main').addEventListener('change', e => {
    const caixa = e.target.closest('.js-sel');
    if (!caixa) return;
    const id = caixa.dataset.id;
    if (caixa.checked) selecionados.add(id); else selecionados.delete(id);
    caixa.closest('.concurso, .linha')?.classList.toggle('is-selecionado', caixa.checked);
    renderSelecao();
  });
  document.getElementById('selecao-limpar').addEventListener('click', () => {
    selecionados.clear();
    render();
  });
  document.getElementById('selecao-fundir').addEventListener('click', abrirFusao);
}

function renderSelecao() {
  for (const id of [...selecionados]) if (!concursosState.some(c => c.id === id)) selecionados.delete(id);
  const n = selecionados.size;
  document.getElementById('selecao').hidden = n === 0;
  document.getElementById('selecao-texto').textContent =
    n === 2 ? '2 concursos selecionados' : n === 1 ? '1 selecionado · marque outro para fundir' : `${n} selecionados · fundir junta dois de cada vez`;
  document.getElementById('selecao-fundir').disabled = n !== 2;
  document.getElementById('stack').classList.toggle('tem-selecao', n > 0);
}

const CAMPOS_FUSAO = [
  { id: 'apelido', rotulo: 'Nome exibido', valor: c => nomeExibido(c) },
  { id: 'local_projeto', rotulo: 'Local', valor: c => c.local_projeto },
  { id: 'promotor', rotulo: 'Promotor', valor: c => c.promotor },
  { id: 'inscricao_fim', rotulo: 'Fim das inscrições', valor: c => c.datas?.inscricao_fim, texto: v => formatarData(v) },
  { id: 'entrega_fim', rotulo: 'Entrega do projeto', valor: c => c.datas?.entrega_fim, texto: v => formatarData(v) },
  { id: 'link_oficial', rotulo: 'Site oficial', valor: c => c.link_oficial, link: true },
  { id: 'inscricao', rotulo: 'Inscrição', valor: c => inscricaoTexto(c) },
  { id: 'premio', rotulo: 'Prêmio', valor: c => c.premio },
  { id: 'destinado_a', rotulo: 'Destinado a', valor: c => c.destinado_a },
  { id: 'tipo', rotulo: 'Abrangência', valor: c => c.tipo, texto: v => (v === 'nacional' ? 'Nacional' : v === 'internacional' ? 'Internacional' : v) },
  { id: 'escopo', rotulo: 'Escopo', valor: c => ((c.escopo || []).length ? (c.escopo || []).map(e => ESCOPO_LABELS[e] || e).join(', ') : null) },
];

const vazio = v => v === null || v === undefined || v === '';
const igual = (a, b) => normalizar(a).replace(/\s+/g, ' ').trim() === normalizar(b).replace(/\s+/g, ' ').trim();

function textoCampo(campo, v) {
  if (vazio(v)) return '<span class="u-apoio">—</span>';
  const t = campo.texto ? campo.texto(v) : v;
  if (campo.link) return `<a href="${escapeHTML(v)}" target="_blank" rel="noopener">${escapeHTML(String(v).replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))}</a>`;
  return escapeHTML(t);
}

function abrirFusao() {
  if (selecionados.size !== 2) return;
  // fica o id do que foi coletado primeiro; o outro é absorvido
  const [a, b] = [...selecionados].map(id => concursosState.find(c => c.id === id))
    .sort((x, y) => comparar(x.coletado_em, y.coletado_em, 'asc'));
  const dialogo = document.getElementById('fusao');

  const diferentes = CAMPOS_FUSAO.filter(f => !vazio(f.valor(a)) && !vazio(f.valor(b)) && !igual(f.valor(a), f.valor(b)));
  const soNoB = CAMPOS_FUSAO.filter(f => vazio(f.valor(a)) && !vazio(f.valor(b)));
  const bannerDiferente = a.imagem_url && b.imagem_url && a.imagem_url !== b.imagem_url;

  const coluna = (c, lado) => {
    const img = c.imagem_url
      ? `<img src="${escapeHTML(c.imagem_url)}" alt="" class="fusao__banner">`
      : '<div class="fusao__banner"></div>';
    const banner = bannerDiferente
      ? `<label class="fusao__opcao fusao__opcao--banner"><input type="radio" name="f-imagem_url" value="${lado}"${lado === 'a' ? ' checked' : ''}>${img}<span>Usar este banner</span></label>`
      : img;
    return `<div class="fusao__lado">
      ${banner}
      <p class="fusao__nome">${escapeHTML(nomeExibido(c))}</p>
      <p class="u-apoio">${escapeHTML(fontesDe(c).join(', '))} · coletado ${formatarData(c.coletado_em)}</p>
    </div>`;
  };

  dialogo.innerHTML = `
    <form method="dialog" class="fusao__form">
      <header class="fusao__topo">
        <h2 id="fusao-titulo">Fundir dois concursos</h2>
        <button type="button" class="fusao__fechar js-cancelar" aria-label="Fechar">×</button>
      </header>
      <div class="fusao__corpo">
        <div class="fusao__lados">${coluna(a, 'a')}${coluna(b, 'b')}</div>
        ${diferentes.length ? `
          <p class="fusao__instrucao">Escolha o valor que fica em cada campo diferente:</p>
          <table class="u-tabela fusao__tabela"><tbody>
            ${diferentes.map(f => `<tr>
              <th scope="row">${escapeHTML(f.rotulo)}</th>
              ${['a', 'b'].map(lado => `<td><label class="fusao__opcao"><input type="radio" name="f-${f.id}" value="${lado}"${lado === 'a' ? ' checked' : ''}><span>${textoCampo(f, f.valor(lado === 'a' ? a : b))}</span></label></td>`).join('')}
            </tr>`).join('')}
          </tbody></table>`
        : '<p class="fusao__instrucao">Nenhum campo diferente entre os dois.</p>'}
        <p class="u-apoio fusao__nota">${soNoB.length ? `Vêm do segundo, porque só ele tem: ${soNoB.map(f => f.rotulo.toLowerCase()).join(', ')}. ` : ''}As fontes dos dois ficam juntas, o segundo deixa de aparecer como concurso separado e as próximas coletas reconhecem os dois como um só.</p>
      </div>
      <footer class="fusao__rodape">
        <button type="button" class="u-botao js-cancelar">Cancelar</button>
        <button type="submit" class="u-botao forte js-confirmar">Fundir</button>
      </footer>
    </form>`;

  dialogo.querySelectorAll('.js-cancelar').forEach(btn => btn.addEventListener('click', () => dialogo.close()));
  dialogo.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const usar = [...dialogo.querySelectorAll('input[type=radio]:checked')]
      .filter(r => r.value === 'b').map(r => r.name.replace(/^f-/, ''));
    const botao = dialogo.querySelector('.js-confirmar');
    botao.disabled = true;
    botao.textContent = 'Fundindo…';
    try {
      const res = await fetch(`${WORKER}/api/concursos/fundir`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manter_id: a.id, absorver_id: b.id, usar_absorvido: usar }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corpo.error || `Worker respondeu ${res.status}`);
      concursosState = concursosState.filter(c => c.id !== b.id);
      substituir(corpo.concurso);
      selecionados.clear();
      abertoId = null;
      dialogo.close();
      render();
    } catch (err) {
      console.error(err);
      botao.disabled = false;
      botao.textContent = 'Fundir';
      alert(`Não foi possível fundir agora: ${err.message}`);
    }
  });
  dialogo.showModal();
}

// ---------------------------------------------------------------- tela

let vistaAtual = () => 'cartoes';

function renderResumo(visiveis) {
  const abertos = visiveis.filter(c => { const d = diasAte(c.datas?.inscricao_fim); return d !== null && d >= 0; });
  const urgentes = abertos.filter(c => diasAte(c.datas.inscricao_fim) <= 15).length;
  const novos = visiveis.filter(ehNovo).length;
  const partes = [plural(visiveis.length, 'concurso', 'concursos')];
  if (urgentes) partes.push(`${urgentes} com inscrições em até 15 dias`);
  if (novos) partes.push(plural(novos, 'novo', 'novos') + ' nesta semana');
  document.getElementById('resumo').textContent = partes.join(' · ');
}

function renderAtualizado() {
  const el = document.getElementById('updated-at');
  const datas = concursosState.map(c => new Date(c.coletado_em).getTime()).filter(t => !Number.isNaN(t));
  const coleta = datas.length ? `Última coleta ${formatarData(new Date(Math.max(...datas)).toISOString())}` : '';
  const copia = cacheIdade(CACHE_CHAVE);
  el.textContent = coleta;
  el.title = copia ? `Dados guardados neste navegador às ${formatarHora(copia)}` : '';
}

function render() {
  const visiveis = concursosState.filter(passaFiltros);
  const vista = vistaAtual();
  const grade = document.getElementById('stack');
  const lista = document.getElementById('lista');
  grade.hidden = vista !== 'cartoes';
  lista.hidden = vista !== 'lista';

  if (vista === 'cartoes') {
    // mais urgente primeiro; sem prazo e encerrados por último
    const ordenados = [...visiveis].sort((a, b) => comparar(VALOR_ORDEM.dias(a), VALOR_ORDEM.dias(b), 'asc'));
    grade.replaceChildren(...ordenados.map(renderCard));
    lista.innerHTML = '';
  } else {
    grade.replaceChildren();
    renderLista(visiveis);
  }

  document.getElementById('empty-state').hidden = visiveis.length > 0;
  document.getElementById('f-limpar').hidden = !filtrosAtivos();
  renderResumo(visiveis);
  renderAtualizado();
  renderSelecao();
}

function receber(dados) {
  concursosState = Array.isArray(dados) ? dados : [];
  atualizarOpcoesFiltros();
  render();
  atualizarContadores();
}

function init() {
  vistaAtual = ligarVista(document.getElementById('vista'), 'concursos:vista', render);
  ligarFiltros();
  ligarSelecao();
  atualizarOpcoesFiltros();
  montarSubnav('geral');

  if (!cacheLer(CACHE_CHAVE)) document.getElementById('resumo').textContent = 'Carregando concursos…';
  carregarComCache(CACHE_CHAVE, DATA_URL, receber);

  const recarregar = document.getElementById('recarregar');
  recarregar.addEventListener('click', async () => {
    recarregar.disabled = true;
    recarregar.textContent = 'Recarregando…';
    avisar('');
    await carregarComCache(CACHE_CHAVE, DATA_URL, receber, { forcar: true });
    recarregar.disabled = false;
    recarregar.textContent = 'Recarregar';
  });
}

init();
