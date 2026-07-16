// Radar Odisse — Terrenos: oportunidades (terrenista/corretor) + perfis de corretor
//
// Fonte de dados: conectado ao Worker publicado na Cloudflare.

const OPORTUNIDADES_URL = 'https://radar-odisse.reservaprojectbasework.workers.dev/api/oportunidades';
const CORRETORES_URL = 'https://radar-odisse.reservaprojectbasework.workers.dev/api/corretores';

const STATUS_HIDDEN_BY_DEFAULT = new Set(['descartado', 'abordado']);

const NIVEL_LABELS = {
  1: 'Nível 1 · Observação',
  2: 'Nível 2 · Qualificado',
  3: 'Nível 3 · Processo aberto',
};

const PERSONA_LABELS = {
  terrenista: 'Terrenista',
  corretor: 'Corretor',
};

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderOportunidade(op, corretoresPorId) {
  const hiddenStatus = STATUS_HIDDEN_BY_DEFAULT.has(op.status_interno);
  const el = document.createElement('article');
  el.className = `oportunidade oportunidade--nivel-${op.nivel_maturidade}${hiddenStatus ? ' oportunidade--hidden-status' : ''}`;
  el.dataset.status = op.status_interno;

  const corretor = op.corretor_vinculado_id ? corretoresPorId[op.corretor_vinculado_id] : null;
  const nivelTagClass = op.nivel_maturidade >= 2 ? ` tag--nivel-${op.nivel_maturidade}` : '';

  el.innerHTML = `
    <div class="oportunidade__eyebrow">
      <span class="tag">${escapeHTML(PERSONA_LABELS[op.persona] || op.persona)}</span>
      <span class="tag${nivelTagClass}">${escapeHTML(NIVEL_LABELS[op.nivel_maturidade] || `Nível ${op.nivel_maturidade}`)}</span>
    </div>
    <h2 class="oportunidade__title">
      <a href="${escapeHTML(op.link_original)}" target="_blank" rel="noopener">${escapeHTML(op.titulo)}</a>
    </h2>
    <p class="oportunidade__place">${escapeHTML(op.local)}</p>
    <div class="oportunidade__footer">
      <span>${escapeHTML(op.fonte)}</span>
      <span>${corretor ? escapeHTML(corretor.nome) : ''}</span>
    </div>
  `;

  return el;
}

function renderCorretor(c) {
  const el = document.createElement('article');
  el.className = 'corretor';

  const badges = [];
  if (c.creci) badges.push(`<span class="tag">CRECI ${escapeHTML(c.creci)}</span>`);
  badges.push(`<span class="tag${c.nivel_maturidade >= 2 ? ` tag--nivel-${c.nivel_maturidade}` : ''}">${escapeHTML(NIVEL_LABELS[c.nivel_maturidade] || `Nível ${c.nivel_maturidade}`)}</span>`);

  el.innerHTML = `
    <div>
      <p class="corretor__nome">${escapeHTML(c.nome)}</p>
      ${c.empresa ? `<p class="corretor__empresa">${escapeHTML(c.empresa)}</p>` : ''}
      <div class="corretor__meta">
        <span>${escapeHTML((c.regioes_atuacao || []).join(', '))}</span>
        <span>Descoberto via: ${escapeHTML((c.descoberto_via || []).join(', '))}</span>
        ${c.volume_zap ? `<span>${c.volume_zap} terrenos no ZAP</span>` : ''}
      </div>
    </div>
    <div class="corretor__badges">${badges.join('')}</div>
  `;

  return el;
}

function renderOportunidades(oportunidades, corretoresPorId, mostrarTodos) {
  const stack = document.getElementById('stack-oportunidades');
  const emptyState = document.getElementById('empty-state');
  stack.innerHTML = '';

  // Ordena por nível de maturidade (mais urgente primeiro), depois por mais recente coletado.
  const ordenados = [...oportunidades].sort((a, b) => {
    if (b.nivel_maturidade !== a.nivel_maturidade) return b.nivel_maturidade - a.nivel_maturidade;
    return new Date(b.coletado_em) - new Date(a.coletado_em);
  });

  const visiveis = mostrarTodos
    ? ordenados
    : ordenados.filter(op => !STATUS_HIDDEN_BY_DEFAULT.has(op.status_interno));

  visiveis.forEach(op => stack.appendChild(renderOportunidade(op, corretoresPorId)));

  emptyState.hidden = visiveis.length > 0;

  document.getElementById('footer-count').textContent =
    `${visiveis.length} oportunidade${visiveis.length === 1 ? '' : 's'} exibida${visiveis.length === 1 ? '' : 's'}`;
}

function renderCorretores(corretores) {
  const list = document.getElementById('corretor-list');
  list.innerHTML = '';
  const ordenados = [...corretores].sort((a, b) => b.nivel_maturidade - a.nivel_maturidade);
  ordenados.forEach(c => list.appendChild(renderCorretor(c)));
}

async function init() {
  const toggle = document.getElementById('toggle-all');

  let oportunidades = [];
  let corretores = [];
  try {
    const [resOp, resCorretores] = await Promise.all([
      fetch(OPORTUNIDADES_URL),
      fetch(CORRETORES_URL),
    ]);
    oportunidades = await resOp.json();
    corretores = await resCorretores.json();
  } catch (err) {
    console.error('Falha ao carregar dados do Radar (Terrenos):', err);
  }

  const corretoresPorId = Object.fromEntries(corretores.map(c => [c.id, c]));

  renderOportunidades(oportunidades, corretoresPorId, toggle.checked);
  renderCorretores(corretores);
  toggle.addEventListener('change', () => renderOportunidades(oportunidades, corretoresPorId, toggle.checked));
}

init();
