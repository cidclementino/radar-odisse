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

O endereço do Worker fica numa constante só, `WORKER`, em `js/comum.js`. Os arquivos
`data/*.sample.json` servem de exemplo do formato dos dados.

## Interface

- **Revisão (`revisao.html`):** a fila de pares parecidos que a coleta não juntou sozinha. Para cada
  par: juntar (escolhendo, nos campos diferentes, se fica o valor novo), incluir o novo como concurso
  próprio ou incluir já arquivado. Usa `POST /api/revisao/resolver` no Worker. Quem foi juntado fica
  em `ids_fundidos` e a coleta seguinte já o reconhece, sem voltar para a fila.

- **Marca e Universo:** as páginas usam `marca.odisse.com.br/v1/marca.css` (cores, Inter) e
  `universo.odisse.com.br/base/v1/universo.css` (botões, campos, tabela, etiquetas), com a mesma
  barra das outras ferramentas internas (selo, logotipo, "Radar", seções e o menu "Universo" de
  `base/v1/barra.js`). Estilos próprios em `css/styles.css`.
- **Cartões ou lista:** cada página tem as duas vistas, com os mesmos filtros. A lista é uma tabela
  ordenável (clique no cabeçalho). Vista, filtros e ordem ficam lembrados no navegador; a busca não.
  - Concursos: situação, prazo de inscrição (até 15 / 16–45 / mais de 45 dias / sem data), escopo,
    abrangência, inscrição gratuita ou paga e fonte.
  - Oportunidades: situação, nível, persona, cidade, fonte e período da coleta.
  - Corretores: nível, região de atuação, fonte da descoberta e CRECI.
- **Cache:** os dados ficam guardados no `localStorage` (`radar:dados:*`). A página desenha na hora a
  cópia guardada e só consulta o Worker se ela tiver mais de 15 minutos (`CACHE_FRESCO_MS`). O botão
  **Recarregar** força a busca. Arquivar, restaurar, renomear e apagar atualizam a cópia na hora.
  Além de abrir mais rápido, isso poupa a cota diária de leituras do KV da conta da Cloudflare (cada
  carregamento lê todas as chaves de um namespace).

## Publicando o Worker

O workflow `worker.yml` publica `worker/` sozinho a cada mudança no `main` (Worker `radar-odisse`).
Precisa dos secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts e Workers KV Storage: Edit) e
`CLOUDFLARE_ACCOUNT_ID` neste repositório. O passo a passo manual abaixo continua valendo.


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
