// Radar Odisse — renderização da pilha de cards
//
// Fonte de dados: por enquanto lê data/concursos.sample.json (mock).
// Na versão conectada ao Worker, troque DATA_URL pelo endpoint da API
// (ex: 'https://radar-odisse-worker.<subdomain>.workers.dev/api/concursos').

const DATA_URL = 'data/concursos.sample.json';

const STATUS_HIDDEN_BY_DEFAULT = new Set(['descartado', 'inscrito']);

const STATUS_LABELS = {
  monitorando: 'Monitorando',
  descartado: 'Descartado',
  inscrito: 'Inscrito',
};

function diasAte(dataISO) {
  if (!dataISO) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dataISO + 'T00:00:00');
  const diffMs = alvo - hoje;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function corPorPrazo(dias) {
  if (dias === null || dias === undefined) return 'gray';
  if (dias <= 15) return 'red';
  if (dias <= 45) return 'orange';
  return 'green';
}

function textoPrazo(dias) {
  if (dias === null || dias === undefined) return 'Prazo de inscrição não informado';
  if (dias < 0) return 'Inscrições encerradas';
  if (dias === 0) return 'Inscrições encerram hoje';
  if (dias === 1) return 'Inscrições encerram amanhã';
  return `Inscrições encerram em ${dias} dias`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderCard(concurso) {
  const dias = diasAte(concurso.datas?.inscricao_fim);
  const cor = corPorPrazo(dias);
  const hiddenStatus = STATUS_HIDDEN_BY_DEFAULT.has(concurso.status_interno);

  const el = document.createElement('article');
  el.className = `card card--${cor}${hiddenStatus ? ' card--hidden-status' : ''}`;
  el.dataset.status = concurso.status_interno;

  const thumbStyle = concurso.imagem_url
    ? `style="background-image:url('${concurso.imagem_url}')"`
    : '';

  const tags = (concurso.escopo || []).map(e => `<span class="tag">${escapeHTML(e.replace('_', ' '))}</span>`).join('');

  el.innerHTML = `
    <div class="card__thumb" ${thumbStyle}></div>
    <div class="card__body">
      <div class="card__eyebrow">
        <span>${escapeHTML(concurso.tipo)}</span>
        ${tags}
      </div>
      <h2 class="card__title">
        <a href="${escapeHTML(concurso.link_oficial)}" target="_blank" rel="noopener">
          ${escapeHTML(concurso.nome)}
        </a>
      </h2>
      <p class="card__place">${escapeHTML(concurso.local_projeto)}</p>
    </div>
    <div class="card__deadline">
      <span class="card__deadline-count">${dias !== null && dias >= 0 ? dias : '—'}</span>
      <span class="card__deadline-label">${textoPrazo(dias)}</span>
    </div>
    ${concurso.status_interno !== 'monitorando'
      ? `<span class="card__status-pill">${STATUS_LABELS[concurso.status_interno] || concurso.status_interno}</span>`
      : ''}
  `;

  return el;
}

function render(concursos, mostrarTodos) {
  const stack = document.getElementById('stack');
  const emptyState = document.getElementById('empty-state');
  stack.innerHTML = '';

  const ordenados = [...concursos].sort(
    (a, b) => new Date(b.coletado_em) - new Date(a.coletado_em)
  );

  const visiveis = mostrarTodos
    ? ordenados
    : ordenados.filter(c => !STATUS_HIDDEN_BY_DEFAULT.has(c.status_interno));

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
