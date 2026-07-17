// Radar Odisse — renderização da pilha de concursos
//
// Fonte de dados: conectado ao Worker publicado na Cloudflare.

const DATA_URL = 'https://radar-odisse.reservaprojectbasework.workers.dev/api/concursos';
const CONCURSO_URL = id => `https://radar-odisse.reservaprojectbasework.workers.dev/api/concursos/${encodeURIComponent(id)}`;

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

// Estado local dos concursos carregados — atualizado in-place quando o
// usuário descarta/restaura/apaga um card, pra não precisar recarregar a
// lista inteira do Worker a cada ação.
let concursosState = [];

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

// escapeHTML (via textContent->innerHTML) NÃO escapa aspas — correto pra texto
// solto, mas quebra se usado dentro de um atributo tipo value="...". Usado
// especificamente no <input> de apelido, que é o primeiro lugar do código
// que injeta valor dinâmico dentro de um atributo HTML (não só como texto).
function escapeAttr(str) {
  return escapeHTML(str).replace(/"/g, '&quot;');
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

  const descartado = concurso.status_interno === 'descartado';
  const apelidoAtual = concurso.apelido || concurso.nome;

  return `
    <div class="concurso__detail">
      <div class="concurso__apelido">
        <label class="concurso__detail-label" for="apelido-${escapeHTML(concurso.id)}">Apelido de exibição</label>
        <div class="concurso__apelido-row">
          <input
            type="text"
            id="apelido-${escapeHTML(concurso.id)}"
            class="concurso__apelido-input"
            value="${escapeAttr(apelidoAtual)}"
            maxlength="200"
          />
          <button type="button" class="concurso__action-btn concurso__apelido-salvar">Salvar</button>
        </div>
      </div>
      <div class="concurso__detail-grid">
        ${campoDetalhe('Nome capturado (original)', concurso.nome)}
        ${campoDetalhe('Promotor', concurso.promotor)}
        ${campoDetalhe('Destinado a', concurso.destinado_a)}
        ${campoDetalhe('Inscrição', custoTexto)}
        ${campoDetalhe('Prêmio', concurso.premio)}
        ${campoDetalhe('Banca julgadora', bancaTexto)}
        ${campoDetalhe('Entrega do projeto', concurso.datas?.entrega_fim)}
      </div>
      ${link ? `<a class="concurso__detail-link" href="${escapeHTML(link)}" target="_blank" rel="noopener">${linkTexto}</a>` : ''}
      <div class="concurso__actions">
        <button type="button" class="concurso__action-btn concurso__action-btn--descartar" data-action="${descartado ? 'restaurar' : 'descartar'}">
          ${descartado ? 'Restaurar' : 'Descartar'}
        </button>
        <button type="button" class="concurso__action-btn concurso__action-btn--apagar" data-action="apagar">
          Apagar
        </button>
      </div>
    </div>
  `;
}

/** Chama o Worker pra mudar status_interno (descartar/restaurar). Retorna o item atualizado ou null se falhar. */
async function atualizarStatus(id, status_interno) {
  try {
    const res = await fetch(CONCURSO_URL(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status_interno }),
    });
    if (!res.ok) throw new Error(`Worker retornou ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Falha ao atualizar status do concurso:', err);
    alert('Não foi possível atualizar esse concurso agora. Tenta de novo em instantes.');
    return null;
  }
}

/** Chama o Worker pra mudar o apelido de exibição. Retorna o item atualizado ou null se falhar. */
async function atualizarApelido(id, apelido) {
  try {
    const res = await fetch(CONCURSO_URL(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apelido }),
    });
    if (!res.ok) throw new Error(`Worker retornou ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Falha ao atualizar apelido do concurso:', err);
    alert('Não foi possível salvar o apelido agora. Tenta de novo em instantes.');
    return null;
  }
}

/** Chama o Worker pra apagar definitivamente. Retorna true se deu certo. */
async function apagarConcurso(id) {
  try {
    const res = await fetch(CONCURSO_URL(id), { method: 'DELETE' });
    if (!res.ok) throw new Error(`Worker retornou ${res.status}`);
    return true;
  } catch (err) {
    console.error('Falha ao apagar concurso:', err);
    alert('Não foi possível apagar esse concurso agora. Tenta de novo em instantes.');
    return false;
  }
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
  el.dataset.id = concurso.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', 'false');

  // FIX (performance + escape que faltava): a versão anterior usava
  // background-image inline sem escapar a URL (risco de quebrar o atributo
  // se a URL tiver aspas) e o navegador baixava TODAS as imagens assim que
  // o card era criado, mesmo fora da tela. `<img loading="lazy">` resolve os
  // dois: escapa via escapeAttr, e só baixa quando o card está perto de
  // entrar na viewport (suporte nativo do navegador, sem JS extra).
  const banner = concurso.imagem_url
    ? `<img class="concurso__banner" src="${escapeAttr(concurso.imagem_url)}" alt="" loading="lazy" decoding="async" />`
    : `<div class="concurso__banner"></div>`;

  const tags = (concurso.escopo || [])
    .map(e => `<span class="tag">${escapeHTML(ESCOPO_LABELS[e] || e)}</span>`)
    .join('');

  const statusPill = encerrado
    ? '<span class="concurso__status-pill">Encerrado</span>'
    : concurso.status_interno !== 'monitorando'
      ? `<span class="concurso__status-pill">${STATUS_LABELS[concurso.status_interno] || concurso.status_interno}</span>`
      : '';

  el.innerHTML = `
    ${banner}
    <div class="concurso__row">
      <div class="concurso__body">
        <div class="concurso__eyebrow">${tags}</div>
        <h2 class="concurso__title"><span class="concurso__title-text">${escapeHTML(concurso.apelido || concurso.nome)}</span></h2>
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

  // Botões de ação — não podem deixar o clique propagar pro card (senão
  // ele expande/recolhe ao mesmo tempo que a ação roda).
  const toggle = document.getElementById('toggle-all');

  const btnDescartar = el.querySelector('.concurso__action-btn--descartar');
  btnDescartar.addEventListener('click', async e => {
    e.stopPropagation();
    const acao = btnDescartar.dataset.action; // 'descartar' ou 'restaurar'
    const novoStatus = acao === 'descartar' ? 'descartado' : 'monitorando';
    btnDescartar.disabled = true;
    const atualizado = await atualizarStatus(concurso.id, novoStatus);
    btnDescartar.disabled = false;
    if (!atualizado) return;

    const idx = concursosState.findIndex(c => c.id === concurso.id);
    if (idx !== -1) concursosState[idx] = atualizado;
    render(concursosState, toggle.checked);
  });

  const btnApagar = el.querySelector('.concurso__action-btn--apagar');
  btnApagar.addEventListener('click', async e => {
    e.stopPropagation();
    const confirmado = confirm(`Apagar definitivamente "${concurso.nome}"? Essa ação não pode ser desfeita.`);
    if (!confirmado) return;

    btnApagar.disabled = true;
    const ok = await apagarConcurso(concurso.id);
    btnApagar.disabled = false;
    if (!ok) return;

    concursosState = concursosState.filter(c => c.id !== concurso.id);
    render(concursosState, toggle.checked);
  });

  // Campo de apelido — precisa impedir clique/tecla de propagar pro card
  // (senão digitar ou clicar no input expande/recolhe o painel sem querer).
  const inputApelido = el.querySelector('.concurso__apelido-input');
  const btnSalvarApelido = el.querySelector('.concurso__apelido-salvar');
  const tituloEl = el.querySelector('.concurso__title-text');

  inputApelido.addEventListener('click', e => e.stopPropagation());
  inputApelido.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); btnSalvarApelido.click(); }
  });

  btnSalvarApelido.addEventListener('click', async e => {
    e.stopPropagation();
    const novoApelido = inputApelido.value.trim();
    if (!novoApelido) {
      alert('O apelido não pode ficar vazio — se quiser voltar ao nome capturado, cole ele aqui.');
      return;
    }

    btnSalvarApelido.disabled = true;
    const atualizado = await atualizarApelido(concurso.id, novoApelido);
    btnSalvarApelido.disabled = false;
    if (!atualizado) return;

    const idx = concursosState.findIndex(c => c.id === concurso.id);
    if (idx !== -1) concursosState[idx] = atualizado;

    // Atualiza só o título na tela, sem chamar render() inteiro — diferente
    // de descartar/apagar, renomear não muda ordenação nem visibilidade do
    // card, então não há motivo pra recolher o painel que o usuário acabou
    // de usar.
    tituloEl.textContent = atualizado.apelido || atualizado.nome;
  });

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

  try {
    const res = await fetch(DATA_URL);
    concursosState = await res.json();
  } catch (err) {
    console.error('Falha ao carregar dados do Radar:', err);
    concursosState = [];
  }

  render(concursosState, toggle.checked);
  toggle.addEventListener('change', () => render(concursosState, toggle.checked));
}

init();
