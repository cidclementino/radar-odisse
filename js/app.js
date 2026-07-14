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

function diasAte(dataISO) {
  if (!dataISO) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dataISO + 'T00:00:00');
  return Math.round((alvo - hoje) / (1000 * 60 * 60 * 24));
}

// Um concurso é considerado "encerrado" automaticamente quando o prazo de
// inscrição já passou, independente do status_interno ter sido atualizado
// manualmente ou não. Isso evita mostrar como "aberto" algo cujo prazo já
// venceu só porque ninguém tocou no card antes disso acontecer.
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

function textoPrazo(dias, encerrado) {
  if (encerrado) return 'Inscrições encerradas';
  if (dias === null || dias === undefined) return 'Prazo de inscrição não informado';
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
  const encerrado = estaEncerrado(dias);
  const cor = corPorPrazo(dias, encerrado);
  const hiddenStatus = STATUS_HIDDEN_BY_DEFAULT.has(concurso.status_interno) || encerrado;

  // link_oficial é o site do concurso; quando desconhecido, cai pro link do
  // agregador (fonte_url_original) — sempre precisa de ALGUM link clicável.
  const link = concurso.link_oficial || concurso.fonte_url_original;

  const el = document.createElement('article');
  el.className = `concurso concurso--${cor}${hiddenStatus ? ' concurso--hidden-status' : ''}`;
  el.dataset.status = concurso.status_interno;
  el.dataset.encerrado = String(encerrado);

  const thumbStyle = concurso.imagem_url
    ? `style="background-image:url('${concurso.imagem_url}')"`
    : '';

  const tags = (concurso.escopo || [])
    .map(e => `<span class="tag">${escapeHTML(e.replace('_', ' '))}</span>`)
    .join('');

  const statusPill = encerrado
    ? '<span class="concurso__status-pill">Encerrado</span>'
    : concurso.status_interno !== 'monitorando'
      ? `<span class="concurso__status-pill">${STATUS_LABELS[concurso.status_interno] || concurso.status_interno}</span>`
      : '';

  el.innerHTML = `
    <div class="concurso__thumb" ${thumbStyle}></div>
    <div class="concurso__body">
      <div class="concurso__eyebrow">
        <span>${escapeHTML(concurso.tipo)}</span>
        ${tags}
      </div>
      <h2 class="concurso__title">
        <a href="${escapeHTML(link || '#')}" target="_blank" rel="noopener">
          ${escapeHTML(concurso.nome)}
        </a>
      </h2>
      <p class="concurso__place">${escapeHTML(concurso.local_projeto)}</p>
    </div>
    <div class="concurso__deadline">
      <span class="concurso__deadline-count tabular">${!encerrado && dias !== null ? dias : '—'}</span>
      <span class="concurso__deadline-label">${textoPrazo(dias, encerrado)}</span>
    </div>
    ${statusPill}
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
