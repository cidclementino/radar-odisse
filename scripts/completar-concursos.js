// Radar Odisse — completa os concursos a partir dos sites oficiais (roda depois da coleta semanal)
//
// 1. Pede ao Worker para consertar as datas que dá para reler de `texto_bruto` (sem rede).
// 2. Para concursos sem banner ou sem prazo, lê o site oficial (e até 3 páginas relacionadas do
//    mesmo site) com js/extrair-site.js e preenche só o que está vazio. Cada concurso é tentado
//    no máximo uma vez a cada 30 dias (`completado_em`).
// 3. Para os concursos em acompanhamento (ou inscritos), relê o site toda semana e guarda o
//    resultado completo em `acompanhamento`, que a página Acompanhamento mostra.
//
// Variáveis: WORKER_URL, COLLECT_SECRET (as mesmas da coleta).

const { extrairSite, juntar, palpites } = require('../js/extrair-site.js');

const { WORKER_URL, COLLECT_SECRET } = process.env;
const LIMITE_POR_RODADA = 40;
const DIAS_ENTRE_TENTATIVAS = 30;
const DIAS_ENTRE_LEITURAS_ACOMPANHAMENTO = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const dias = n => n * 86400000;
const antigo = (iso, n) => !iso || Date.now() - new Date(iso).getTime() > dias(n);
const autorizacao = { Authorization: `Bearer ${COLLECT_SECRET}`, 'Content-Type': 'application/json' };

async function baixar(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error(`o site respondeu ${res.status}`);
    const tipo = res.headers.get('content-type') || '';
    if (!/html|xml/i.test(tipo)) throw new Error(`o endereço não é uma página (${tipo || 'sem tipo'})`);
    return { html: await res.text(), url: res.url };
  } finally {
    clearTimeout(t);
  }
}

/** lê o site oficial e as páginas relacionadas; devolve { site, erro } */
async function lerSite(link) {
  try {
    const { html, url } = await baixar(link);
    const principal = extrairSite(html, url);
    const outras = [];
    for (const rel of (principal.relacionadas || []).slice(0, 3)) {
      try {
        const p = await baixar(rel);
        outras.push(extrairSite(p.html, p.url));
      } catch { /* página relacionada que não abre não impede o resto */ }
    }
    return { site: juntar([principal, ...outras]), erro: null };
  } catch (err) {
    return { site: null, erro: err.name === 'AbortError' ? 'o site demorou demais para responder' : err.message };
  }
}

async function main() {
  if (!WORKER_URL || !COLLECT_SECRET) {
    console.error('Faltam WORKER_URL e/ou COLLECT_SECRET.');
    process.exit(1);
  }

  const reparo = await fetch(`${WORKER_URL}/api/manutencao/reparar`, { method: 'POST', headers: autorizacao }).then(r => r.json());
  console.log('Datas consertadas a partir do texto da fonte:', reparo);

  const concursos = await fetch(`${WORKER_URL}/api/concursos`).then(r => r.json());
  const hoje = new Date().toISOString().slice(0, 10);
  const aberto = c => !c.datas?.inscricao_fim || c.datas.inscricao_fim >= hoje;

  const acompanhados = concursos.filter(c => ['acompanhando', 'inscrito'].includes(c.status_interno)
    && c.link_oficial && antigo(c.acompanhamento?.lido_em, DIAS_ENTRE_LEITURAS_ACOMPANHAMENTO));
  const incompletos = concursos.filter(c => c.status_interno !== 'descartado' && !acompanhados.includes(c)
    && (c.link_oficial || c.fonte_url_original) && aberto(c) && (!c.imagem_url || !c.datas?.inscricao_fim || !c.datas?.entrega_fim)
    && antigo(c.completado_em, DIAS_ENTRE_TENTATIVAS));
  const fila = [...acompanhados, ...incompletos].slice(0, LIMITE_POR_RODADA);
  console.log(`${acompanhados.length} em acompanhamento para reler, ${incompletos.length} incompletos; lendo ${fila.length} sites.`);

  const itens = [];
  for (const c of fila) {
    // sem site oficial, a própria publicação na fonte (ex.: notícia do IAB) costuma ter os prazos
    const { site, erro } = await lerSite(c.link_oficial || c.fonte_url_original);
    const p = palpites(site);
    const item = { id: c.id, campos: { imagem_url: p.imagem_url, inscricao_fim: p.inscricao_fim, entrega_fim: p.entrega_fim, resultado_previsto: p.resultado_previsto } };
    if (acompanhados.includes(c)) item.acompanhamento = { ...(c.acompanhamento || {}), site, erro, lido_em: new Date().toISOString() };
    itens.push(item);
    const achou = Object.entries(item.campos).filter(([, v]) => v).map(([k]) => k).join(', ');
    console.log(`- ${(c.apelido || c.nome).slice(0, 60)}: ${erro ? `erro (${erro})` : (achou || 'nada novo')}`);
  }

  for (let i = 0; i < itens.length; i += 10) {
    const r = await fetch(`${WORKER_URL}/api/manutencao/completar`, {
      method: 'POST', headers: autorizacao, body: JSON.stringify({ itens: itens.slice(i, i + 10) }),
    }).then(x => x.json());
    console.log('Gravado no Worker:', r);
  }
}

main().catch(err => {
  console.error('Falha ao completar concursos:', err);
  process.exit(1);
});
