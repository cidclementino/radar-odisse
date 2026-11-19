// Parser: PNCP — contratos assinados de obra (aba Licitações › Contratadas). Ver LICITACOES.md.
//
// GET /v1/contratos (contratos publicados num intervalo de datas). A API não filtra por UF nem por
// categoria: lê o país inteiro no intervalo e filtra aqui (parsers/lib/contratos.js).

const API = 'https://pncp.gov.br/api/consulta/v1/contratos';
const FONTE = 'pncp.gov.br';

const TAMANHO_PAGINA = 500;
const ESPERA_MS = 1500;
const dormir = ms => new Promise(r => setTimeout(r, ms));
const aaaammdd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

async function buscarPagina(dataInicial, dataFinal, pagina) {
  const params = new URLSearchParams({ dataInicial, dataFinal, pagina: String(pagina), tamanhoPagina: String(TAMANHO_PAGINA) });
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json', 'User-Agent': 'radar.odisse.com.br (Odisse, Estúdio de Arquitetura e Design)' } });
    if (res.status === 204) return { data: [], totalPaginas: 0, totalRegistros: 0 };
    if (res.ok) return res.json();
    if (tentativa === 5 || !(res.status === 429 || res.status >= 500)) throw new Error(`PNCP respondeu ${res.status}: ${(await res.text()).slice(0, 120).replace(/\s+/g, ' ')}`);
    const pedido = Number(res.headers.get('retry-after'));
    await dormir(Number.isFinite(pedido) && pedido > 0 ? pedido * 1000 : 15000 * tentativa);
  }
}

async function sondar() {
  const ontem = aaaammdd(new Date(Date.now() - 86400000));
  const r = await buscarPagina(ontem, ontem, 1);
  console.log('um dia:', ontem, 'totalRegistros', r.totalRegistros, 'totalPaginas', r.totalPaginas, 'chaves', Object.keys(r));
  const d = r.data || [];
  const ufs = {}; const cats = {}; const tipos = {};
  for (const c of d) { ufs[c.unidadeOrgao?.ufSigla] = (ufs[c.unidadeOrgao?.ufSigla] || 0) + 1; cats[c.categoriaProcesso?.nome] = (cats[c.categoriaProcesso?.nome] || 0) + 1; tipos[c.tipoContrato?.nome] = (tipos[c.tipoContrato?.nome] || 0) + 1; }
  console.log('página 1 — UFs', JSON.stringify(ufs), '\ncategorias', JSON.stringify(cats), '\ntipos', JSON.stringify(tipos));
  const obras = d.filter(c => [7, 9].includes(c.categoriaProcesso?.id) && ['PB', 'PE', 'RN'].includes(c.unidadeOrgao?.ufSigla));
  for (const c of obras.slice(0, 15)) console.log('-', c.unidadeOrgao?.ufSigla, c.categoriaProcesso?.nome, '|', c.nomeRazaoSocialFornecedor, '|', c.valorGlobal, '|', (c.objetoContrato || '').slice(0, 150));
  console.log(JSON.stringify(d[0], null, 1));
}

module.exports = { FONTE, buscarPagina };
if (require.main === module) sondar().catch(e => { console.error(e.message); process.exit(1); });
