// Radar Odisse — peças comuns às páginas (Concursos, Terrenos e Licitações)
//
//   - barra no padrão das ferramentas do Universo (selo + logotipo + "Radar", seções no centro,
//     botão "Universo" à direita, vindo de universo.odisse.com.br/base/v1/barra.js);
//   - cache dos dados no navegador (localStorage), para a página abrir na hora;
//   - preferências da tela (vista e filtros) lembradas entre visitas;
//   - utilitários de texto e data.

const WORKER = 'https://radar-odisse.reservaprojectbasework.workers.dev';

// ---------------------------------------------------------------- senha
//
// Toda chamada ao Worker leva a senha guardada no login (js/auth.js). Se o Worker recusar
// (senha trocada), a pessoa volta ao login.
(function autenticarChamadas() {
  const original = window.fetch.bind(window);
  window.fetch = async (entrada, opcoes = {}) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    if (!url.startsWith(WORKER)) return original(entrada, opcoes);
    const headers = new Headers(opcoes.headers || {});
    headers.set('Authorization', `Bearer ${getSenha()}`);
    const res = await original(entrada, { ...opcoes, headers });
    if (res.status === 401) senhaRecusada();
    return res;
  };
})();

// ---------------------------------------------------------------- barra

// Endereços limpos: quem abrir um link antigo (terrenos.html, index.html) vê o endereço sem o ".html".
// Só troca o que aparece na barra do navegador; a página não recarrega.
if (/\.html$/.test(location.pathname)) {
  const limpo = location.pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
  history.replaceState(null, '', limpo + location.search + location.hash);
}

(function montarBarra() {
  const raiz = document.querySelector('header.topo');
  if (!raiz) return;
  const pagina = raiz.dataset.pagina;
  const SECOES = [
    { id: 'concursos', nome: 'Concursos', href: '/' },
    { id: 'terrenos', nome: 'Terrenos', href: '/terrenos' },
    { id: 'licitacoes', nome: 'Licitações', href: '/licitacoes' },
  ];
  raiz.innerHTML = `
    <a class="topo__casa" href="/" title="Radar">
      <span class="topo__selo" aria-hidden="true"></span>
      <span class="topo__logotipo" role="img" aria-label="Odisse"></span>
      <span class="topo__sub">Radar</span>
    </a>
    <nav class="topo__secoes" aria-label="Seções do Radar">
      ${SECOES.map(s => `<a href="${s.href}"${s.id === pagina ? ' class="is-current" aria-current="page"' : ''}>${s.nome}</a>`).join('')}
    </nav>
    <div class="topo__direita"><a class="topo__sair" href="/login" title="${escapeHTML(getUserName() ? `Conectado como ${getUserName()}` : 'Sair do Radar')}">Sair</a><span data-universo-menu></span></div>`;
  raiz.querySelector('.topo__sair').addEventListener('click', () => logout());
  const s = document.createElement('script');
  s.src = 'https://universo.odisse.com.br/base/v1/barra.js';
  s.defer = true;
  document.head.appendChild(s);
})();

// ---------------------------------------------------------------- cache
//
// A coleta roda uma vez por dia (Terrenos) ou por semana (Concursos), então os dados quase nunca
// mudam entre duas visitas. A página desenha na hora o que está guardado e só pergunta ao Worker
// de novo se a cópia tiver mais de CACHE_FRESCO_MS. Isso também poupa a cota diária de leituras
// do KV na Cloudflare (cada carregamento lê todas as chaves). "Recarregar" força a busca.

const CACHE_VERSAO = 1;
const CACHE_FRESCO_MS = 15 * 60 * 1000;

function cacheLer(chave) {
  try {
    const bruto = localStorage.getItem(`radar:dados:${chave}`);
    if (!bruto) return null;
    const c = JSON.parse(bruto);
    if (c.v !== CACHE_VERSAO || !Array.isArray(c.dados)) return null;
    return c;
  } catch { return null; }
}

function cacheGravar(chave, dados) {
  try {
    localStorage.setItem(`radar:dados:${chave}`, JSON.stringify({ v: CACHE_VERSAO, em: Date.now(), dados }));
  } catch { /* navegador sem espaço ou em modo privado: segue sem cache */ }
}

/**
 * Entrega os dados de `url` para `aoReceber(dados, origem)`:
 *   - primeiro o que está no cache (origem 'cache'), se houver;
 *   - depois a resposta do Worker (origem 'rede'), se o cache estiver velho, faltar ou `forcar`.
 * Devolve uma promessa que resolve quando terminou (com ou sem rede).
 */
async function carregarComCache(chave, url, aoReceber, { forcar = false } = {}) {
  const guardado = cacheLer(chave);
  if (guardado && !forcar) aoReceber(guardado.dados, 'cache', guardado.em);
  if (guardado && !forcar && Date.now() - guardado.em < CACHE_FRESCO_MS) return;

  try {
    // "Recarregar" (forcar) pede ao Worker a lista remontada, sem a cópia guardada lá (ver worker/index.js)
    const res = await fetch(forcar ? `${url}${url.includes('?') ? '&' : '?'}fresco=1` : url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Worker respondeu ${res.status}`);
    const dados = await res.json();
    cacheGravar(chave, dados);
    aoReceber(dados, 'rede', Date.now());
  } catch (err) {
    console.error(`Falha ao buscar ${chave}:`, err);
    if (!guardado) aoReceber([], 'erro', null);
    else if (forcar) aoReceber(guardado.dados, 'cache', guardado.em);
    avisar('Não foi possível falar com o Radar agora. Mostrando a última cópia guardada neste navegador.');
  }
}

function cacheIdade(chave) {
  const c = cacheLer(chave);
  return c ? c.em : null;
}

// ---------------------------------------------------------------- scripts sob demanda
//
// O leitor do site oficial (extrair-site.js + site-oficial.js) só é usado ao clicar em "Acompanhar".
// Na página de Monitoramento geral ele é baixado nessa hora, e não a cada abertura da página.

const LEITOR_SITE = ['js/extrair-site.js?v=7f86806a4e', 'js/site-oficial.js?v=dff3b3dec1']; // versões: scripts/versionar.py
let leitorSite = null;
function garantirLeitorSite() {
  if (typeof lerSiteOficial === 'function') return Promise.resolve();
  const carregar = src => new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => falha(new Error(`não carregou ${src}`));
    document.head.appendChild(s);
  });
  leitorSite ||= carregar(LEITOR_SITE[0]).then(() => carregar(LEITOR_SITE[1]))
    .catch(err => { leitorSite = null; throw err; });
  return leitorSite;
}

// ---------------------------------------------------------------- preferências

function prefLer(chave, padrao) {
  try {
    const v = JSON.parse(localStorage.getItem(`radar:pref:${chave}`));
    return v ?? padrao;
  } catch { return padrao; }
}

function prefGravar(chave, valor) {
  try { localStorage.setItem(`radar:pref:${chave}`, JSON.stringify(valor)); } catch { /* ok */ }
}

// ---------------------------------------------------------------- aviso

function avisar(texto) {
  const el = document.getElementById('aviso');
  if (!el) return;
  el.textContent = texto;
  el.hidden = !texto;
}

// ---------------------------------------------------------------- texto e data

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// mantido por compatibilidade com o código antigo: escapeHTML já escapa aspas
const escapeAttr = escapeHTML;

/** texto sem acento e em minúsculas, para busca */
function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function formatarData(iso, { curta = false } = {}) {
  if (!iso) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', curta ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatarHora(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return mesmoDia ? `hoje, ${hora}` : `${formatarData(d.toISOString(), { curta: true })}, ${hora}`;
}

/** dias corridos de hoje até a data (AAAA-MM-DD); negativo se já passou */
function diasAte(dataISO) {
  if (!dataISO) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dataISO + 'T00:00:00');
  if (Number.isNaN(alvo.getTime())) return null;
  return Math.round((alvo - hoje) / 86400000);
}

/** dias desde um instante ou data até hoje */
function diasDesde(iso) {
  if (!iso) return null;
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

// ---------------------------------------------------------------- controles

/** preenche um <select> com opções [valor, rótulo], mantendo a escolha atual se ainda existir */
function preencherSelect(select, opcoes, rotuloTodos) {
  const atual = select.value;
  select.innerHTML = `<option value="">${escapeHTML(rotuloTodos)}</option>` +
    opcoes.map(([v, r]) => `<option value="${escapeHTML(v)}">${escapeHTML(r)}</option>`).join('');
  if (opcoes.some(([v]) => v === atual)) select.value = atual;
}

/** alternância Cartões / Lista; chama aoMudar(vista) */
function ligarVista(grupo, chavePref, aoMudar) {
  let vista = prefLer(chavePref, 'cartoes');
  const marcar = () => grupo.querySelectorAll('button').forEach(b => {
    const ativo = b.dataset.vista === vista;
    b.classList.toggle('is-ativo', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  });
  grupo.addEventListener('click', e => {
    const b = e.target.closest('button[data-vista]');
    if (!b || b.dataset.vista === vista) return;
    vista = b.dataset.vista;
    prefGravar(chavePref, vista);
    marcar();
    aoMudar(vista);
  });
  marcar();
  return () => vista;
}

/**
 * Cabeçalho de tabela ordenável. `colunas`: [{ id, rotulo, classe? , ordena?: false }].
 * Devolve o HTML do <thead>; o clique é tratado por ligarOrdenacao.
 */
function theadOrdenavel(colunas, ordem) {
  return `<thead><tr>${colunas.map(c => {
    if (c.ordena === false) return `<th class="${c.classe || ''}">${escapeHTML(c.rotulo)}</th>`;
    const ativo = ordem.coluna === c.id;
    const seta = ativo ? (ordem.direcao === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="${c.classe || ''}" aria-sort="${ativo ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}">
      <button type="button" class="th-ordena${ativo ? ' is-ativo' : ''}" data-coluna="${c.id}">${escapeHTML(c.rotulo)}${seta}</button></th>`;
  }).join('')}</tr></thead>`;
}

function ligarOrdenacao(tabela, ordem, aoMudar) {
  tabela.querySelector('thead').addEventListener('click', e => {
    const b = e.target.closest('.th-ordena');
    if (!b) return;
    const col = b.dataset.coluna;
    if (ordem.coluna === col) ordem.direcao = ordem.direcao === 'asc' ? 'desc' : 'asc';
    else { ordem.coluna = col; ordem.direcao = 'asc'; }
    aoMudar();
  });
}

/** compara dois valores para ordenação: nulos sempre por último */
function comparar(a, b, direcao) {
  const vazioA = a === null || a === undefined || a === '';
  const vazioB = b === null || b === undefined || b === '';
  if (vazioA && vazioB) return 0;
  if (vazioA) return 1;
  if (vazioB) return -1;
  const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
  return direcao === 'asc' ? r : -r;
}

// ---------------------------------------------------------------- submenu de Concursos
//
// Concursos tem três páginas: o monitoramento geral (index.html), o acompanhamento específico
// (acompanhamento.html) e a revisão de duplicados (revisao.html). Os números vêm das cópias
// guardadas no navegador; a fila de revisão é buscada (com cache) para o contador.

function montarSubnav(atual) {
  const nav = document.getElementById('subnav');
  if (!nav) return;
  const ABAS = [
    { id: 'geral', nome: 'Monitoramento geral', href: '/' },
    { id: 'acompanhamento', nome: 'Acompanhamento', href: '/acompanhamento', contador: 'contador-acompanhamento' },
    { id: 'revisao', nome: 'Revisão', href: '/revisao', contador: 'contador-revisao' },
  ];
  nav.innerHTML = ABAS.map(a => `<a href="${a.href}"${a.id === atual ? ' class="is-atual" aria-current="page"' : ''}>${a.nome}${a.contador ? `<span class="contador" id="${a.contador}" hidden></span>` : ''}</a>`).join('');
  atualizarContadores();
  if (atual !== 'revisao') carregarComCache('revisao', `${WORKER}/api/revisao`, () => atualizarContadores());
}

function atualizarContadores() {
  const pintar = (id, n, titulo) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n;
    el.hidden = !n;
    el.parentElement.title = titulo;
  };
  const conc = cacheLer('concursos')?.dados || [];
  const acomp = conc.filter(c => ['acompanhando', 'inscrito'].includes(c.status_interno)).length;
  pintar('contador-acompanhamento', acomp, acomp ? plural(acomp, 'concurso em acompanhamento', 'concursos em acompanhamento') : 'Nenhum concurso em acompanhamento');
  const rev = new Set((cacheLer('revisao')?.dados || []).map(p => p.candidato_novo?.id)).size;
  pintar('contador-revisao', rev, rev ? plural(rev, 'concurso esperando decisão', 'concursos esperando decisão') : 'Nenhuma pendência de revisão');
}

// ---------------------------------------------------------------- aviso passageiro

function notificar(texto, { erro = false, ms = 4500 } = {}) {
  let el = document.getElementById('notificacao');
  if (!el) {
    el = document.createElement('div');
    el.id = 'notificacao';
    el.className = 'notificacao';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = texto;
  el.classList.toggle('is-erro', erro);
  el.hidden = false;
  clearTimeout(el._t);
  if (ms) el._t = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------------------------------------------------------------- edição do concurso (lápis)
//
// Nome exibido e datas, num diálogo pequeno. Usado em Monitoramento geral e Acompanhamento.
// Datas corrigidas à mão ficam marcadas no Worker (`datas_manuais`) e a coleta não mexe mais nelas.

const LAPIS_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M11.3 1.8a1.6 1.6 0 0 1 2.3 0l.6.6a1.6 1.6 0 0 1 0 2.3L5.5 13.4l-3.3.8.8-3.3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 3.1l2.9 2.9" stroke="currentColor" stroke-width="1.4"/></svg>';
const BOTAO_EDITAR = `<button type="button" class="editar-nome js-editar" title="Editar nome e datas" aria-label="Editar nome e datas">${LAPIS_SVG}</button>`;

function abrirEdicaoConcurso(c, aoSalvar) {
  let dialogo = document.getElementById('edicao-concurso');
  if (!dialogo) {
    dialogo = document.createElement('dialog');
    dialogo.id = 'edicao-concurso';
    dialogo.className = 'fusao edicao';
    document.body.appendChild(dialogo);
  }
  const d = c.datas || {};
  const nomeAtual = c.apelido || c.nome || '';
  dialogo.innerHTML = `
    <form class="fusao__form" method="dialog">
      <header class="fusao__topo"><h2>Editar concurso</h2><button type="button" class="fusao__fechar js-cancelar" aria-label="Fechar">×</button></header>
      <div class="fusao__corpo edicao__corpo">
        <label class="u-campo"><span>Nome exibido</span>
          <input type="text" name="nome" maxlength="200" required value="${escapeHTML(nomeAtual)}">
          ${c.nome && c.nome !== nomeAtual ? `<small>Nome na fonte: ${escapeHTML(c.nome)}</small>` : ''}</label>
        <div class="edicao__datas">
          <label class="u-campo"><span>Fim das inscrições</span><input type="date" name="inscricao_fim" value="${escapeHTML(d.inscricao_fim || '')}"></label>
          <label class="u-campo"><span>Entrega das propostas</span><input type="date" name="entrega_fim" value="${escapeHTML(d.entrega_fim || '')}"></label>
        </div>
        <p class="u-apoio edicao__nota">${c.datas_manuais ? 'As datas já foram corrigidas à mão: a coleta não mexe nelas.' : 'Ao corrigir uma data, a coleta deixa de mexer nas datas deste concurso.'}</p>
        <p class="edicao__erro" role="alert" hidden></p>
      </div>
      <footer class="fusao__rodape">
        <button type="button" class="u-botao js-cancelar">Cancelar</button>
        <button type="submit" class="u-botao forte">Salvar</button>
      </footer>
    </form>`;
  dialogo.querySelectorAll('.js-cancelar').forEach(b => b.addEventListener('click', () => dialogo.close()));
  const form = dialogo.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const corpo = {};
    const nome = form.nome.value.replace(/\s+/g, ' ').trim();
    if (nome && nome !== nomeAtual) corpo.apelido = nome;
    const datas = {};
    for (const k of ['inscricao_fim', 'entrega_fim']) {
      const v = form[k].value || null;
      if (v !== (d[k] || null)) datas[k] = v;
    }
    if (Object.keys(datas).length) corpo.datas = datas;
    if (!Object.keys(corpo).length) { dialogo.close(); return; }
    const botao = form.querySelector('[type=submit]');
    const erro = form.querySelector('.edicao__erro');
    botao.disabled = true; botao.textContent = 'Salvando…';
    try {
      const res = await fetch(`${WORKER}/api/concursos/${encodeURIComponent(c.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || `Worker respondeu ${res.status}`);
      dialogo.close();
      aoSalvar(r);
    } catch (err) {
      erro.textContent = `Não foi possível salvar: ${err.message}`;
      erro.hidden = false;
      botao.disabled = false; botao.textContent = 'Salvar';
    }
  });
  dialogo.showModal();
  form.nome.focus();
  form.nome.select();
}
