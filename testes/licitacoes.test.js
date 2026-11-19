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

test('Assessoria de projetos de arquitetura e urbanismo entra (objeto real, Cabo de Santo Agostinho)', () => {
  const r = entra('Contratação de Empresa Especializada para Assessoramento e Elaboração de Projetos e Estudos de Engenharia, Arquitetura, Urbanismo e Paisagismo no Município do Cabo de Santo Agostinho', 'projeto');
  assert.deepEqual(r.escopo.slice(0, 3), ['arquitetura', 'urbanismo', 'paisagismo']);
  entra('Contratação Semi-Integrado de empresa de engenharia para prestação de serviço para a elaboração do projeto executivo e execução das obras de requalificação do centro', 'projeto_e_obra');
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
  fica('Contratação de pessoa jurídica especializada para prestação de serviços técnicos de elaboração, execução, monitoramento e avaliação do Projeto de Trabalho Social (PTS) do empreendimento habitacional');
  fica('[Portal de Compras Públicas] - Contratação de solução integrada de segurança eletrônica para o Sistema Adutor Maxaranguape, incluindo elaboração de projeto, fornecimento e instalação nas unidades e sede');
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

// ---------------------------------------------------------------- contratadas
const { classificarContrato, paraContratada, contatoDaReceita } = require('../parsers/lib/contratos');
const contrato = (objeto, extra = {}) => ({
  numeroControlePNCP: '08778326000156-2-000025/2026', numeroControlePncpCompra: '08778326000156-1-000095/2026',
  anoContrato: 2026, sequencialContrato: 25, receita: false, tipoPessoa: 'PJ',
  tipoContrato: { id: 1, nome: 'Contrato (termo inicial)' }, categoriaProcesso: { id: 7, nome: 'Obras' },
  objetoContrato: objeto, valorGlobal: 2500000, niFornecedor: '12345678000190', nomeRazaoSocialFornecedor: 'CONSTRUTORA EXEMPLO LTDA',
  orgaoEntidade: { cnpj: '08778326000156', razaoSocial: 'MUNICIPIO DE JOAO PESSOA', esferaId: 'M' },
  unidadeOrgao: { municipioNome: 'João Pessoa', ufSigla: 'PB', nomeUnidade: 'SEINFRA' },
  dataAssinatura: '2026-11-12', dataVigenciaFim: '2027-11-12', dataPublicacaoPncp: '2026-11-17T10:00:00', ...extra,
});

test('Contratadas: níveis pela obra', () => {
  assert.equal(classificarContrato(contrato('Contratação integrada para elaboração dos projetos básico e executivo e execução das obras de implantação da creche')).nivel, 3);
  assert.equal(classificarContrato(contrato('Construção da Escola Municipal do bairro Gramame')).nivel, 2);
  assert.equal(classificarContrato(contrato('Reforma da Unidade Básica de Saúde do Cristo', { valorGlobal: 600000 })).nivel, 1);
  assert.equal(classificarContrato(contrato('Reforma e ampliação do Mercado Público', { valorGlobal: 1800000 })).nivel, 2);
});

test('Contratadas: o que fica fora', () => {
  assert.equal(classificarContrato(contrato('Pavimentação e drenagem de vias do bairro X')), null, 'infra');
  assert.equal(classificarContrato(contrato('Construção da creche', { valorGlobal: 120000 })), null, 'pequena');
  assert.equal(classificarContrato(contrato('Construção da creche', { unidadeOrgao: { ufSigla: 'SP' } })), null, 'fora da região');
  assert.equal(classificarContrato(contrato('Construção da creche', { tipoContrato: { id: 2, nome: 'Termo Aditivo' } })), null, 'aditivo');
  assert.equal(classificarContrato(contrato('Elaboração de projeto arquitetônico da creche', { categoriaProcesso: { id: 9 } })), null, 'só projeto é concorrente');
  assert.equal(classificarContrato(contrato('Manutenção predial preventiva e corretiva das escolas', { categoriaProcesso: { id: 9 } })), null, 'manutenção');
  assert.equal(classificarContrato(contrato('Aquisição de carteiras escolares', { categoriaProcesso: { id: 2 } })), null, 'compra');
});

test('Contratada vira item com vencedora, link e licitação de origem', () => {
  const c = paraContratada(contrato('Construção da Escola Municipal do bairro Gramame'), '2026-11-18T00:00:00Z');
  assert.equal(c.id, 'pncpc-08778326000156-2-000025-2026');
  assert.equal(c.licitacao_id, 'pncp-08778326000156-1-000095-2026');
  assert.equal(c.fase, 'contratada');
  assert.equal(c.valor_global, 250000000);
  assert.deepEqual(c.vencedor, { cnpj: '12345678000190', nome: 'CONSTRUTORA EXEMPLO LTDA' });
  assert.equal(c.link_pncp, 'https://pncp.gov.br/app/contratos/08778326000156/2026/25');
  const ct = contatoDaReceita({ ddd_telefone_1: '8332221100', ddd_telefone_2: '', email: 'OBRAS@EXEMPLO.COM.BR', nome_fantasia: 'Exemplo', municipio: 'JOAO PESSOA', uf: 'PB' });
  assert.deepEqual(ct.telefones, ['+558332221100']);
  assert.equal(ct.email, 'obras@exemplo.com.br');
});

test('Limpeza: o que sai e o que fica', async () => {
  const { paraApagar } = await import('../worker/licitacoes.js');
  const dias = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const itens = [
    { id: 'a1', encerramento: `${dias(61)}T09:00:00`, status_interno: 'monitorando' },
    { id: 'a2', encerramento: `${dias(30)}T09:00:00`, status_interno: 'monitorando' },
    { id: 'a3', encerramento: `${dias(90)}T09:00:00`, status_interno: 'participando' },
    { id: 'c1', fase: 'contratada', assinatura: dias(181), status_interno: 'monitorando' },
    { id: 'c2', fase: 'contratada', assinatura: dias(10), status_interno: 'descartado' },
    { id: 'c3', fase: 'contratada', assinatura: dias(10), status_interno: 'monitorando' },
    { id: 'c4', fase: 'contratada', assinatura: dias(400), status_interno: 'parceria' },
  ];
  assert.deepEqual(paraApagar(itens).map(l => l.id), ['a1', 'c1', 'c2']);
});
