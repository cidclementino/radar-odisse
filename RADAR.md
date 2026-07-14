# Radar Odisse — decisões de produto e lógica

Este documento registra o *porquê* das decisões, não só o *como* — mesmo espírito
do `PRICING.md` do `odisse-orcamentos`.

## Propósito

Painel interno pra monitorar concursos e editais de arquitetura, urbanismo,
paisagismo e design de produto/mobiliário, com decisão manual de participar
ou descartar. Uso interno (login com senha planejado, não implementado nesta
rodada).

## Fontes (v1)

- `concursosdeprojeto.org` — RSS confirmado (`/feed/`), curadoria já feita pelo
  próprio site, nacional + internacional. **Implementada nesta rodada.**
- `iab.org.br` — WordPress (Elementor), categoria dedicada "Concursos", sem
  bloqueio de acesso. **Não implementada ainda.**
- `competitions.archi` — WordPress, provável RSS nativo, só internacional.
  **Não implementada ainda.**
- `archdaily.com` — sem RSS visível, requer scraping de HTML paginado.
  **Não implementada ainda.**
- `espacodearquitetura.com` — WordPress, foco Portugal/Europa. **Não
  implementada ainda.**

Fontes descartadas por ora: `caubr.gov.br` e `caupb.gov.br` — ambas com
bot-detection ativo, bloquearam até fetch manual de teste. Revisitar se algum
workaround técnico aparecer (user-agent diferente, RSS alternativo).

Sem filtro geográfico (Paraíba/Nordeste é irrelevante pro escopo — poucos
concursos regionais existem). Sem backfill histórico — coleta só a partir de
quando o job começar a rodar; concursos com prazo já vencido não entram.

## Escopo

`escopo` é uma lista (não um valor único), porque um concurso pode ser mais de
uma coisa ao mesmo tempo (ex: arquitetura + paisagismo). Valores possíveis:
`arquitetura`, `urbanismo`, `paisagismo`, `design_produto_mobiliario`.

## Schema do `Concurso`

Ver `data/concursos.sample.json` pra exemplos completos. Pontos que não são
óbvios só de olhar o schema:

- **`link_oficial` ≠ `fonte_url_original`.** O primeiro é o site oficial do
  concurso (usado no dedup entre fontes); o segundo é a página do agregador
  de onde coletamos aquele item específico. Um parser NUNCA deve preencher
  `link_oficial` com o link do próprio agregador — se não conseguir extrair o
  link oficial de fato do conteúdo, deixa `null` (desconhecido).
- **Datas**: só `inscricao_fim` e `entrega_fim` são prioritárias. `publicacao`
  foi removida do schema (decisão explícita — irrelevante pro caso de uso).
  `resultado_previsto` é melhor-esforço. `datas.texto_bruto` sempre guarda o
  trecho original da fonte, pra auditoria e pra UI mostrar quando o parsing
  automático falhar.
- **Ausência de informação = `null`**, nunca um valor default que pareça dado
  real (ex: `banca_definida` é `true` | `false` | `null`, nunca assume `false`
  na ausência de menção).

## Dedup — a regra

Cinco campos definem se dois registros de fontes diferentes são o mesmo
concurso: `nome`, `local_projeto`, `inscricao_fim`, `entrega_fim`,
`link_oficial`. Cada campo é classificado, no par comparado, como:

- **bate** — valores equivalentes
- **ausente** — um dos dois não tem a informação
- **conflito** — os dois têm valor, e são diferentes

**Decisão:** nenhum campo em conflito → funde automaticamente. Qualquer campo
em conflito → vai pra fila de revisão manual (`REVISAO` no KV) pra decisão
humana (mesmo concurso ou não).

Particularidades de cada tipo de campo:

- `nome` / `local_projeto`: comparação por similaridade de texto (coeficiente
  de Dice sobre bigramas, normalizado — sem acento/pontuação). **Bate** se
  similaridade ≥ 80%. Abaixo disso, com ambos os valores presentes, conta como
  **conflito** (não ausente).
- `inscricao_fim` / `entrega_fim`: comparação exata de data ISO.
- `link_oficial`: compara **domínio**, não a URL inteira (evita falso conflito
  por parâmetros de tracking).

### Dedup — pré-filtro de candidatos

A regra acima decide o que fazer com um par que já parece plausível. Mas sem
um filtro antes disso, todo concurso novo seria comparado contra *todos* os já
existentes — e como nomes de concursos não relacionados quase sempre têm
similaridade baixa (mas não zero), o campo `nome` bateria como "conflito" o
tempo todo, e a regra literal mandaria isso pra revisão manual, entupindo a
fila com pares completamente não relacionados.

Por isso, só entram na comparação bate/ausente/conflito os pares que já
tiverem no mínimo **50% de similaridade no nome** (`CANDIDATO_THRESHOLD` em
`worker/dedup.js`) — um bar bem mais solto que os 80% exigidos pra fusão, só
pra decidir "vale a pena comparar esse par a fundo".

### Limitação conhecida

Títulos fortemente parafraseados entre fontes (ex: "Concurso Arquitetônico
para a Casa da Mulher Indígena (CAMI)" vs. "Concurso de Arquitetura – Casa da
Mulher Indígena") podem ficar abaixo dos 80% de similaridade mesmo sendo o
mesmo concurso — nesse caso, cai em revisão manual em vez de fundir sozinho.
Isso é o comportamento pretendido (mais seguro errar pro lado da revisão do
que fundir errado), mas significa que a fila de revisão pode ter mais itens
"claramente iguais, só com nome diferente" do que exatamente conflitos reais.

## Interface — pilha de cards

- Ordenação: mais recentemente adicionado primeiro (`coletado_em` desc).
- Filtro padrão: mostra só `status_interno = "monitorando"`. Toggle no topo
  revela `descartado` e `inscrito` também.
- Cor da borda — calculada a partir de `inscricao_fim` (não `entrega_fim`):
  - `≤ 15 dias` → vermelho
  - `16–45 dias` → laranja
  - `> 45 dias` → verde
  - desconhecido → cinza
- O texto "inscrições encerram em X dias" usa o mesmo prazo (`inscricao_fim`)
  que define a cor — ambos sempre consistentes entre si.

## Nomenclatura

Termos reservados no `odisse-orcamentos` (Fase, Etapa, Entregável, Escopo)
não são usados aqui com o mesmo sentido, pra evitar colisão mental entre as
duas ferramentas. A entidade principal do Radar chama-se `Concurso`.
