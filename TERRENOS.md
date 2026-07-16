# Radar Odisse — Aba Terrenos: decisões fechadas

Consolidação da diretriz de brainstorm (`radar-odisse-diretriz-terrenos.md`) mais
as decisões tomadas na sessão de fechamento. Serve de referência para a
implementação — mesmo papel que `RADAR.md` cumpre para a aba Concursos.

## Escopo e critério de inclusão

O Radar deixou de ser só "monitor de concursos" — agora é um panorama de
oportunidades de serviço rastreáveis automaticamente. Critério duro: só entra
o que gera pista de trabalho real, não contexto genérico de mercado (por isso
mapeamento de concorrentes ficou fora, ver diretriz original seção 1).

Duas abas: **Concursos** (já implementada) e **Terrenos** (esta).

Geografia: não se limita à Paraíba. O serviço mira captação de trabalho de
maior porte (edifícios mistos/multifamiliares), então cobrir Recife e Natal
além da Grande João Pessoa e Campina Grande é intencional.

## Fontes — status final

| Fonte | Papel | Status |
|---|---|---|
| OLX | Terrenista (regex de keyword no título + filtro nativo "Particular") | Validada, pronta pra parser |
| ZAP Imóveis | Terrenista **e** enriquecimento de perfil de Corretor | Validada (sem bloqueio de bot), pronta pra parser |
| Viva Real | — | **Fora** — sem filtro de data confiável, sem alternativa até agora |
| YouTube (Data API v3) | Descoberta de Corretor, por busca de keyword + região | Especificada, falta criar a chave de API |
| CRECI-PB | Verificação manual apenas (nunca fonte de prospecção) | N/A — não automatizado |
| Sites especializados | — | Ainda em aberto, sem decisão |

### Achado sobre o ZAP (sessão de fechamento)

- Sem bloqueio de bot, estrutura Next.js/SSR limpa.
- **Não tem** filtro nativo de "aceita permuta" (confirmado — reclamação de
  usuário no Reclame Aqui, e a URL que sugeria esse filtro retorna 404).
- Resultados de terreno em João Pessoa são dominados por imobiliárias/corretores
  nomeados, não donos individuais — por isso o ZAP tem papel duplo: sinal de
  terrenista (mais fraco que OLX) **e** sinal de atividade de corretor (nome +
  empresa + volume de terrenos listados).
- Mesmo grupo econômico da OLX/Viva Real (Grupo OLX) — mesma ressalva de termos
  de uso a considerar na frequência/formato da coleta.

## Duas entidades, não uma

`Corretor` é tratado como entidade própria (não metadado dentro de uma
oportunidade), porque acumula sinal ao longo do tempo vindo de fontes
diferentes (YouTube, ZAP, e futuramente outras).

### `Oportunidade` — sinal bruto

```json
{
  "id": "olx-2026-a1b2c3",
  "persona": "terrenista",
  "fonte": "olx.com.br",
  "titulo": "PERMUTO terreno 500m² no Bessa por apartamento",
  "local": "Bessa, João Pessoa",
  "nivel_maturidade": 3,
  "corretor_vinculado_id": null,
  "link_original": "https://...",
  "texto_bruto": "...",
  "publicado_em": "2026-07-14",
  "coletado_em": "2026-07-15T08:00:00Z",
  "status_interno": "monitorando"
}
```

`persona`: `"terrenista"` | `"corretor"` (uma oportunidade tipo corretor é,
por exemplo, um vídeo do YouTube que sinaliza um corretor ativo numa região).

### `Corretor` — perfil acumulado

```json
{
  "id": "corretor-a1b2",
  "nome": "Ricardo Vieira",
  "empresa": "Escorel Corretora de Imóveis",
  "creci": null,
  "regioes_atuacao": ["João Pessoa"],
  "volume_zap": 4,
  "descoberto_via": ["zapimoveis.com.br"],
  "nivel_maturidade": 2,
  "oportunidades_vinculadas": ["olx-2026-a1b2c3"],
  "atualizado_em": "2026-07-15T08:00:00Z"
}
```

## Regra de fusão de Corretor — cadeia sequencial

Ao encontrar um corretor (via ZAP ou YouTube), tenta casar com um `Corretor`
já existente nesta ordem — a primeira que bater confirma a fusão, sem
verificar as seguintes:

1. **Nome** (normalizado, mesmo esquema de similaridade do dedup de Concurso)
2. Se nome não bater: **CRECI** (quando disponível em algum dos dois lados)
3. Se CRECI não disponível: **Empresa** (normalizado)

Se nenhuma das três bater, cria um `Corretor` novo.

**O ZAP pode criar um `Corretor` novo sozinho** (nome + empresa, sem precisar
que esse corretor já tenha aparecido no YouTube primeiro) — não há hierarquia
de "fonte principal" entre os dois vetores de descoberta de corretor.

## Escala de maturidade (aplicada a ambas as personas)

1. **Nível 1** — sinal de observação, sem processo confirmado. *Registrar, não abordar.*
2. **Nível 2** — sinal qualificado, parceiro possivelmente já decidido. *Abordagem cautelosa.*
3. **Nível 3** — sinal de processo aberto. *Prioridade de abordagem.*

O sistema classifica o nível — **não** sugere qual rota de abordagem usar
(corretor aprova/terrenista contrata vs. corretor contrata direto). Isso é
leitura manual na hora de abordar.

## Keywords de terrenista (regex sobre título normalizado)

Evitar "permuta" isolado (ruidoso — troca por carro, outro imóvel etc.):

```
permuta com construtora
permuta com incorporadora
aceito apartamento
aceito imovel
parceria para incorporacao
terreno para construtora
terreno para incorporadora
sociedade para construir
estudo de permuta
troco por apartamento
```

## YouTube — rotação de queries por dia/região

5 grupos, um por dia útil — isola falha de uma Action a um grupo, não ao
vetor inteiro. Consome no máximo 3 buscas/dia (cota de 100/dia sobra folgada).

| Dia | Grupo | Queries |
|---|---|---|
| Seg | RM João Pessoa (João Pessoa + Santa Rita + Bayeux) | "corretor terreno permuta João Pessoa", "terreno permuta Santa Rita PB", "terreno permuta Bayeux" |
| Ter | Litoral Norte (Cabedelo + Conde/Jacumã) | "corretor terreno permuta Cabedelo", "terreno permuta Conde PB", "terreno permuta Jacumã" |
| Qua | Campina Grande | "corretor terreno permuta Campina Grande" |
| Qui | Recife | "corretor terreno permuta Recife" |
| Sex | Natal | "corretor terreno permuta Natal RN" |

Cada busca usa `publishedAfter` (só vídeos novos desde a última coleta),
`regionCode=BR`, `relevanceLanguage=pt`, `type=video`. Filtro de keyword real
ainda necessário pós-busca (a busca do YouTube é semântica, não literal).

Watchlist de canais fixos foi descartada — busca por keyword é superior
(canal pode ficar inativo; criador novo com um único vídeo relevante não
seria capturado por watchlist).

## Vetores descartados (não reabrir sem motivo novo)

CNPJ/SPE (Receita Federal), Diário/Semanário Oficial de João Pessoa, imprensa
local (3 maiores portais PB), Sinduscon-PB, Índice CRECI 360º — motivos
detalhados na diretriz original, seção 4.

## Janela de frescor (OLX)

Anúncios da OLX com `publicado_em` mais antigo que a janela configurada são
descartados antes de virar `Oportunidade` — evita reabrir sinais já frios.
Valor atual: **30 dias**, deliberadamente frouxo pro levantamento inicial
(ver `JANELA_DIAS` em `parsers/olx.js`) — reduzir pra 7 dias depois de validar
o volume real de resultados. Anúncios sem timestamp extraído com sucesso não
são descartados por frescor (só por falta de dado, se for o caso).

ZAP não tem esse filtro — `publicado_em` é sempre `null` lá (sem timestamp
confiável por anúncio, ver seção de fontes acima). YouTube já tem seu próprio
corte de 7 dias via `publishedAfter`, independente deste.

## Status da implementação (primeira rodada)

- ✅ `terrenos.html` + `js/terrenos.js` — grid de Oportunidades + lista de Corretores
- ✅ Schema de `Oportunidade` e `Corretor` implementado
- ✅ Parser OLX (`parsers/olx.js`) — terrenista, filtro por keyword + selo "Direto com o proprietário"
- ✅ Parser ZAP (`parsers/zap.js`) — terrenista + candidato a Corretor (papel duplo)
- ✅ Parser YouTube (`parsers/youtube.js`) — rotação por dia da semana, filtro pós-busca
- ✅ `worker/dedup-terrenos.js` — cadeia de fusão nome → CRECI → empresa, testada
- ✅ Rotas do Worker: `GET /api/oportunidades`, `GET /api/corretores`, `POST /api/collect-terrenos`
- ✅ GitHub Actions diário (dias úteis) — `.github/workflows/collect-terrenos.yml`

### Ressalva importante: seletores de OLX/ZAP não testados ao vivo

Os parsers de OLX e ZAP fazem scraping de HTML (nenhuma das duas tem RSS).
Os seletores foram escritos a partir do padrão observado via pesquisa
(estrutura de links, texto de local/timestamp/selo de anunciante), validados
contra **fixtures construídos à mão** que reproduzem esse padrão — não contra
HTML bruto real, porque o ambiente onde este código foi escrito não tem
acesso de rede a esses domínios. A estratégia de extração (subir pelos
ancestrais da âncora até achar texto com preço/timestamp, em vez de depender
de nomes de classe CSS) foi escolhida por ser mais resiliente a mudanças de
markup, mas é bem provável que precise de ajuste fino assim que rodar contra
o HTML real pela primeira vez — comparar a saída de
`npm run parse:olx` / `npm run parse:zap` contra o que aparece no navegador.

## Pendências que restam

- [ ] Criar chave de API do YouTube Data API v3 (Google Cloud Console) e
      armazenar como GitHub Secret `YOUTUBE_API_KEY` — ação do Cid.
- [ ] Configurar `RADAR_WORKER_URL` e `RADAR_COLLECT_SECRET` nos secrets do
      Actions (mesmos já usados por Concursos, reaproveitados).
- [ ] Publicar os 2 namespaces de KV novos (`OPORTUNIDADES`, `CORRETORES`) —
      `wrangler kv namespace create OPORTUNIDADES` / `CORRETORES`.
- [ ] Validar os parsers de OLX/ZAP contra HTML real (ver ressalva acima) —
      rodar `npm run parse:olx` localmente e comparar contra o navegador.
- [ ] Decidir o que entra em "sites especializados" (categoria ainda aberta).
- [ ] Botões de ação nos cards de Oportunidade (marcar como abordado/descartado)
      — hoje só editável direto no KV, mesma situação de Concursos.
