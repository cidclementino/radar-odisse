// Radar Odisse — Acompanhamento de concursos
//
// Os concursos com situação "acompanhando" ou "inscrito", com o que foi lido do site oficial
// (`acompanhamento.site`, ver js/site-oficial.js e js/extrair-site.js). Quem ainda não foi lido é
// lido ao abrir a página, um de cada vez.

const CONCURSOS_URL = `${WORKER}/api/concursos`;
const ACOMPANHADO = new Set(['acompanhando', 'inscrito']);

const TIPO_DATA = {
  abertura: 'Abertura', early: 'Inscrição com desconto', inscricao: 'Inscrição', perguntas: 'Perguntas',
  entrega: 'Entrega', resultado: 'Resultado', prazo: 'Prazo', outra: 'Data citada',
};
const ESCOPO_LABELS = { arquitetura: 'Arquitetura', urbanismo: 'Urbanismo', paisagismo: 'Paisagismo', design_produto_mobiliario: 'Design de produto' };

let concursos = [];
let filtro = prefLer('acompanhamento:filtro', { situacao: 'todos', encerrados: false });

const nomeDe = c => c.apelido || c.nome;

function substituir(atualizado) {
  const i = concursos.findIndex(c => c.id === atualizado.id);
  if (i !== -1) concursos[i] = atualizado; else concursos.push(atualizado);
  cacheGravar('concursos', concursos);
  atualizarContadores();
}

async function patch(id, corpo) {
  const res = await fetch(`${WORKER}/api/concursos/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  if (!res.ok) throw new Error(`o Radar respondeu ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- tela

function secao(titulo, itens, render = escapeHTML) {
  if (!itens || !itens.length) return '';
  return `<section class="acomp__secao"><h3>${titulo}</h3><ul>${itens.map(i => `<li>${render(i)}</li>`).join('')}</ul></section>`;
}

function prazoPrincipal(c) {
  const d = diasAte(c.datas?.inscricao_fim);
  if (d === null) return '<span class="acomp__dias acomp__dias--neutro">—</span><span class="u-apoio">prazo de inscrição não informado</span>';
  if (d < 0) return '<span class="acomp__dias acomp__dias--neutro">—</span><span class="u-apoio">inscrições encerradas</span>';
  const classe = d <= 15 ? 'alta' : d <= 45 ? 'media' : 'baixa';
  return `<span class="acomp__dias acomp__dias--${classe}">${d}</span><span class="u-apoio">${d === 1 ? 'dia' : 'dias'} para o fim das inscrições · ${formatarData(c.datas.inscricao_fim)}</span>`;
}

function renderDatas(c, site) {
  const doRadar = [
    c.datas?.inscricao_fim && { tipo: 'inscricao', data: c.datas.inscricao_fim, trecho: 'Prazo registrado no Radar', radar: true },
    c.datas?.entrega_fim && { tipo: 'entrega', data: c.datas.entrega_fim, trecho: 'Prazo registrado no Radar', radar: true },
  ].filter(Boolean);
  const vistas = new Set();
  const todas = [...doRadar, ...(site?.datas || [])]
    .filter(d => { const k = d.tipo + d.data; if (vistas.has(k)) return false; vistas.add(k); return true; })
    .sort((a, b) => a.data.localeCompare(b.data));
  if (!todas.length) return '';
  const hoje = new Date().toISOString().slice(0, 10);
  return `<section class="acomp__secao acomp__secao--datas"><h3>Datas</h3><ol class="linha-tempo">${todas.map(d => `
    <li class="${d.data < hoje ? 'is-passada' : ''}">
      <span class="linha-tempo__data">${formatarData(d.data)}</span>
      <span class="linha-tempo__tipo">${TIPO_DATA[d.tipo] || d.tipo}${d.radar ? '' : ''}</span>
      <span class="linha-tempo__trecho" title="${escapeHTML(d.trecho)}">${escapeHTML(d.trecho)}</span>
    </li>`).join('')}</ol></section>`;
}

// cartões abertos nesta visita (por padrão todos começam fechados, só com o topo)
const abertos = new Set();

function renderCartao(c) {
  const a = c.acompanhamento || {};
  const site = a.site;
  const el = document.createElement('article');
  const temCorpo = !!(site || c.datas?.inscricao_fim);
  el.className = `acomp${diasAte(c.datas?.inscricao_fim) < 0 ? ' is-apagado' : ''}${abertos.has(c.id) ? ' is-aberto' : ''}`;
  const imagem = c.imagem_url || site?.imagem;
  const link = c.link_oficial || c.fonte_url_original;

  let estadoLeitura;
  if (lendoSite.has(c.id)) estadoLeitura = '<span class="u-apoio">Lendo o site oficial…</span>';
  else if (a.erro) estadoLeitura = `<span class="acomp__erro">Não deu para ler o site: ${escapeHTML(a.erro)}</span>`;
  else if (a.lido_em) estadoLeitura = `<span class="u-apoio">Site lido ${formatarHora(new Date(a.lido_em).getTime())}${site?.paginas?.length > 1 ? ` · ${site.paginas.length} páginas` : ''}</span>`;
  else estadoLeitura = '<span class="u-apoio">Site ainda não lido</span>';

  el.innerHTML = `
    <div class="acomp__cantos">${BOTAO_EDITAR}${temCorpo ? `<button type="button" class="acomp__alternar js-alternar" aria-expanded="${abertos.has(c.id)}" aria-label="${abertos.has(c.id) ? 'Recolher' : 'Ver o que o site oficial diz'}" title="${abertos.has(c.id) ? 'Recolher' : 'Ver o que o site oficial diz'}"></button>` : ''}</div>
    <div class="acomp__topo">
      ${imagem ? `<img class="acomp__banner" src="${escapeHTML(imagem)}" alt="" loading="lazy" decoding="async">` : '<div class="acomp__banner"></div>'}
      <div class="acomp__cabeca">
        <div class="acomp__tags">${(c.escopo || []).map(e => `<span class="u-etiqueta suave">${escapeHTML(ESCOPO_LABELS[e] || e)}</span>`).join('')}</div>
        <h2 class="acomp__nome">${escapeHTML(nomeDe(c))}</h2>
        <p class="acomp__local">${escapeHTML([c.local_projeto, c.promotor].filter(Boolean).join(' · '))}</p>
        <div class="acomp__prazo">${prazoPrincipal(c)}</div>
        <div class="acomp__acoes">
          <select class="situacao js-situacao" aria-label="Situação">
            ${['acompanhando', 'inscrito', 'monitorando', 'descartado'].map(v => `<option value="${v}"${c.status_interno === v ? ' selected' : ''}>${{ acompanhando: 'Acompanhando', inscrito: 'Inscrito', monitorando: 'Voltar ao monitoramento geral', descartado: 'Arquivar' }[v]}</option>`).join('')}
          </select>
          ${link ? `<a class="u-botao" href="${escapeHTML(link)}" target="_blank" rel="noopener">Site oficial ↗</a>` : ''}
          <button type="button" class="u-botao js-reler"${lendoSite.has(c.id) ? ' disabled' : ''}>Ler o site de novo</button>
          ${c.projeto?.id
            ? `<a class="u-botao" href="https://projetos.odisse.com.br/projeto.html#${escapeHTML(c.projeto.id)}" target="_blank" rel="noopener" title="Enviado ao Projetos em ${escapeHTML(formatarData(c.projeto.enviado_em))}">Ver no Projetos · ${escapeHTML(c.projeto.codigo || '')} ↗</a>`
            : '<button type="button" class="u-botao forte js-enviar-projeto">Enviar ao Projetos</button>'}
        </div>
        <div class="acomp__leitura">${estadoLeitura}</div>
      </div>
    </div>
    ${temCorpo ? `<div class="acomp__corpo">
      ${site?.descricao ? `<p class="acomp__descricao">${escapeHTML(site.descricao)}</p>` : ''}
      <div class="acomp__grade">
        ${renderDatas(c, site)}
        ${secao('Inscrição e taxas', site?.taxas)}
        ${secao('Prêmios', site?.premios)}
        ${secao('Quem pode participar', site?.participantes)}
        ${secao('Júri', site?.juri)}
        ${secao('Local', site?.local)}
        ${secao('Idioma', site?.idioma)}
        ${secao('Documentos', site?.documentos, d => `<a href="${escapeHTML(d.url)}" target="_blank" rel="noopener">${escapeHTML(d.texto || d.url)}</a>`)}
        ${secao('Contato', site?.emails, e => `<a href="mailto:${escapeHTML(e)}">${escapeHTML(e)}</a>`)}
        ${secao('Páginas lidas', site?.paginas, u => `<a href="${escapeHTML(u)}" target="_blank" rel="noopener">${escapeHTML(u.replace(/^https?:\/\/(www\.)?/, ''))}</a>`)}
      </div>
    </div>` : ''}`;

  el.querySelector('img.acomp__banner')?.addEventListener('error', e => e.target.removeAttribute('src'), { once: true });

  const sel = el.querySelector('.js-situacao');
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    try {
      substituir(await patch(c.id, { status_interno: sel.value }));
      if (!ACOMPANHADO.has(sel.value)) notificar(sel.value === 'descartado' ? 'Concurso arquivado.' : 'Concurso de volta ao monitoramento geral.');
      render();
    } catch (err) {
      sel.value = c.status_interno;
      sel.disabled = false;
      notificar(`Não foi possível mudar a situação: ${err.message}`, { erro: true });
    }
  });
  el.querySelector('.js-reler').addEventListener('click', () => ler(c, true));
  el.querySelector('.js-enviar-projeto')?.addEventListener('click', () => abrirEnvioProjeto(c));
  el.querySelector('.js-editar').addEventListener('click', () => abrirEdicaoConcurso(c, atualizado => { substituir(atualizado); render(); }));
  el.querySelector('.js-alternar')?.addEventListener('click', e => {
    const aberto = !abertos.has(c.id);
    if (aberto) abertos.add(c.id); else abertos.delete(c.id);
    el.classList.toggle('is-aberto', aberto);
    const rotulo = aberto ? 'Recolher' : 'Ver o que o site oficial diz';
    e.currentTarget.setAttribute('aria-expanded', String(aberto));
    e.currentTarget.setAttribute('aria-label', rotulo);
    e.currentTarget.title = rotulo;
  });
  return el;
}

// ---------------------------------------------------------------- enviar ao Projetos
//
// Mostra antes o que vai ser criado (o Worker monta a prévia: datas, etapas do PGT, avisos) e só cria
// depois da confirmação. Regras em worker/projetos.js.

async function abrirEnvioProjeto(c) {
  let dialogo = document.getElementById('envio-projeto');
  if (!dialogo) {
    dialogo = document.createElement('dialog');
    dialogo.id = 'envio-projeto';
    dialogo.className = 'fusao edicao envio';
    document.body.appendChild(dialogo);
  }
  const url = `${WORKER}/api/concursos/${encodeURIComponent(c.id)}/projeto`;
  dialogo.innerHTML = `<div class="fusao__form"><header class="fusao__topo"><h2>Enviar ao Projetos</h2><button type="button" class="fusao__fechar js-cancelar" aria-label="Fechar">×</button></header>
    <div class="fusao__corpo"><p class="u-apoio">Montando a prévia com o Plano Geral de Trabalho…</p></div></div>`;
  dialogo.querySelector('.js-cancelar').addEventListener('click', () => dialogo.close());
  dialogo.showModal();

  let p;
  try {
    const res = await fetch(url);
    p = await res.json();
    if (!res.ok) throw new Error(p.error || `Worker respondeu ${res.status}`);
  } catch (err) {
    dialogo.querySelector('.fusao__corpo').innerHTML = `<p class="edicao__erro">Não foi possível montar a prévia: ${escapeHTML(err.message)}</p>`;
    return;
  }
  const bloqueado = p.bloqueios.length > 0;
  const lista = items => items.map(t => `<li>${escapeHTML(t)}</li>`).join('');
  dialogo.innerHTML = `
    <form class="fusao__form" method="dialog">
      <header class="fusao__topo"><h2>Enviar ao Projetos</h2><button type="button" class="fusao__fechar js-cancelar" aria-label="Fechar">×</button></header>
      <div class="fusao__corpo envio__corpo">
        ${bloqueado ? `<ul class="envio__bloqueios">${lista(p.bloqueios)}</ul>` : ''}
        <dl class="envio__dados">
          <dt>Projeto</dt><dd>${escapeHTML(p.projeto.nome)}</dd>
          <dt>Código</dt><dd>próximo número da sequência (OA-${escapeHTML(p.inicio.slice(0, 4))}-…)</dd>
          <dt>Núcleo</dt><dd>Odisse Arquitetos · sem cliente · serviço Concurso</dd>
          <dt>Início</dt><dd>${escapeHTML(formatarData(p.inicio))}</dd>
          <dt>Data limite</dt><dd>${p.limite ? `${escapeHTML(formatarData(p.limite))} <span class="u-apoio">(1 dia antes ${p.usouInscricao ? 'do fim das inscrições' : 'da entrega'}, ${escapeHTML(formatarData(p.prazo))})</span>` : '—'}</dd>
        </dl>
        <h3 class="envio__titulo">Etapas do PGT para Concurso${p.pgt_numero ? ` <span class="u-apoio">(publicação nº ${escapeHTML(String(p.pgt_numero))})</span>` : ''}</h3>
        ${p.etapas.length ? `<ol class="envio__etapas">${p.etapas.map(e => `<li><span>${escapeHTML(e.sigla ? `${e.sigla} · ` : '')}${escapeHTML(e.nome)}</span><span class="u-apoio">${e.semanas ? `${String(e.semanas).replace('.', ',')} sem.` : 'sem prazo'}</span></li>`).join('')}</ol>
          ${p.fim_fluxo ? `<p class="u-apoio">Seguindo o fluxo padrão, termina em ${escapeHTML(formatarData(p.fim_fluxo))}.</p>` : ''}` : '<p class="u-apoio">Nenhuma etapa.</p>'}
        ${p.avisos.length ? `<ul class="envio__avisos">${lista(p.avisos)}</ul>` : ''}
        <p class="edicao__erro" role="alert" hidden></p>
      </div>
      <footer class="fusao__rodape">
        <button type="button" class="u-botao js-cancelar">Cancelar</button>
        <button type="submit" class="u-botao forte"${bloqueado ? ' disabled' : ''}>Criar projeto</button>
      </footer>
    </form>`;
  dialogo.querySelectorAll('.js-cancelar').forEach(b => b.addEventListener('click', () => dialogo.close()));
  const form = dialogo.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const botao = form.querySelector('[type=submit]');
    const erro = form.querySelector('.edicao__erro');
    botao.disabled = true; botao.textContent = 'Criando…';
    try {
      const res = await fetch(url, { method: 'POST' });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || `Worker respondeu ${res.status}`);
      dialogo.close();
      substituir(r);
      render();
      notificar(`Projeto ${r.projeto.codigo} criado no Projetos. O concurso passou para Inscrito.`, { ms: 7000 });
    } catch (err) {
      erro.textContent = `Não foi possível criar o projeto: ${err.message}`;
      erro.hidden = false;
      botao.disabled = false; botao.textContent = 'Criar projeto';
    }
  });
}

function visiveis() {
  return concursos
    .filter(c => ACOMPANHADO.has(c.status_interno))
    .filter(c => filtro.situacao === 'todos' || c.status_interno === filtro.situacao)
    .filter(c => filtro.encerrados || !(diasAte(c.datas?.inscricao_fim) < 0))
    .sort((a, b) => comparar(a.datas?.inscricao_fim || null, b.datas?.inscricao_fim || null, 'asc'));
}

function render() {
  const lista = visiveis();
  document.getElementById('acompanhados').replaceChildren(...lista.map(renderCartao));
  const total = concursos.filter(c => ACOMPANHADO.has(c.status_interno)).length;
  document.getElementById('vazio').hidden = lista.length > 0;
  document.getElementById('resumo').textContent = total
    ? `${plural(lista.length, 'concurso', 'concursos')}${lista.length !== total ? ` de ${total} em acompanhamento` : ''}`
    : '';
}

async function ler(c, forcar = false) {
  if (!forcar && c.acompanhamento?.lido_em) return;
  const promessa = lerSiteOficial(c);
  render(); // mostra "Lendo o site oficial…"
  try {
    const lido = await promessa;
    if (lido) substituir(lido);
  } catch (err) {
    notificar(`Não foi possível ler o site de “${nomeDe(c)}”: ${err.message}`, { erro: true });
  }
  render();
}

// quem entrou em acompanhamento mas ainda não teve o site lido é lido agora, um de cada vez
async function lerPendentes() {
  for (const c of concursos.filter(x => ACOMPANHADO.has(x.status_interno) && !x.acompanhamento?.lido_em)) {
    await ler(concursos.find(x => x.id === c.id) || c);
  }
}

let lendoPendentes = false;

function receber(dados) {
  concursos = Array.isArray(dados) ? dados : [];
  render();
  atualizarContadores();
  if (!lendoPendentes) {
    lendoPendentes = true;
    // Se a página estiver sendo pré-carregada (ver regras de pré-carregamento no HTML), a leitura
    // dos sites oficiais espera a pessoa de fato abrir a página.
    const quandoVisivel = document.prerendering
      ? new Promise(r => document.addEventListener('prerenderingchange', r, { once: true }))
      : Promise.resolve();
    quandoVisivel.then(lerPendentes).finally(() => { lendoPendentes = false; });
  }
}

function init() {
  montarSubnav('acompanhamento');
  const sit = document.getElementById('f-situacao');
  const enc = document.getElementById('f-encerrados');
  sit.value = filtro.situacao;
  enc.checked = filtro.encerrados;
  sit.addEventListener('change', () => { filtro.situacao = sit.value; prefGravar('acompanhamento:filtro', filtro); render(); });
  enc.addEventListener('change', () => { filtro.encerrados = enc.checked; prefGravar('acompanhamento:filtro', filtro); render(); });

  if (!cacheLer('concursos')) document.getElementById('resumo').textContent = 'Carregando…';
  carregarComCache('concursos', CONCURSOS_URL, receber);

  const recarregar = document.getElementById('recarregar');
  recarregar.addEventListener('click', async () => {
    recarregar.disabled = true;
    await carregarComCache('concursos', CONCURSOS_URL, receber, { forcar: true });
    recarregar.disabled = false;
  });
}

init();
