// Coleta da aba Licitações (PNCP) e envio ao Worker. Usado pelo GitHub Actions
// (.github/workflows/collect-licitacoes.yml); roda também localmente:
//   WORKER_URL=… COLLECT_SECRET=… node scripts/collect-licitacoes-and-send.js

const pncp = require('../parsers/pncp');

async function main() {
  const { WORKER_URL, COLLECT_SECRET } = process.env;
  if (!WORKER_URL || !COLLECT_SECRET) {
    console.error('Faltam variáveis de ambiente: WORKER_URL e/ou COLLECT_SECRET');
    process.exit(1);
  }

  const licitacoes = await pncp.parse();
  if (!licitacoes.length) {
    console.log('Nenhuma licitação de projeto nesta rodada — nada a enviar.');
    return;
  }

  const res = await fetch(`${WORKER_URL}/api/collect-licitacoes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${COLLECT_SECRET}` },
    body: JSON.stringify({ licitacoes }),
  });
  if (!res.ok) {
    console.error('Worker recusou a coleta:', res.status, await res.text());
    process.exit(1);
  }
  console.log('Resultado:', await res.json());
}

main().catch(err => {
  console.error('Erro fatal na coleta de Licitações:', err);
  process.exit(1);
});
