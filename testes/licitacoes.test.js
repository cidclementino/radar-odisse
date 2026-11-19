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
  assert.equal(classificarContrato(contrato('Manutenção predial preventiva e corretiva das escolas', { categoriaProcesso: { id: 9 } })), null, 'manutenção');
  assert.equal(classificarContrato(contrato('Aquisição de carteiras escolares', { categoriaProcesso: { id: 2 } })), null, 'compra');
});

test('Contratada vira item com vencedora, link e licitação de origem', () => {
  const c = paraContratada(contrato('Construção da Escola Municipal do bairro Gramame'), '2026-11-18T00:00:00Z');
  assert.equal(c.id, 'pncpc-08778326000156-2-000025-2026');
  assert.equal(c.licitacao_id, 'pncp-08778326000156-1-000095-2026');
  assert.equal(c.fase, 'contratada');
  assert.equal(c.valor_global, 250000000);
  assert.deepEqual(c.vencedor, { cnpj: '12345678000190', nome: 'CONSTRUTORA EXEMPLO LTDA', pessoa: 'juridica' });
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
    { id: 'p1', fase: 'contratada', tipo_objeto: 'projeto', assinatura: dias(400), status_interno: 'monitorando' },
    { id: 'p2', fase: 'contratada', tipo_objeto: 'projeto', assinatura: dias(10), status_interno: 'descartado' },
  ];
  assert.deepEqual(paraApagar(itens).map(l => l.id), ['a1', 'c1', 'c2', 'p2']);
});

// ---------------------------------------------------------------- contratos só de projeto (mapa de preços)
// Objetos reais da amostra do PNCP de 13 a 18/11/2026.

test('Contratos só de projeto entram, do Brasil inteiro, sem nível', () => {
  const entra = (objeto, extra = {}) => {
    const c = classificarContrato(contrato(objeto, { categoriaProcesso: { id: 9 }, unidadeOrgao: { ufSigla: 'SC', municipioNome: 'Florianópolis' }, valorGlobal: 48400, ...extra }));
    assert.ok(c, `devia entrar: ${objeto}`);
    assert.equal(c.tipo_objeto, 'projeto', objeto);
    assert.equal(c.nivel, null);
    return c;
  };
  entra('CONTRATAÇÃO DE SERVIÇOS DE ARQUITETURA E URBANISMO PARA A ELABORAÇÃO DO PROJETO EXECUTIVO DE RESTAURAÇÃO DAS FACHADAS DO PRÉDIO SEDE DA SUPERINTENDÊNCIA DO PATRIMÔNIO DA UNIÃO');
  entra('ELABORAÇÃO DO PROJETO EXECUTIVO DE REFORMA DOS TELHADOS NO BLOCO A DA FACULDADE DE EDUCAÇÃO');
  entra('Elaboração de projeto executivo de mobiliário fixo para a UBS Santa Rita, conforme Memoriais Descritivos, Planilha Orçamentária, Cronograma.');
  entra('CONTRATAÇÃO DE SERVIÇOS ESPECIAIS DE ARQUITETURA E ENGENHARIA PARA ELABORAÇÃO DO PROJETO EXECUTIVO DE ARQUITETURA, COORDENAÇÃO, COMPATIBILIZAÇÃO E FORNECIMENTO DOS PROJETOS EXECUTIVOS DE ESTRUTURA, HIDRÁULICA, ELÉTRICA, MECÂNICA, COM MODELO EM BIM');
  // pessoa física também entra (o CPF não é guardado)
  const pf = paraContratada(contrato('CONTRATAÇÃO DE PESSOA FÍSICA OU JURÍDICA PARA ELABORAÇÃO DE ANTEPROJETO URBANÍSTICO DE QUALIFICAÇÃO DA ENTRADA DA CIDADE DE NOVA FLORESTA-PB',
    { tipoPessoa: 'PF', niFornecedor: '12345678901', valorGlobal: 25000, categoriaProcesso: { id: 9 } }));
  assert.equal(pf.tipo_objeto, 'projeto');
  assert.equal(pf.vencedor.cnpj, null);
  assert.equal(pf.vencedor.pessoa, 'fisica');
});

test('Contratos que não são só projeto de arquitetura ficam fora do mapa de preços', () => {
  const fora = (objeto, extra = {}) => {
    const c = classificarContrato(contrato(objeto, { categoriaProcesso: { id: 9 }, unidadeOrgao: { ufSigla: 'SP' }, valorGlobal: 60000, ...extra }));
    assert.ok(!c || c.tipo_objeto !== 'projeto', `devia ficar fora: ${objeto}`);
  };
  fora('Contratação de pessoa jurídica da área de arquitetura e/ou engenharia para elaboração de projetos executivos, bem como a execução de obra do CEU da Cultura');
  fora('CONTRATAÇÃO DE SERVIÇOS ESPECIALIZADOS DE ARQUITETURA E ENGENHARIA PARA REFORMA DE PRÉDIO ESCOLAR');
  fora('AQUISIÇÃO DE LICENÇAS DE USO, SOB A MODALIDADE DE ASSINATURA (SUBSCRIÇÃO), DE SOFTWARE DE AUTORIA BIM, DESTINADO À VISUALIZAÇÃO DE PROJETOS DE ARQUITETURA.');
  fora('A presente contratação tem por objeto a elaboração, atualização ou substituição do Projeto de Segurança Contra Incêndio e Pânico – PSCIP dos Edifícios da sede');
  fora('CONTRATAÇÃO PARA PRESTAÇÃO DE SERVIÇOS TÉCNICOS ESPECIALIZADOS NA ELABORAÇÃO E IMPLANTAÇÃO DO PROJETO TÉCNICO SOCIAL (PTS), REFERENTE AO EMPREENDIMENTO HABITACIONAL');
  fora('PRESTAÇÃO DE SERVIÇOS TÉCNICOS DE ARQUITETURA, ENGENHARIA CIVIL E AGRONOMIA, EM CARÁTER TEMPORÁRIO, QUANDO HOUVER INTERESSE', { valorGlobal: 0.01 });
  fora('ELABORAÇÃO DA REVISÃO E ATUALIZAÇÃO DOS PROJETOS EXECUTIVOS DE TERRAPLENAGEM, PAVIMENTAÇÃO E DRENAGEM DA OBRA DE CONSTRUÇÃO DA NOVA SEDE, SERVIÇOS DE ENGENHARIA E/OU ARQUITETURA');
});

// ---------------------------------------------------------------- documentos e termo de referência
const { escolherContrato, escolherTR, lerTR } = require('../parsers/lib/documentos');
const arq = (id, nome, titulo) => ({ tipoDocumentoId: id, tipoDocumentoNome: nome, titulo, url: `https://pncp.gov.br/pncp-api/v1/x/${id}-${titulo}`, statusAtivo: true });

test('Documentos: o termo de referência na ordem de preferência', () => {
  assert.equal(escolherTR([arq(20, 'Ato que autoriza a Contratação Direta', 'Autorizacao.pdf'), arq(7, 'Estudo Técnico Preliminar', 'ETP.pdf'), arq(4, 'Termo de Referência', 'TR_assinado.pdf')]).titulo, 'TR_assinado.pdf');
  assert.equal(escolherTR([arq(1, 'Aviso de Contratação Direta', 'TDL, TR E ANEXOS.pdf'), arq(20, 'Ato', 'AUTORIZACAO DG.pdf')]).titulo, 'TDL, TR E ANEXOS.pdf');
  assert.equal(escolherTR([arq(2, 'Edital', 'Anexo-VI---Detalhamento-do-BDI'), arq(6, 'Projeto Básico', 'Projeto básico')]).titulo, 'Projeto básico');
  assert.equal(escolherTR([arq(16, 'Outros Documentos', 'EXTRATO')]), null);
  assert.equal(escolherContrato([arq(12, 'Contrato', 'ContratoLote3assi.pdf')]).titulo, 'ContratoLote3assi.pdf');
});

test('Termo de referência: área, fases, disciplinas e prazo', () => {
  const r = lerTR(`TERMO DE REFERÊNCIA. 1. OBJETO: elaboração do projeto executivo de restauração das fachadas do prédio sede, com área construída de 1.245,30 m², incluindo levantamento cadastral, estudo preliminar, anteprojeto e projeto executivo de arquitetura, instalações elétricas e SPDA, com planilha orçamentária. Custo de referência de R$ 2.300,00 m² de obra. O terreno tem 3.400 m2. Entrega em BIM. 6. PRAZO DE EXECUÇÃO: o prazo de execução dos serviços será de 120 (cento e vinte) dias. ${'texto '.repeat(40)}`);
  assert.equal(r.area_m2, 1245.3);
  assert.deepEqual(r.areas.map(a => a.m2), [1245.3, 3400], 'o preço por m² não é área');
  assert.deepEqual(r.fases, ['levantamento', 'estudo_preliminar', 'anteprojeto', 'projeto_executivo']);
  assert.ok(r.disciplinas.includes('arquitetura') && r.disciplinas.includes('eletrica') && r.disciplinas.includes('orcamento'));
  assert.equal(r.bim, true);
  assert.deepEqual([r.prazo.valor, r.prazo.unidade], [120, 'dias']);
  assert.deepEqual(lerTR('   '), { legivel: false });
});

test('Concursos: como o vencedor será contratado (valor do contrato do projeto)', () => {
  const { extrairSite, juntar, palpites } = require('../js/extrair-site.js');
  const html = '<p>1º lugar: R$ 80.000,00 (+ Contrato Projeto Executivo – Arquitetura, Urbanismo, Paisagismo e Complementares: R$ 7.241.792,03)</p><p>O autor da proposta vencedora será contratado para o desenvolvimento das etapas posteriores do projeto.</p><p>A área construída será ampliada dos atuais 4.198 m² para cerca de 5.600 m².</p>';
  const r = juntar([extrairSite(html, 'https://exemplo.org/concurso')]);
  assert.equal(r.contratacao.length, 2);
  assert.equal(r.areas.length, 1);
  assert.match(palpites(r).contratacao, /7\.241\.792,03/);
});
