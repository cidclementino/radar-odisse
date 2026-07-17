// Roda todos os parsers registrados e envia o resultado combinado pro Worker.
// Usado pelo GitHub Actions (.github/workflows/collect.yml), mas também pode
// ser rodado localmente pra depuração: node scripts/collect-and-send.js
//
// Variáveis de ambiente esperadas:
//   WORKER_URL       -> ex: https://radar-odisse-worker.<subdomain>.workers.dev
//   COLLECT_SECRET   -> mesmo valor configurado no Worker (env COLLECT_SECRET)

const parsers = require('../parsers');

/**
 * Busca os ids de Concurso que o Worker já conhece — permite que um parser
 * (ex: competitionsarchi.js) pule o fetch de detalhe de itens já cadastrados
 * em vez de reprocessar tudo a cada rodada. Rota pública (GET /api/concursos,
 * ver worker/index.js), não precisa de COLLECT_SECRET.
 *
 * Falha aqui não é fatal — se o Worker estiver fora do ar, os parsers que
 * usam o parâmetro simplesmente rodam sem a otimização (Set vazio).
 */
async function buscarIdsConhecidos(workerUrl) {
  try {
    const res = await fetch(`${workerUrl}/api/concursos`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const existentes = await res.json();
    return new Set(existentes.map(c => c.id));
  } catch (err) {
    console.error('Não foi possível buscar ids conhecidos do Worker — seguindo sem otimização de skip:', err.message);
    return new Set();
  }
}

async function main() {
  const { WORKER_URL, COLLECT_SECRET } = process.env;
  if (!WORKER_URL || !COLLECT_SECRET) {
    console.error('Faltam variáveis de ambiente: WORKER_URL e/ou COLLECT_SECRET');
    process.exit(1);
  }

  const idsConhecidos = await buscarIdsConhecidos(WORKER_URL);
  console.log(`${idsConhecidos.size} concurso(s) já conhecido(s) pelo Worker.`);

  const candidatos = [];

  for (const parser of parsers) {
    try {
      // Parsers que não usam o parâmetro (ex: concursosdeprojeto.js, que é
      // RSS puro e não tem essa otimização) simplesmente o ignoram.
      const itens = await parser.parse(idsConhecidos);
      console.log(`[${parser.FONTE}] ${itens.length} itens coletados`);
      candidatos.push(...itens);
    } catch (err) {
      // Uma fonte falhando (ex: bloqueio anti-bot, mudança de layout) não deve
      // derrubar a coleta das outras fontes.
      console.error(`[${parser.FONTE}] falhou:`, err.message);
    }
  }

  if (candidatos.length === 0) {
    console.log('Nenhum item coletado nesta rodada — nada a enviar.');
    return;
  }

  const res = await fetch(`${WORKER_URL}/api/collect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${COLLECT_SECRET}`,
    },
    body: JSON.stringify(candidatos),
  });

  if (!res.ok) {
    console.error('Worker recusou a coleta:', res.status, await res.text());
    process.exit(1);
  }

  const resultado = await res.json();
  console.log('Resultado:', resultado);
}

main().catch(err => {
  console.error('Erro fatal na coleta:', err);
  process.exit(1);
});
