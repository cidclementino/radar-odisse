# Radar Odisse

Painel interno de monitoramento de concursos e editais de arquitetura,
urbanismo, paisagismo e design de produto/mobiliário — estático, sem custo de
infraestrutura pesada, no mesmo espírito do `odisse-orcamentos`.

As decisões de produto e a lógica de dedup/interface estão documentadas em
detalhe em [`RADAR.md`](./RADAR.md) — vale ler antes de mexer no código.

## Arquitetura

```
├── index.html, css/, js/       → front-end estático (GitHub Pages)
├── data/concursos.sample.json  → dados de exemplo pro front-end (mock)
├── parsers/                    → um arquivo por fonte, todos retornam Concurso[]
│   ├── lib/normalize.js        → normalização de texto, similaridade, hash de id
│   ├── concursosdeprojeto.js   → implementado nesta rodada
│   └── index.js                → registro de todos os parsers
├── scripts/collect-and-send.js → roda todos os parsers, envia pro Worker
├── worker/                     → Cloudflare Worker (API + dedup + KV)
│   ├── index.js                 → rotas HTTP
│   ├── dedup.js                 → regra de fusão (ver RADAR.md)
│   └── wrangler.toml             → config de deploy
└── .github/workflows/collect.yml → cron semanal
```

## Rodando localmente

```bash
npm install

# Testar um parser isoladamente (imprime o JSON coletado no terminal)
node parsers/concursosdeprojeto.js

# Servir o front-end com dados de exemplo
npx serve .   # ou qualquer servidor estático — abre index.html
```

O `index.html` lê `data/concursos.sample.json` por padrão. Pra conectar no
Worker de verdade, troque `DATA_URL` em `js/app.js` pela URL do Worker
publicado (`https://.../api/concursos`).

## Publicando o Worker

```bash
cd worker
npx wrangler kv namespace create CONCURSOS
npx wrangler kv namespace create REVISAO
# copie os ids retornados pro wrangler.toml

npx wrangler secret put COLLECT_SECRET   # gera/define o segredo compartilhado com o Actions
npx wrangler deploy
```

## Configurando o GitHub Actions

Em Settings → Secrets and variables → Actions, adicione:

- `RADAR_WORKER_URL` — URL do Worker publicado
- `RADAR_COLLECT_SECRET` — o mesmo valor definido em `wrangler secret put`

O workflow roda toda segunda-feira às 08:00 UTC, ou manualmente pela aba
Actions (`workflow_dispatch`).

## Próxima rodada (não implementado ainda)

- Parsers de `iab.org.br`, `competitions.archi`, `archdaily.com`,
  `espacodearquitetura.com` — seguir o contrato de
  `parsers/concursosdeprojeto.js` (exportar `{ parse, FONTE }`) e registrar em
  `parsers/index.js`.
- Login com senha (mesmo padrão do `odisse-orcamentos` — SHA-256 +
  localStorage).
- Interface pra resolver a fila de `REVISAO` (hoje só fica armazenada no KV,
  sem UI pra você decidir "mesmo concurso ou não" visualmente).
- Botões de ação nos cards (marcar como inscrito/descartado) — hoje o
  `status_interno` só é alterável diretamente no KV.
