// Coleta da aba Licitações (PNCP) e envio ao Worker. Usado pelo GitHub Actions
// (.github/workflows/collect-licitacoes.yml); roda também localmente:
//   WORKER_URL=… COLLECT_SECRET=… node scripts/collect-licitacoes-and-send.js

// Duas leituras do PNCP: licitações de projeto com propostas abertas e contratos de obra assinados
// (a construtora vencedora como pista). Uma falhar não impede a outra.
const pncp = require('../parsers/pncp');
const contratos = require('../parsers/pncp-contratos');

async function main() {
  const { WORKER_URL, COLLECT_SECRET } = process.env;
  if (!WORKER_URL || !COLLECT_SECRET) {
    console.error('Faltam variáveis de ambiente: WORKER_URL e/ou COLLECT_SECRET');
    process.exit(1);
  }

  const licitacoes = [];
  for (const [nome, parser] of [['abertas', pncp], ['contratadas', contratos]]) {
    try {
      const itens = await parser.parse();
      console.log(`${nome}: ${itens.length}`);
      licitacoes.push(...itens);
    } catch (err) {
      console.error(`${nome} falhou:`, err.message);
    }
  }
  if (!licitacoes.length) console.log('Nada novo nesta rodada.');

  // Lotes de 50: o Worker faz até ~5 operações de KV por item e o plano gratuito aceita 1.000 por pedido.
  const LOTE = 50;
  const total = { recebidas: 0, novas: 0, alteradas: 0, iguais: 0, ignoradas: 0 };
  const chamar = async (caminho, corpo) => {
    const res = await fetch(`${WORKER_URL}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${COLLECT_SECRET}` },
      body: JSON.stringify(corpo),
    });
    if (!res.ok) throw new Error(`Worker recusou ${caminho}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  for (let i = 0; i < licitacoes.length; i += LOTE) {
    const r = await chamar('/api/collect-licitacoes', { licitacoes: licitacoes.slice(i, i + LOTE) });
    for (const k of Object.keys(total)) total[k] += r[k] || 0;
    await new Promise(ok => setTimeout(ok, 1100)); // a cópia da lista aceita 1 gravação por segundo
  }
  console.log('Resultado:', total);

  // Limpeza: abertas encerradas há mais de 60 dias, contratadas descartadas ou com mais de 6 meses.
  try {
    console.log('Limpeza:', await chamar('/api/manutencao/limpar-licitacoes', {}));
  } catch (err) {
    console.error('Limpeza falhou (a coleta foi gravada):', err.message);
  }
}

main().catch(err => {
  console.error('Erro fatal na coleta de Licitações:', err);
  process.exit(1);
});
