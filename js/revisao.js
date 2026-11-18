// Radar Odisse — Revisão de concursos
//
// Mostra a fila REVISAO do Worker: pares (concurso já no Radar × concurso encontrado na coleta) que
// se parecem mas têm algum campo em conflito. Cada par é resolvido em POST /api/revisao/resolver:
//   fundir   → é o mesmo concurso (campos em conflito: escolhe-se qual valor fica)
//   separar  → são diferentes; o novo entra no Radar
//   arquivar → diferente e sem interesse; entra já arquivado
// A fila não usa cache: precisa estar sempre atual.

const REVISAO_URL = `${WORKER}/api/revisao`;
const RESOLVER_URL = `${WORKER}/api/revisao/resolver`;

const CAMPOS = [
  { id: 'nome', rotulo: 'Nome', valor: c => c.nome },
  { id: 'local_projeto', rotulo: 'Local', valor: c => c.local_projeto },
  { id: 'inscricao_fim', rotulo: 'Fim das inscrições', valor: c => formatarData(c.datas?.inscricao_fim) },
  { id: 'entrega_fim', rotulo: 'Entrega', valor: c => formatarData(c.datas?.entrega_fim) },
  { id: 'link_oficial', rotulo: 'Link oficial', valor: c => c.link_oficial, link: true },
];
const EXTRAS = [
  { rotulo: 'Promotor', valor: c => c.promotor },
  { rotulo: 'Fontes', valor: c => (c.fontes && c.fontes.length ? c.fontes : [c.fonte]).filter(Boolean).join(', ') },
  { rotulo: 'Publicação na fonte', valor: c => c.fonte_url_original, link: true },
];
const ESTADO_LABEL = { bate: 'igual', ausente: 'falta num dos dois', conflito: 'diferente' };

let pendencias = [];

// Mesma regra do Worker (indicioDeMesmoConcurso em worker/dedup.js): sem isso, o par só caiu na
// fila porque os nomes repetem palavras comuns ("Design Awards", "Competition").
function temIndicio(p) {
  const m = p.motivo || {};
  if (m.nome === 'bate') return true;
  return ['inscricao_fim', 'entrega_fim', 'link_oficial'].filter(k => m[k] === 'bate').length >= 2;
}

const chaveDe = p => `${p.candidato_existente.id}__${p.candidato_novo.id}`;

// ---------------------------------------------------------------- Worker

async function resolver(p, acao, usarNovo = []) {
  const res = await fetch(RESOLVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ existente_id: p.candidato_existente.id, novo_id: p.candidato_novo.id, acao, usar_novo: usarNovo }),
  });
  if (res.status === 404 && !(await res.clone().json().catch(() => ({}))).error?.includes('pendência')) {
    throw new Error('rota-ausente');
  }
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo.error || `Worker respondeu ${res.status}`);
  return corpo;
}

// O concurso criado ou fundido entra na cópia guardada de Concursos, para aparecer lá sem esperar.
function atualizarCacheConcursos(concurso) {
  const c = cacheLer('concursos');
  if (!c || !concurso) return;
  const i = c.dados.findIndex(x => x.id === concurso.id);
  if (i === -1) c.dados.push(concurso); else c.dados[i] = concurso;
  try { localStorage.setItem('radar:dados:concursos', JSON.stringify({ ...c, dados: c.dados })); } catch { /* ok */ }
}

function tirarDaTela(novoId) {
  pendencias = pendencias.filter(x => x.candidato_novo.id !== novoId);
  render();
}

function avisoRotaAusente() {
  avisar('O Worker do Radar ainda não tem a função de revisão publicada. Assim que a publicação do Worker rodar (workflow "Publicar Worker do Radar"), os botões passam a funcionar.');
}

// ---------------------------------------------------------------- tela

function celula(campo, c) {
  const v = campo.valor(c);
  if (!v) return '<span class="u-apoio">—</span>';
  if (campo.link) return `<a href="${escapeHTML(v)}" target="_blank" rel="noopener">${escapeHTML(v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a>`;
  return escapeHTML(v);
}

function renderPendencia(p) {
  const ex = p.candidato_existente;
  const nv = p.candidato_novo;
  const m = p.motivo || {};
  const el = document.createElement('article');
  el.className = `pendencia${temIndicio(p) ? ' pendencia--indicio' : ''}`;

  const linhas = CAMPOS.map(campo => {
    const estado = m[campo.id] || 'ausente';
    const escolha = estado === 'conflito'
      ? `<label class="pendencia__usar"><input type="checkbox" data-campo="${campo.id}"> usar o novo ao juntar</label>`
      : '';
    return `<tr class="estado-${estado}">
      <th scope="row">${campo.rotulo}<span class="pendencia__estado">${ESTADO_LABEL[estado]}</span></th>
      <td>${celula(campo, ex)}</td>
      <td>${celula(campo, nv)}${escolha}</td>
    </tr>`;
  }).join('') + EXTRAS.map(campo => `<tr class="estado-info">
      <th scope="row">${campo.rotulo}</th><td>${celula(campo, ex)}</td><td>${celula(campo, nv)}</td></tr>`).join('');

  el.innerHTML = `
    <header class="pendencia__topo">
      <span class="u-etiqueta ${temIndicio(p) ? 'nivel-2' : 'nivel-1'}">${temIndicio(p) ? 'Pode ser o mesmo concurso' : 'Só os nomes se parecem'}</span>
      <span class="u-apoio">Na fila desde ${formatarData(p.criado_em)}</span>
    </header>
    <div class="tabela-rolagem"><table class="u-tabela pendencia__tabela">
      <thead><tr><th></th><th>Já no Radar</th><th>Encontrado na coleta</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>
    <div class="pendencia__acoes">
      <button type="button" class="u-botao${temIndicio(p) ? ' forte' : ''} js-fundir">É o mesmo concurso: juntar</button>
      <button type="button" class="u-botao${temIndicio(p) ? '' : ' forte'} js-separar">São diferentes: incluir o novo</button>
      <button type="button" class="u-botao js-arquivar">Diferente e sem interesse: arquivar</button>
    </div>`;

  const botoes = el.querySelectorAll('.pendencia__acoes button');
  const agir = async (acao, usar) => {
    botoes.forEach(b => { b.disabled = true; });
    try {
      const r = await resolver(p, acao, usar);
      atualizarCacheConcursos(r.concurso);
      tirarDaTela(nv.id);
    } catch (err) {
      botoes.forEach(b => { b.disabled = false; });
      if (err.message === 'rota-ausente') { avisoRotaAusente(); return; }
      alert(`Não foi possível resolver agora: ${err.message}`);
      if (/não encontrada/.test(err.message)) tirarDaTela(nv.id);
    }
  };
  el.querySelector('.js-fundir').addEventListener('click', () =>
    agir('fundir', [...el.querySelectorAll('input[data-campo]:checked')].map(i => i.dataset.campo)));
  el.querySelector('.js-separar').addEventListener('click', () => agir('separar'));
  el.querySelector('.js-arquivar').addEventListener('click', () => agir('arquivar'));
  return el;
}

function renderLote() {
  const lote = document.getElementById('lote');
  // um concurso novo pode estar em mais de um par; só é "sem indício" se nenhum par dele tiver indício
  const comIndicio = new Set(pendencias.filter(temIndicio).map(p => p.candidato_novo.id));
  const semIndicio = pendencias.filter(p => !comIndicio.has(p.candidato_novo.id));
  const novos = [...new Map(semIndicio.map(p => [p.candidato_novo.id, p])).values()];
  if (!novos.length) { lote.hidden = true; return; }
  lote.hidden = false;
  lote.innerHTML = `
    <p><strong>${plural(novos.length, 'concurso', 'concursos')} só ${novos.length === 1 ? 'caiu' : 'caíram'} aqui porque o nome repete palavras comuns</strong> (como “Design Awards” ou “Competition”): nenhum dado importante bate com o concurso comparado. A coleta não manda mais casos assim para a revisão.</p>
    <button type="button" class="u-botao forte" id="liberar">Incluir ${novos.length === 1 ? 'este concurso' : `os ${novos.length}`} no Radar</button>
    <span class="u-apoio" id="liberar-progresso"></span>`;
  document.getElementById('liberar').addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true;
    const prog = document.getElementById('liberar-progresso');
    let feitos = 0;
    for (const p of novos) {
      prog.textContent = `${feitos} de ${novos.length}…`;
      try {
        const r = await resolver(p, 'separar');
        atualizarCacheConcursos(r.concurso);
      } catch (err) {
        if (err.message === 'rota-ausente') { avisoRotaAusente(); b.disabled = false; prog.textContent = ''; return; }
        if (!/não encontrada/.test(err.message)) { alert(`Parou no ${feitos + 1}º: ${err.message}`); break; }
      }
      feitos++;
      pendencias = pendencias.filter(x => x.candidato_novo.id !== p.candidato_novo.id);
    }
    render();
  });
}

function render() {
  const lista = document.getElementById('pendencias');
  const comIndicio = new Set(pendencias.filter(temIndicio).map(p => p.candidato_novo.id));
  // primeiro os pares com indício (prováveis duplicados), depois o resto; mais antigos antes
  const visiveis = pendencias
    .filter(p => temIndicio(p) || !comIndicio.has(p.candidato_novo.id))
    .sort((a, b) => (temIndicio(b) - temIndicio(a)) || comparar(a.criado_em, b.criado_em, 'asc'));
  lista.replaceChildren(...visiveis.map(renderPendencia));
  const n = new Set(pendencias.map(p => p.candidato_novo.id)).size;
  document.getElementById('resumo').textContent = n
    ? `${plural(n, 'concurso esperando decisão', 'concursos esperando decisão')} · ${plural(pendencias.filter(temIndicio).length, 'par com indício de duplicado', 'pares com indício de duplicado')}`
    : '';
  document.getElementById('vazio').hidden = pendencias.length > 0;
  renderLote();
}

async function carregar() {
  avisar('');
  document.getElementById('resumo').textContent = 'Carregando pendências…';
  try {
    const res = await fetch(REVISAO_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Worker respondeu ${res.status}`);
    pendencias = await res.json();
  } catch (err) {
    console.error(err);
    avisar('Não foi possível carregar a fila de revisão agora. Tente de novo em instantes.');
    pendencias = [];
  }
  // pares repetidos (mesma chave) vêm uma vez só
  pendencias = [...new Map(pendencias.map(p => [chaveDe(p), p])).values()];
  render();
}

document.getElementById('recarregar').addEventListener('click', carregar);
carregar();
