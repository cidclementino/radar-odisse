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
vetor inteiro. Consome no máximo 3 buscas/dia (cota diária de 10.000 unidades sobra folgada; ver seção da descrição completa).

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

## YouTube: descrição completa e contatos (nov/2026)

A busca (`search.list`, 100 unidades) devolve só um resumo da descrição (~160 caracteres) e, do
canal, só o nome. Por isso cada busca é seguida de duas leituras em lote (1 unidade cada, até 50
ids): `videos.list` (descrição completa) e `channels.list` (descrição do canal, @, foto).

- **Nível** passa a ser calculado sobre a descrição completa. O canal também conta como
  corretor/imobiliária quando a descrição dele fala em CRECI, corretor ou imobiliária.
- **Contatos** (`parsers/lib/contatos.js`): WhatsApp (link wa.me ou celular), telefone fixo,
  Instagram, e-mail e CRECI, lidos da descrição do canal e, no que faltar, da do vídeo. Só o que
  está escrito; ausência = null. Telefones em `+55DDNÚMERO`; CRECI como `PB-12345[-J]`.
- **Corretor** ganha `canal_id`, `canal_url`, `foto_url`, `whatsapp`, `telefone`, `instagram`,
  `email`. A fusão tenta primeiro o **id do canal** (exato); dois canais diferentes nunca são
  fundidos por nome ou empresa parecidos. A coleta só preenche campos vazios, nunca sobrescreve.
- **Ligação oportunidade ↔ corretor**: cada candidato traz `oportunidade_id` (YouTube e ZAP); o
  Worker preenche `corretor_vinculado_id` na oportunidade e `oportunidades_vinculadas` no corretor.
  Antes ninguém preenchia esses campos.
- **Recoleta** de uma oportunidade que já existe mantém a situação decidida no painel e a data da
  primeira coleta (antes voltava a "monitorando").
- Testes: `npm test` (`testes/terrenos.test.js`).

## Edição manual (nov/2026)

A coleta nem sempre traz tudo, então terrenos e corretores podem ser corrigidos, completados e
criados à mão no painel (lápis em cada cartão e linha; botões "Novo terreno" e "Novo corretor").

- Rotas (`worker/terrenos.js`): `PATCH /api/corretores/:id`, `POST /api/corretores`,
  `PATCH /api/oportunidades/:id`, `POST /api/oportunidades`.
- **Corretor**: nome, empresa, WhatsApp, telefone, Instagram, e-mail, CRECI, nível, regiões,
  observações e situação (`ativo` / `descartado`). Telefones normalizados para `+55DDNÚMERO`,
  Instagram sem @, CRECI no formato da coleta. Criado à mão: `descoberto_via: ['manual']`.
- **Terreno** (oportunidade): título, local, corretor ligado, nível, quem anuncia, link, observações
  e situação (`monitorando` / `descartado`; `no_funil` fica para o "Enviar ao funil"). Trocar o
  corretor ajusta `oportunidades_vinculadas` dos dois corretores. Criado à mão: `fonte: 'manual'`.
- **`campos_manuais`**: todo campo mexido à mão entra nessa lista e a coleta não mexe mais nele,
  nem quando foi esvaziado de propósito. Situação e observações nunca são tocadas pela coleta.
  Um terreno ligado à mão a um corretor não é religado pela coleta.
- **Excluir** (Cid, 19/11/2026; mesma dinâmica dos Concursos): para o que foi captado por engano
  (vídeo ou anúncio que não é terreno). Botão "Excluir" no diálogo do lápis, com confirmação.
  `DELETE /api/oportunidades/:id` grava a lápide `_ignorado:<id>` no mesmo KV, apaga o registro e
  tira o terreno da lista do corretor. A coleta descarta o que tiver lápide (os ids são estáveis:
  fonte + link + título) e também o candidato a corretor que veio só por aquele terreno.
  Diferente de "Descartado": descartar esconde e guarda; excluir apaga de vez.
- Testes: `testes/worker-terrenos.test.mjs` (rotas + recoleta, Worker empacotado com esbuild).

Próximo passo: ver `universo-radar-funil` no projeto Universo ("Levar aos Contatos",
"Enviar ao funil").

## Imóveis para retrofit (nov/2026)

Além de terrenos, a aba registra **imóveis à venda que pedem projeto de reforma**: prédio inteiro,
prédio ou imóvel comercial, galpão, casarão, sobrado comercial, imóvel antigo. O raciocínio é o do
terreno: quem compra vai precisar de projeto, e o corretor é o contato. Fica na mesma aba (não numa
nova) porque reaproveita tudo: corretor, fusão, níveis, edição manual e, depois, o "Enviar ao funil".

- Campo **`categoria`** na oportunidade: `terreno` (padrão; OLX, ZAP e tudo que já existia) ou
  `imovel`. Editável no lápis; filtro "Terrenos e imóveis" no painel; selo "Imóvel para retrofit".
- **Fonte por ora: só o YouTube.** Buscas a mais na rotação: RM João Pessoa (prédio, galpão, imóvel
  comercial, casarão no Centro Histórico), Campina Grande (prédio, galpão), RM Recife (prédio,
  galpão, casarão em Olinda), RM Natal (prédio, galpão). Litoral Sul sem busca de retrofit. São até
  4 buscas a mais por dia (400 unidades de cota; sobra folgada).
- **Nível** (`classificar()` em `parsers/youtube.js`, sobre título + descrição completa, sem acento):
  - 2 — tipo de imóvel + sinal de reforma ou mudança de uso ("para reforma", "retrofit", "ideal
    para clínica/escola/escritório…", "oportunidade de investimento", "aceita permuta");
  - 1 — tipo de imóvel + canal de corretor ou imobiliária;
  - fora — título de apartamento, lançamento ou "na planta" (busca de "prédio" traz muito disso).
- Vídeo que fala de terreno segue a regra de terreno, mesmo que cite galpão.
- OLX e ZAP continuam só com terrenos: as duas respondem 403 na coleta do GitHub Actions. Se
  voltarem, a categoria "Comércio e indústria" da OLX é o caminho para imóveis.
- No "Enviar ao funil", levar a categoria no `origem_detalhe` (terreno ou imóvel).

## Pendências que restam

- [x] Chave da YouTube Data API v3 (`YOUTUBE_API_KEY`) — feita.
- [ ] Validar os parsers de OLX/ZAP contra HTML real (ver ressalva acima) —
      rodar `npm run parse:olx` localmente e comparar contra o navegador.
- [ ] Decidir o que entra em "sites especializados" (categoria ainda aberta).
- [x] Situação e edição nos cartões de Oportunidade e de Corretor (lápis) — nov/2026.
