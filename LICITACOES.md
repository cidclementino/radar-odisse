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

## Contratadas: a construtora vencedora como pista (nov/2026)

Além das abertas, o Radar lê os **contratos de obra assinados** no mesmo recorte (PB, PE, RN). Quem
venceu a obra muitas vezes não tem arquitetura em casa e vai precisar dela: projeto executivo na
contratação integrada, detalhamento, compatibilização, aprovação, as built. A pista é a construtora,
e o Odisse se oferece como equipe de projeto dela.

- **Fonte:** `GET /v1/contratos` do PNCP (contratos publicados num intervalo). A API não filtra por
  UF nem por categoria, então a coleta lê o país inteiro e filtra aqui: ~4.500 contratos por dia
  (10 páginas de 500). Sondagem de 18/11/2026: 3 dias, 22.992 contratos lidos, 16 obras de interesse,
  todas com telefone da vencedora.
- **Janela:** 3 dias por coleta (cobre o fim de semana e uma falha). No disparo manual, o campo
  "dias" pede até 120 — para trazer o passado recente na primeira vez.
- **O que entra** (`parsers/lib/contratos.js`): contrato (não aditivo nem apostilamento) de pessoa
  jurídica, despesa, em PB/PE/RN, a partir de **R$ 300 mil**, categoria Obras (ou Serviços de
  Engenharia com verbo de obra), sobre edificação ou espaço público (escola, creche, UBS, sede,
  praça, mercado, habitação, restauro…). Fica fora: pavimentação, saneamento e afins, manutenção
  predial contínua, compra, e contrato **só de projeto** (quem venceu é um escritório: concorrente,
  não cliente).
- **Nível** (a escala do Radar, como em Terrenos):
  - 3 — contratação integrada ou semi-integrada: a vencedora tem de entregar o projeto;
  - 2 — obra nova (construção, implantação) ou acima de R$ 1,5 milhão;
  - 1 — reforma menor.
- **Contato da vencedora:** telefones e e-mail do cadastro público do CNPJ (BrasilAPI, base da
  Receita Federal), buscados uma vez por CNPJ em cada coleta. Celular vira link de WhatsApp. Não é
  o vetor "CNPJ/SPE" descartado em Terrenos (aquele buscava empresas novas; este só completa o
  contato de quem já venceu um contrato público).
- **Situações:** monitorando, contatada, parceria, descartada.
- **Ligação com a aberta:** o contrato traz o número da contratação de origem; se ela estava no Radar
  como aberta, passa a mostrar "Contratada" e quem venceu.
- Mesmo KV (`LICITACOES`), com `fase: 'contratada'` e id `pncpc-…`. Interface: aba "Contratadas" na
  página, com cartão no desenho de Terrenos (borda pelo nível) e a vencedora em destaque.

## Uso da Cloudflare (plano gratuito)

Limites que pesam: 1.000 gravações de KV por dia, 100.000 leituras por dia, 1.000 operações de KV
por pedido ao Worker e 10 ms de processamento por pedido.

- **Lotes de 50**: a coleta manda os itens em pedidos de até 50 (o Worker recusa mais, 413). Cada
  item custa até ~5 operações (ler, conferir lápide, gravar, ligar à aberta). Sem isso, a primeira
  carga de 60 dias (~350 contratos) passaria das 1.000 operações num pedido só.
- **Só grava o que mudou**: compara o que veio do PNCP com o que está guardado (sem contar situação,
  observações e datas da própria coleta). Igual = não grava. Consequência: `visto_em` marca a última
  mudança, e o painel mostra "Atualizada em".
- **Limpeza** a cada coleta (`/api/manutencao/limpar-licitacoes`, até 200 por vez, lendo só a cópia
  da lista): sai a aberta encerrada há mais de 60 dias e a contratada descartada ou assinada há mais
  de 6 meses. **Fica sempre** o que está em curso (acompanhando, participando, contatada, parceria).
  A contratada apagada deixa uma lápide (`_ignorado:<id>`, expira em 150 dias) para a janela de 3
  dias da coleta não trazê-la de volta.
- **Cópia da lista enxuta**: sem o texto complementar nas contratadas e com ele cortado em 600
  caracteres nas abertas. O registro completo continua na chave de cada item.
- **Ordem de grandeza**: ~25 gravações por dia na coleta normal; ~350 no dia da carga de 60 dias
  (não usar 120 junto com as outras coletas do dia).

## Próximos passos possíveis

- "Enviar ao funil" (oportunidade no vendas, `origem = radar`), como em Terrenos. Nas contratadas,
  a construtora vencedora é a titular (organização), e o contato dela vai para os Contatos.
- Ligar a licitação a um projeto no projetos.odisse quando o Odisse participar, como em Concursos.
- Ampliar a geografia (AL, CE) se o volume em PB/PE/RN for baixo.
