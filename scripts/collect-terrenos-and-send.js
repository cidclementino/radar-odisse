// Roda todos os parsers de Terrenos (OLX, ZAP, YouTube) e envia o resultado
// combinado pro Worker. Usado pelo GitHub Actions
// (.github/workflows/collect-terrenos.yml), mas também roda localmente:
// node scripts/collect-terrenos-and-send.js
//
// Variáveis de ambiente esperadas:
//   WORKER_URL       -> ex: https://radar-odisse-worker.<subdomain>.workers.dev
//   COLLECT_SECRET   -> mesmo valor configurado no Worker
//   YOUTUBE_API_KEY  -> chave da YouTube Data API v3 (só o parser do YouTube usa)

const parsers = require('../parsers/index-terrenos');

async function main() {
  const { WORKER_URL, COLLECT_SECRET } = process.env;
  if (!WORKER_URL || !COLLECT_SECRET) {
    console.error('Faltam variáveis de ambiente: WORKER_URL e/ou COLLECT_SECRET');
    process.exit(1);
  }

  const oportunidades = [];
  const corretoresCandidatos = [];

  for (const parser of parsers) {
    try {
      const resultado = await parser.parse();
      // OLX retorna array direto (só oportunidades); ZAP/YouTube retornam
      // { oportunidades, corretoresCandidatos }.
      if (Array.isArray(resultado)) {
        oportunidades.push(...resultado);
      } else {
        oportunidades.push(...(resultado.oportunidades || []));
        corretoresCandidatos.push(...(resultado.corretoresCandidatos || []));
      }
      console.log(`[${parser.FONTE}] coletado com sucesso`);
    } catch (err) {
      console.error(`[${parser.FONTE}] falhou:`, err.message);
    }
  }

  if (oportunidades.length === 0 && corretoresCandidatos.length === 0) {
    console.log('Nenhum item coletado nesta rodada — nada a enviar.');
    return;
  }

  const res = await fetch(`${WORKER_URL}/api/collect-terrenos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${COLLECT_SECRET}`,
    },
    body: JSON.stringify({ oportunidades, corretoresCandidatos }),
  });

  if (!res.ok) {
    console.error('Worker recusou a coleta:', res.status, await res.text());
    process.exit(1);
  }

  console.log('Resultado:', await res.json());
}

main().catch(err => {
  console.error('Erro fatal na coleta de Terrenos:', err);
  process.exit(1);
});
