// Testes da aba Licitações: o que conta como contratação de projeto (objetos reais do PNCP).
// Rodar: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { classificarObjeto, paraLicitacao } = require('../parsers/lib/licitacoes');

const entra = (objeto, tipo) => {
  const r = classificarObjeto(objeto);
  assert.ok(r, `devia entrar: ${objeto}`);
  if (tipo) assert.equal(r.tipo_objeto, tipo, objeto);
  return r;
};
const fica = objeto => assert.equal(classificarObjeto(objeto), null, `devia ficar fora: ${objeto}`);

test('Projeto de arquitetura entra (só projeto)', () => {
  entra('Contratação de empresa especializada para elaboração de projetos de arquitetura e complementares para a nova sede da Secretaria de Saúde', 'projeto');
  entra('ELABORAÇÃO DE PROJETO ARQUITETÔNICO E COMPLEMENTARES DA CRECHE MUNICIPAL', 'projeto');
  entra('Serviços técnicos especializados de arquitetura e urbanismo para requalificação da orla', 'projeto');
  entra('Desenvolvimento de estudo preliminar, anteprojeto e projeto executivo de restauro do Casarão 34', 'projeto');
  const r = entra('Elaboração do Plano Diretor Municipal de Conde', 'projeto');
  assert.ok(r.escopo.includes('urbanismo'));
});

test('Contratação integrada entra marcada como projeto e obra (objeto real, João Pessoa)', () => {
  const r = entra('CONTRATAÇÃO INTEGRADA PARA ELABORAÇÃO DOS PROJETOS BÁSICO E EXECUTIVO E EXECUÇÃO DAS OBRAS E SERVIÇOS DE ENGENHARIA NECESSÁRIOS À IMPLANTAÇÃO DO CENTRO ESCOLAR MUNICIPAL DE ATIVIDADES PEDAGÓGICAS INTEGRADORAS CEMAPI', 'projeto_e_obra');
  assert.ok(r.escopo.includes('arquitetura'));
});

test('Obra conforme projeto (sem elaborar) fica fora', () => {
  fica('Execução da obra de reforma e ampliação da Escola Municipal X, conforme projeto básico e planilha orçamentária');
  fica('Contratação de empresa para construção de praça, de acordo com o projeto fornecido pela prefeitura');
});

test('Infraestrutura e sistemas prediais sozinhos ficam fora (objetos reais, EBSERH)', () => {
  fica('Elaboração de projeto de pavimentação e drenagem de vias urbanas do bairro Y');
  fica('Contratação de empresa especializada, sob o regime de contratação semi-integrada, para a elaboração e desenvolvimento dos Projetos Executivos, a partir do Projeto Básico fornecido pelo Hospital Universitário Júlio Bandeira (HUJB), bem como para a execução das obras e serviços de engenharia necessários à implantação de uma Subestação de Energia Elétrica 13,8 kV/800 kVA');
  fica('Reedição da Contratação de empresa especializada na elaboração de projeto e execução de sistema de transporte vertical (elevadores) para atendimento das necessidades do Hospital Universitário Alcides Carneiro');
  fica('Aquisição de material de expediente');
  fica('Licença de software para elaboração de projetos BIM');
});

test('Registro do PNCP vira Licitação; valor zero vira nulo', () => {
  const l = paraLicitacao({
    numeroControlePNCP: '08778326000156-1-000095/2026', anoCompra: 2026, sequencialCompra: 95,
    objetoCompra: 'Elaboração de projeto arquitetônico do mercado público', modalidadeId: 4, modalidadeNome: 'Concorrência - Eletrônica',
    valorTotalEstimado: 0, dataEncerramentoProposta: '2027-01-27T08:59:00', dataPublicacaoPncp: '2026-11-10T10:00:00',
    orgaoEntidade: { cnpj: '08778326000156', razaoSocial: 'MUNICIPIO DE JOAO PESSOA', esferaId: 'M' },
    unidadeOrgao: { municipioNome: 'João Pessoa', ufSigla: 'PB', nomeUnidade: 'SEPLAN' },
    linkSistemaOrigem: 'https://compras.example/edital/95',
  }, '2026-11-18T00:00:00Z');
  assert.equal(l.id, 'pncp-08778326000156-1-000095-2026');
  assert.equal(l.valor_estimado, null);
  assert.equal(l.orgao, 'MUNICIPIO DE JOAO PESSOA');
  assert.equal(l.link_pncp, 'https://pncp.gov.br/app/editais/08778326000156/2026/95');
  assert.equal(l.publicado_em, '2026-11-10');
  assert.equal(paraLicitacao({ numeroControlePNCP: 'x', objetoCompra: 'Aquisição de pneus', modalidadeId: 6 }), null);
});
