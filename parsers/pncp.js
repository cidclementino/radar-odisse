// Parser: PNCP (Portal Nacional de Contratações Públicas) — aba Licitações
//
// API pública de consulta, sem chave: contratações com recebimento de propostas em aberto
// (GET /v1/contratacoes/proposta), uma consulta por UF × modalidade, paginada.
// O filtro do que é "contratação de projeto" está em parsers/lib/licitacoes.js. Ver LICITACOES.md.

const { paraLicitacao, FONTE } = require('./lib/licitacoes');

const API = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';

// Mesma geografia de Terrenos. Uma linha para ampliar.
const UFS = ['PB', 'PE', 'RN'];

// Modalidades em que um projeto de arquitetura costuma ser contratado.
// 2 Diálogo competitivo · 3 Concurso · 4/5 Concorrência · 6/7 Pregão · 8 Dispensa
// (pregão para projeto contraria a Lei 14.133, art. 29, mas acontece; dispensa cobre projetos pequenos)
const MODALIDADES = [2, 3, 4, 5, 6, 7, 8];

const TAMANHO_PAGINA = 50;
const MAX_PAGINAS = 60; // trava de segurança por consulta
const ESPERA_MS = 250; // entre chamadas, para não martelar a API

const dormir = ms => new Promise(r => setTimeout(r, ms));

function aaaammdd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function buscarPagina(uf, modalidade, pagina, dataFinal) {
  const params = new URLSearchParams({
    dataFinal, codigoModalidadeContratacao: String(modalidade), uf, pagina: String(pagina), tamanhoPagina: String(TAMANHO_PAGINA),
  });
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json', 'User-Agent': 'radar.odisse.com.br (Odisse, Estúdio de Arquitetura e Design)' } });
    if (res.status === 204) return { data: [], totalPaginas: 0 };
    if (res.ok) return res.json();
    if (tentativa === 3 || res.status < 500) throw new Error(`PNCP respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await dormir(1500 * tentativa);
  }
}

async function parse() {
  // A consulta pede uma data final: pega tudo que ainda recebe proposta no próximo ano.
  const dataFinal = aaaammdd(new Date(Date.now() + 365 * 86400000));
  const agora = new Date().toISOString();
  const porId = new Map();
  let lidos = 0;

  for (const uf of UFS) {
    for (const modalidade of MODALIDADES) {
      let pagina = 1;
      let total = 1;
      let lidosAqui = 0;
      let aceitos = 0;
      try {
        do {
          const r = await buscarPagina(uf, modalidade, pagina, dataFinal);
          total = Math.min(r.totalPaginas || 0, MAX_PAGINAS);
          for (const item of r.data || []) {
            lidosAqui++;
            const l = paraLicitacao(item, agora);
            if (l && !porId.has(l.id)) { porId.set(l.id, l); aceitos++; }
          }
          pagina++;
          await dormir(ESPERA_MS);
        } while (pagina <= total);
        console.log(`[${FONTE}] ${uf} · modalidade ${modalidade}: ${lidosAqui} em aberto, ${aceitos} de projeto`);
      } catch (err) {
        console.error(`[${FONTE}] ${uf} · modalidade ${modalidade} falhou na página ${pagina}:`, err.message);
      }
      lidos += lidosAqui;
    }
  }

  console.log(`[${FONTE}] ${lidos} contratações lidas, ${porId.size} de projeto`);
  return [...porId.values()];
}

module.exports = { parse, FONTE };

if (require.main === module) {
  parse()
    .then(r => {
      for (const l of r) console.log(`- ${l.uf} ${l.municipio} · ${l.modalidade} · fim ${l.encerramento} · [${l.tipo_objeto}; ${l.escopo.join(', ')}] ${l.objeto?.slice(0, 160)}`);
      console.log(JSON.stringify(r.slice(0, 3), null, 2));
    })
    .catch(err => { console.error('Erro ao coletar o PNCP:', err.message); process.exit(1); });
}
