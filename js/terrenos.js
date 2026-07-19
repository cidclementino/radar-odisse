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
  if (op.corretor_vinculado_id) el.dataset.corretorId = op.corretor_vinculado_id;

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
      <span class="oportunidade__corretor-nome">${corretor ? escapeHTML(corretor.nome) : ''}</span>
    </div>
  `;

  return el;
}

const CORRETORES_PAGE_SIZE = 10;

// Estado dos corretores só existe depois que `carregarCorretores()` roda —
// antes disso fica vazio, e é isso que permite a página inicial (Oportunidades)
// renderizar sem esperar essa lista, que costuma ser a mais pesada.
let corretoresState = [];
let corretoresPorId = {};
let corretoresOrdenados = [];
let corretoresRenderizados = 0;
let corretoresCarregados = false;
let corretoresCarregando = false;

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

// Preenche o nome do corretor vinculado nos cards de Oportunidade que já
// estão na tela — só é chamado depois que `carregarCorretores()` resolve,
// já que na primeira renderização das Oportunidades essa lista ainda não
// tinha sido buscada.
function atualizarCorretorNasOportunidades() {
  document.querySelectorAll('.oportunidade[data-corretor-id]').forEach(el => {
    const corretor = corretoresPorId[el.dataset.corretorId];
    if (!corretor) return;
    const span = el.querySelector('.oportunidade__corretor-nome');
    if (span) span.textContent = corretor.nome;
  });
}

// Renderiza o próximo lote de 10 corretores. Chamado uma vez que o fetch
// resolve (primeiro lote) e depois a cada clique em "Carregar mais".
function renderProximoLoteCorretores() {
  const list = document.getElementById('corretor-list');
  const proximos = corretoresOrdenados.slice(corretoresRenderizados, corretoresRenderizados + CORRETORES_PAGE_SIZE);
  proximos.forEach(c => list.appendChild(renderCorretor(c)));
  corretoresRenderizados += proximos.length;
  atualizarBotaoCarregarMaisCorretores();
}

function atualizarBotaoCarregarMaisCorretores() {
  const wrap = document.getElementById('corretor-load-more');
  wrap.innerHTML = '';
  const restantes = corretoresOrdenados.length - corretoresRenderizados;
  if (restantes <= 0) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'load-more-btn';
  btn.textContent = `Carregar mais corretores (${restantes} restante${restantes === 1 ? '' : 's'})`;
  btn.addEventListener('click', () => renderProximoLoteCorretores());
  wrap.appendChild(btn);
}

/**
 * Busca e renderiza a lista de Corretores. Fica de fora do carregamento
 * inicial da página de propósito (ver `init`) — essa lista tende a ser a
 * mais pesada da aba Terrenos e não é o conteúdo principal, então só busca
 * quando o usuário rola até a seção "Corretores" (via IntersectionObserver
 * em `init`), e mesmo aí desenha só os 10 primeiros por vez.
 */
async function carregarCorretores() {
  if (corretoresCarregados || corretoresCarregando) return;
  corretoresCarregando = true;

  const list = document.getElementById('corretor-list');
  list.innerHTML = '<p class="empty-state small">Carregando corretores…</p>';

  try {
    const res = await fetch(CORRETORES_URL);
    corretoresState = await res.json();
  } catch (err) {
    console.error('Falha ao carregar corretores:', err);
    corretoresState = [];
  }

  corretoresPorId = Object.fromEntries(corretoresState.map(c => [c.id, c]));
  corretoresOrdenados = [...corretoresState].sort((a, b) => b.nivel_maturidade - a.nivel_maturidade);
  corretoresRenderizados = 0;
  corretoresCarregados = true;
  corretoresCarregando = false;

  list.innerHTML = '';
  if (corretoresOrdenados.length === 0) {
    list.innerHTML = '<p class="empty-state small">Nenhum corretor acumulado ainda.</p>';
  } else {
    renderProximoLoteCorretores();
  }

  // Os cards de Oportunidade já podem estar na tela (ela não espera essa
  // busca) — agora que os dados chegaram, preenche o nome do corretor
  // vinculado onde fizer sentido.
  atualizarCorretorNasOportunidades();
}

function renderOportunidades(oportunidades, corretoresPorIdAtual, mostrarTodos) {
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

  visiveis.forEach(op => stack.appendChild(renderOportunidade(op, corretoresPorIdAtual)));

  emptyState.hidden = visiveis.length > 0;

  document.getElementById('footer-count').textContent =
    `${visiveis.length} oportunidade${visiveis.length === 1 ? '' : 's'} exibida${visiveis.length === 1 ? '' : 's'}`;
}

// Aciona `carregarCorretores()` assim que a seção "Corretores" entra (ou
// chega perto de entrar) na viewport, em vez de buscar tudo de cara no
// carregamento da página.
function observarSecaoCorretores() {
  const alvo = document.getElementById('section-corretores');
  if (!alvo) return;

  if (!('IntersectionObserver' in window)) {
    // Fallback pra navegadores sem suporte: carrega depois que a página
    // termina de renderizar o essencial, sem bloquear o resto.
    setTimeout(carregarCorretores, 300);
    return;
  }

  const observer = new IntersectionObserver(entradas => {
    if (entradas.some(e => e.isIntersecting)) {
      carregarCorretores();
      observer.disconnect();
    }
  }, { rootMargin: '200px' });

  observer.observe(alvo);
}

async function init() {
  const toggle = document.getElementById('toggle-all');

  observarSecaoCorretores();

  let oportunidades = [];
  try {
    const res = await fetch(OPORTUNIDADES_URL);
    oportunidades = await res.json();
  } catch (err) {
    console.error('Falha ao carregar oportunidades do Radar (Terrenos):', err);
    oportunidades = [];
  }

  // Renderiza Oportunidades imediatamente — não espera a lista de
  // Corretores, que é buscada à parte (ver `observarSecaoCorretores`).
  // `corretoresPorId` pode estar vazio aqui; os nomes que faltarem são
  // preenchidos depois, em `atualizarCorretorNasOportunidades`.
  renderOportunidades(oportunidades, corretoresPorId, toggle.checked);
  toggle.addEventListener('change', () => renderOportunidades(oportunidades, corretoresPorId, toggle.checked));
}

init();
