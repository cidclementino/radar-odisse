// Parser: PNCP — contratos de obra assinados (aba Licitações › Contratadas). Ver LICITACOES.md.
//
// GET /v1/contratos (contratos publicados num intervalo de datas). A API não filtra por UF nem por
// categoria: lê o país inteiro no intervalo (~4.500 contratos por dia, 10 páginas de 500, sondagem
// de 18/11/2026) e filtra aqui (parsers/lib/contratos.js). Depois busca o contato público de cada
// construtora vencedora pelo CNPJ (BrasilAPI, base da Receita Federal).
//
// Janela: CONTRATOS_DIAS (padrão 3, cobrindo fim de semana e falha de um dia). Disparo manual pode
// pedir mais (ex.: 60) para trazer o passado recente na primeira vez.

const { paraContratada, contatoDaReceita } = require('./lib/contratos');

const API = 'https://pncp.gov.br/api/consulta/v1/contratos';
const FONTE = 'pncp.gov.br';
const DIAS = Math.min(Math.max(Number(process.env.CONTRATOS_DIAS) || 3, 1), 120);

const TAMANHO_PAGINA = 500;
const ESPERA_MS = 1500;
const UA = 'radar.odisse.com.br (Odisse, Estúdio de Arquitetura e Design)';
const dormir = ms => new Promise(r => setTimeout(r, ms));
const aaaammdd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

async function buscarPagina(dataInicial, dataFinal, pagina) {
  const params = new URLSearchParams({ dataInicial, dataFinal, pagina: String(pagina), tamanhoPagina: String(TAMANHO_PAGINA) });
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (res.status === 204) return { data: [], totalPaginas: 0 };
    if (res.ok) return res.json();
    if (tentativa === 5 || !(res.status === 429 || res.status >= 500)) throw new Error(`PNCP respondeu ${res.status}: ${(await res.text()).slice(0, 120).replace(/\s+/g, ' ')}`);
    const pedido = Number(res.headers.get('retry-after'));
    await dormir(Number.isFinite(pedido) && pedido > 0 ? pedido * 1000 : 15000 * tentativa);
  }
}

async function contatoPorCnpj(cnpj) {
  if (!/^\d{14}$/.test(cnpj || '')) return null;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return contatoDaReceita(await res.json());
  } catch { return null; }
}

async function parse() {
  const agora = new Date().toISOString();
  const porId = new Map();
  let lidos = 0;
  // Um dia por vez: falha de um dia não derruba os outros, e cada consulta fica pequena.
  for (let i = DIAS; i >= 1; i--) {
    const dia = aaaammdd(new Date(Date.now() - i * 86400000));
    let pagina = 1;
    let total = 1;
    try {
      do {
        const r = await buscarPagina(dia, dia, pagina);
        total = r.totalPaginas || 0;
        for (const c of r.data || []) {
          lidos++;
          const item = paraContratada(c, agora);
          if (item) porId.set(item.id, item);
        }
        pagina++;
        await dormir(ESPERA_MS);
      } while (pagina <= total);
    } catch (err) {
      console.error(`[${FONTE}] contratos de ${dia} falharam na página ${pagina}:`, err.message);
    }
  }

  // Contato público de cada construtora (uma consulta por CNPJ)
  const contatos = new Map();
  for (const item of porId.values()) {
    const cnpj = item.vencedor.cnpj;
    if (!contatos.has(cnpj)) { contatos.set(cnpj, await contatoPorCnpj(cnpj)); await dormir(400); }
    item.vencedor = { ...item.vencedor, ...(contatos.get(cnpj) || {}) };
  }

  console.log(`[${FONTE}] ${DIAS} dia(s): ${lidos} contratos lidos, ${porId.size} obras de interesse em PB/PE/RN`);
  return [...porId.values()];
}

module.exports = { parse, FONTE };

if (require.main === module) {
  parse()
    .then(r => {
      for (const c of r) console.log(`- N${c.nivel} ${c.uf} ${c.municipio} · ${c.tipo_objeto} · R$ ${(c.valor_global / 100).toLocaleString('pt-BR')} · ${c.vencedor.nome} (${(c.vencedor.telefones || []).join(', ')} ${c.vencedor.email || ''}) · ${c.objeto?.slice(0, 140)}`);
    })
    .catch(err => { console.error('Erro ao coletar contratos do PNCP:', err.message); process.exit(1); });
}
