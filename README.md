# Radar Odisse

Painel interno com duas abas: **Concursos** (editais de arquitetura/design) e
**Terrenos** (oportunidades de terrenista e corretor) — estático, sem custo de
infraestrutura pesada, no mesmo espírito do `odisse-orcamentos`.

As decisões de produto e a lógica de dedup/interface estão documentadas em
detalhe em [`RADAR.md`](./RADAR.md) (Concursos) e [`TERRENOS.md`](./TERRENOS.md)
(Terrenos) — vale ler antes de mexer no código.

## Arquitetura

```
├── index.html, terrenos.html, css/, js/  → front-end estático (GitHub Pages)
├── data/                                 → dados de exemplo pro front-end (mock)
├── parsers/                              → um arquivo por fonte
│   ├── lib/normalize.js                   → normalização, similaridade, hash, datas
│   ├── lib/keywords-terrenista.js         → keywords + heurística de nível (Terrenos)
│   ├── concursosdeprojeto.js              → Concursos
│   ├── olx.js, zap.js, youtube.js         → Terrenos
│   ├── index.js                           → registro de parsers de Concursos
│   └── index-terrenos.js                  → registro de parsers de Terrenos
├── scripts/
│   ├── collect-and-send.js                → orquestrador Concursos
│   └── collect-terrenos-and-send.js       → orquestrador Terrenos
├── worker/                                → Cloudflare Worker (API + dedup + KV)
│   ├── index.js                            → rotas HTTP (Concursos + Terrenos)
│   ├── dedup.js                            → fusão de Concurso (ver RADAR.md)
│   ├── dedup-terrenos.js                   → fusão de Corretor (ver TERRENOS.md)
│   └── wrangler.toml                       → config de deploy
└── .github/workflows/
    ├── collect.yml                         → cron semanal (Concursos)
    └── collect-terrenos.yml                → cron diário, dias úteis (Terrenos)
```

## Rodando localmente

```bash
npm install

# Testar um parser isoladamente (imprime o JSON coletado no terminal)
node parsers/concursosdeprojeto.js
node parsers/olx.js
node parsers/zap.js
node parsers/youtube.js   # precisa de YOUTUBE_API_KEY no ambiente

# Servir o front-end com dados de exemplo
npx serve .   # abre index.html (Concursos) ou terrenos.html
```

`index.html` lê `data/concursos.sample.json`; `terrenos.html` lê
`data/oportunidades.sample.json` e `data/corretores.sample.json`. Pra conectar
no Worker de verdade, troque as URLs em `js/app.js` e `js/terrenos.js` pelos
endpoints publicados.

## Publicando o Worker

```bash
cd worker
npx wrangler kv namespace create CONCURSOS
npx wrangler kv namespace create REVISAO
npx wrangler kv namespace create OPORTUNIDADES
npx wrangler kv namespace create CORRETORES
# copie os 4 ids retornados pro wrangler.toml

npx wrangler secret put COLLECT_SECRET
npx wrangler deploy
```

## Configurando o GitHub Actions

Em Settings → Secrets and variables → Actions, adicione:

- `RADAR_WORKER_URL` — URL do Worker publicado
- `RADAR_COLLECT_SECRET` — o mesmo valor definido em `wrangler secret put`
- `YOUTUBE_API_KEY` — chave da YouTube Data API v3 (Google Cloud Console),
  só usada pelo workflow de Terrenos

Concursos roda semanalmente (segunda, 08:00 UTC); Terrenos roda diariamente
em dias úteis (09:00 UTC), pra acompanhar a rotação de região do YouTube.
Ambos também têm `workflow_dispatch` (rodar manualmente pela aba Actions).

## Próxima rodada (não implementado ainda)

**Concursos:**
- Parsers de `iab.org.br`, `competitions.archi`, `archdaily.com`,
  `espacodearquitetura.com`.
- Login com senha (SHA-256 + localStorage, mesmo padrão do `odisse-orcamentos`).
- Interface pra resolver a fila de `REVISAO`.
- Botões de ação nos cards (marcar como inscrito/descartado).

**Terrenos:**
- Validar parsers de OLX/ZAP contra HTML real (ver ressalva em `TERRENOS.md`).
- Criar a chave da YouTube Data API v3.
- Decidir fontes de "sites especializados".
- Botões de ação nos cards de Oportunidade.
