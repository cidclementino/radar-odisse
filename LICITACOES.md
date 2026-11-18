# Radar Odisse — Aba Licitações: decisões

Mesmo papel do `RADAR.md` (Concursos) e do `TERRENOS.md` (Terrenos): o *porquê* de cada escolha.

## Por que entra no Radar

A Lei 14.133/2021 manda contratar projeto de arquitetura por concurso ou por técnica e preço, e
todo órgão público publica a contratação no PNCP. É pista de trabalho real (há um contratante, um
prazo e um valor), vem de fonte oficial e se coleta sozinha. Cabe no critério do Radar.

O Diário Oficial de João Pessoa foi descartado para Terrenos (ver `TERRENOS.md`). O PNCP é outra
fonte, nacional e estruturada, com outro propósito; não reabre aquela decisão.

## Fonte

- **PNCP, API de consulta** (`https://pncp.gov.br/api/consulta`), sem chave:
  `GET /v1/contratacoes/proposta` — contratações com recebimento de propostas em aberto.
  Uma consulta por UF × modalidade, paginada (50 por página).
- **Geografia:** PB, PE e RN (a mesma de Terrenos). Ampliar = uma linha em `UFS` (`parsers/pncp.js`).
- **Modalidades:** 2 Diálogo competitivo, 3 Concurso, 4/5 Concorrência, 6/7 Pregão, 8 Dispensa.
  Pregão para projeto contraria a lei (art. 29), mas acontece; dispensa cobre projetos pequenos.
- **Ritmo:** o PNCP responde 429 a chamadas seguidas. A coleta espera 1,5 s entre chamadas e, no
  429, o que o servidor pedir (ou 15 s, 30 s…). Sondagem de 18/11/2026: 21 consultas, 1.456
  contratações em aberto lidas, 6 de projeto, sem 429.
- **Agenda:** dias úteis, 06:37 em Brasília (`collect-licitacoes.yml`), depois da coleta de Terrenos.

## O que conta como contratação de projeto

O PNCP não tem campo para isso: a decisão é por texto do objeto (`parsers/lib/licitacoes.js`,
testada com objetos reais em `testes/licitacoes.test.js`).

1. **É projeto** se o objeto tem verbo de elaboração ligado a projeto ("elaboração de projetos",
   "desenvolvimento do projeto executivo", "revisão do anteprojeto", "plano diretor"…), ou nomeia o
   projeto como de arquitetura/urbanismo/paisagismo/interiores/restauro, ou contrata serviço técnico
   de arquitetura. **"Conforme projeto básico" sozinho não conta**: aparece em quase todo edital de
   obra.
2. **E o assunto interessa**: edificação, cidade ou paisagem (escola, creche, sede, praça, orla,
   restauro, reforma…).
3. **Fora**: infraestrutura sem edificação (pavimentação, drenagem, saneamento, estrada, poço),
   sistemas prediais contratados sozinhos (subestação, elevador, climatização, segurança
   eletrônica — achados reais da EBSERH e de uma adutora no RN) e "projeto" no sentido social,
   pedagógico ou cultural (Projeto de Trabalho Social).
4. **Concurso (modalidade 3)**: basta o assunto (arquitetura, urbanismo, paisagismo, design).

Errar para o lado de deixar passar é aceitável (a pessoa descarta no painel); por isso não há
fila de revisão aqui.

## `tipo_objeto`

- `projeto` — só o projeto. É o que mais interessa ao Odisse; aparece com selo verde.
- `projeto_e_obra` — contratação integrada ou semi-integrada, ou "elaboração do projeto e execução
  da obra". Quem disputa é construtora; para o Odisse a pista é ser o projetista de uma delas.

Não há escala de maturidade 1–3 como em Terrenos: toda licitação já é processo aberto (seria
sempre nível 3). O que ordena é o prazo, como em Concursos.

## Schema da `Licitação` (KV `LICITACOES`)

`id` (`pncp-<numeroControlePNCP>`), `fonte`, `numero_controle`, `objeto`,
`informacao_complementar`, `tipo_objeto`, `escopo` (arquitetura, urbanismo, paisagismo, interiores,
restauro, complementares), `orgao`, `esfera` (F/E/M/D), `unidade`, `municipio`, `uf`,
`modalidade_id`, `modalidade`, `modo_disputa`, `srp`, `valor_estimado` (**centavos**; o PNCP põe 0
quando o valor é sigiloso → `null`), `abertura`, `encerramento` (data e hora de Brasília, como vêm),
`publicado_em`, `link_pncp`, `link_sistema` (onde a proposta é enviada), `coletado_em`, `visto_em`,
`status_interno`, `observacoes`.

- **Situações:** monitorando, acompanhando, participando, descartado.
- **Recoleta:** situação, observações e primeira coleta ficam; o resto vem sempre do PNCP (prazo e
  valor podem ser retificados pelo órgão).
- **Encerrada** não é situação: é calculada pelo prazo, como nos concursos.

## Interface

Cartão do concurso sem banner: borda e número pelo prazo de propostas (≤ 15 dias vermelho,
16–45 laranja, > 45 verde), objeto em até 4 linhas (o que vem todo em maiúsculas é mostrado como
frase comum), órgão, local, modalidade e valor. O clique abre o detalhe, com observações e os links
do edital no PNCP e do sistema de propostas. A situação muda no próprio cartão.

## Próximos passos possíveis

- "Enviar ao funil" (oportunidade no vendas, `origem = radar`), como em Terrenos.
- Ligar a licitação a um projeto no projetos.odisse quando o Odisse participar, como em Concursos.
- Ampliar a geografia (AL, CE) se o volume em PB/PE/RN for baixo.
