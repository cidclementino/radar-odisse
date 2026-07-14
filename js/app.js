// Radar Odisse — renderização da pilha de concursos
//
// Fonte de dados: por enquanto lê data/concursos.sample.json (mock).
// Na versão conectada ao Worker, troque DATA_URL pelo endpoint da API
// (ex: 'https://radar-odisse-worker.<subdomain>.workers.dev/api/concursos').

const DATA_URL = 'data/concursos.sample.json';

const STATUS_HIDDEN_BY_DEFAULT = new Set(['descartado', 'inscrito']);

const STATUS_LABELS = {
  descartado: 'Descartado',
  inscrito: 'Inscrito',
};

const ESCOPO_LABELS = {
  arquitetura: 'Arquitetura',
  urbanismo: 'Urbanismo',
  paisagismo: 'Paisagismo',
  design_produto_mobiliario: 'Design de Produto',
};

function diasAte(dataISO) {
  if (!dataISO) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dataISO + 'T00:00:00');
  return Math.round((alvo - hoje) / (1000 * 60 * 60 * 24));
}

// Um concurso é considerado "encerrado" automaticamente quando o prazo de
// inscrição já passou, independente do status_interno ter sido atualizado
// manualmente ou não.
function estaEncerrado(dias) {
  return dias !== null && dias < 0;
}

function corPorPrazo(dias, encerrado) {
  if (encerrado) return 'gray';
  if (dias === null || dias === undefined) return 'gray';
  if (dias <= 15) return 'red';
  if (dias <= 45) return 'orange';
  return 'green';
}

// Label estático — o número já está grande ao lado, não repete a contagem aqui.
function textoPrazo(dias, encerrado) {
  if (encerrado) return 'Inscrições encerradas';
  if (dias === null || dias === undefined) return 'Prazo de inscrição não informado';
  return 'dias para o fim das inscrições';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function campoDetalhe(label, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `
    <div class="concurso__detail-item">
      <div class="concurso__detail-label">${escapeHTML(label)}</div>
      <div class="concurso__detail-value">${escapeHTML(valor)}</div>
    </div>
  `;
}

function renderDetalhe(concurso) {
  const link = concurso.link_oficial || concurso.fonte_url_original;
  const linkTexto = concurso.link_oficial ? 'Abrir site oficial ↗' : 'Ver publicação original ↗';

  const custoTexto = concurso.inscricao?.gratuita === true
    ? 'Gratuita' + (concurso.inscricao?.obs ? ` — ${concurso.inscricao.obs}` : '')
    : concurso.inscricao?.custo || null;

  const bancaTexto = concurso.banca_definida === true
    ? (concurso.banca_obs || 'Definida')
    : concurso.banca_definida === false
      ? 'Ainda não definida'
      : null;

  return `
    <div class="concurso__detail">
      <div class="concurso__detail-grid">
        ${campoDetalhe('Promotor', concurso.promotor)}
        ${campoDetalhe('Destinado a', concurso.destinado_a)}
        ${campoDetalhe('Inscrição', custoTexto)}
        ${campoDetalhe('Prêmio', concurso.premio)}
        ${campoDetalhe('Banca julgadora', bancaTexto)}
        ${campoDetalhe('Entrega do projeto', concurso.datas?.entrega_fim)}
      </div>
      ${link ? `<a class="concurso__detail-link" href="${escapeHTML(link)}" target="_blank" rel="noopener">${linkTexto}</a>` : ''}
    </div>
  `;
}

function renderCard(concurso) {
  const dias = diasAte(concurso.datas?.inscricao_fim);
  const encerrado = estaEncerrado(dias);
  const cor = corPorPrazo(dias, encerrado);
  const hiddenStatus = STATUS_HIDDEN_BY_DEFAULT.has(concurso.status_interno) || encerrado;

  const el = document.createElement('article');
  el.className = `concurso concurso--${cor}${hiddenStatus ? ' concurso--hidden-status' : ''}`;
  el.dataset.status = concurso.status_interno;
  el.dataset.encerrado = String(encerrado);
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', 'false');

  const bannerStyle = concurso.imagem_url
    ? `style="background-image:url('${concurso.imagem_url}')"`
    : '';

  const tags = (concurso.escopo || [])
    .map(e => `<span class="tag">${escapeHTML(ESCOPO_LABELS[e] || e)}</span>`)
    .join('');

  const statusPill = encerrado
    ? '<span class="concurso__status-pill">Encerrado</span>'
    : concurso.status_interno !== 'monitorando'
      ? `<span class="concurso__status-pill">${STATUS_LABELS[concurso.status_interno] || concurso.status_interno}</span>`
      : '';

  el.innerHTML = `
    <div class="concurso__banner" ${bannerStyle}></div>
    <div class="concurso__row">
      <div class="concurso__body">
        <div class="concurso__eyebrow">${tags}</div>
        <h2 class="concurso__title"><span class="concurso__title-text">${escapeHTML(concurso.nome)}</span></h2>
        <p class="concurso__place">${escapeHTML(concurso.local_projeto)}</p>
      </div>
      <div class="concurso__footer">
        <span class="concurso__deadline-count tabular">${!encerrado && dias !== null ? dias : '—'}</span>
        <span class="concurso__deadline-label">${textoPrazo(dias, encerrado)}</span>
      </div>
    </div>
    ${statusPill}
    ${renderDetalhe(concurso)}
  `;

  const alternar = () => {
    const expandido = el.classList.toggle('is-expanded');
    el.setAttribute('aria-expanded', String(expandido));
  };
  el.addEventListener('click', alternar);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); }
  });

  const linkDetalhe = el.querySelector('.concurso__detail-link');
  if (linkDetalhe) linkDetalhe.addEventListener('click', e => e.stopPropagation());

  return el;
}

function render(concursos, mostrarTodos) {
  const stack = document.getElementById('stack');
  const emptyState = document.getElementById('empty-state');
  stack.innerHTML = '';

  // Ordena por proximidade do prazo de inscrição (mais urgente primeiro).
  // Concursos sem data informada ficam por último, entre os visíveis.
  const ordenados = [...concursos].sort((a, b) => {
    const diasA = diasAte(a.datas?.inscricao_fim);
    const diasB = diasAte(b.datas?.inscricao_fim);
    if (diasA === null && diasB === null) return 0;
    if (diasA === null) return 1;
    if (diasB === null) return -1;
    return diasA - diasB;
  });

  const visiveis = mostrarTodos
    ? ordenados
    : ordenados.filter(c => {
        const dias = diasAte(c.datas?.inscricao_fim);
        return !STATUS_HIDDEN_BY_DEFAULT.has(c.status_interno) && !estaEncerrado(dias);
      });

  visiveis.forEach(c => stack.appendChild(renderCard(c)));

  emptyState.hidden = visiveis.length > 0;

  document.getElementById('footer-count').textContent =
    `${visiveis.length} concurso${visiveis.length === 1 ? '' : 's'} exibido${visiveis.length === 1 ? '' : 's'}`;
}

async function init() {
  const toggle = document.getElementById('toggle-all');

  let concursos = [];
  try {
    const res = await fetch(DATA_URL);
    concursos = await res.json();
  } catch (err) {
    console.error('Falha ao carregar dados do Radar:', err);
  }

  render(concursos, toggle.checked);
  toggle.addEventListener('change', () => render(concursos, toggle.checked));
}

init();
