// Coleta da aba Licitações (PNCP) e envio ao Worker. Usado pelo GitHub Actions
// (.github/workflows/collect-licitacoes.yml); roda também localmente:
//   WORKER_URL=… COLLECT_SECRET=… node scripts/collect-licitacoes-and-send.js

// Duas leituras do PNCP: licitações de projeto com propostas abertas e contratos de obra assinados
// (a construtora vencedora como pista). Uma falhar não impede a outra.
const pncp = require('../parsers/pncp');
const contratos = require('../parsers/pncp-contratos');
const { completarDocumentos } = require('../parsers/pncp-documentos');

// Contratos só de projeto já guardados que não passam mais no filtro atual (o filtro foi apertado
// depois da primeira carga): viram "descartado", que a limpeza apaga. Só os que ninguém mexeu.
async function revisarProjetosGuardados(guardadas) {
  const { classificarContratoProjeto } = require('../parsers/lib/contratos');
  const hoje = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const l of guardadas) {
    if (l.fase !== 'contratada' || l.tipo_objeto !== 'projeto' || l.status_interno !== 'monitorando' || l.observacoes) continue;
    if (classificarContratoProjeto({ objetoContrato: l.objeto, valorGlobal: (l.valor_global || 0) / 100, tipoContrato: { nome: 'Contrato' } })) continue;
    const r = await fetch(`${WORKER_URL}/api/licitacoes/${encodeURIComponent(l.id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${COLLECT_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status_interno: 'descartado', observacoes: `Fora do filtro de contratos só de projeto (revisto em ${hoje}).` }),
    });
    if (r.ok) n++;
  }
  if (n) console.log(`${n} contratos só de projeto guardados saíram no filtro revisto (descartados).`);
}

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

  // Links do contrato e do termo de referência (e, nos contratos só de projeto, a leitura do TR):
  // só para o que ainda não tem documentos no Radar.
  try {
    const res = await fetch(`${WORKER_URL}/api/licitacoes`, { headers: { Authorization: `Bearer ${COLLECT_SECRET}` } });
    const guardadas = res.ok ? await res.json() : [];
    // O TR que não abriu por erro do leitor (não do arquivo) é lido de novo.
    const releitura = l => /^não abriu/.test(l.tr?.erro || '');
    const prontos = new Set(guardadas.filter(l => l.documentos && !releitura(l)).map(l => l.id));
    await completarDocumentos(licitacoes, prontos);
    await revisarProjetosGuardados(guardadas);
  } catch (err) {
    console.error('Documentos falharam (a coleta segue sem eles):', err.message);
  }

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
