// Testes da aba Terrenos: leitura de contatos e fusão de corretores.
// Rodar: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairContatos, extrairCreci, normalizarTelefone } = require('../parsers/lib/contatos');
const { processarCandidatosCorretor } = require('../worker/dedup-terrenos');

test('WhatsApp por link wa.me e por número de celular', () => {
  assert.equal(extrairContatos('Fale comigo: https://wa.me/5583999887766').whatsapp, '+5583999887766');
  assert.equal(extrairContatos('api.whatsapp.com/send?phone=5581988776655&text=oi').whatsapp, '+5581988776655');
  assert.equal(extrairContatos('WhatsApp (83) 99988-7766').whatsapp, '+5583999887766');
  assert.equal(extrairContatos('Zap: 83 9 9988 7766').whatsapp, '+5583999887766');
  assert.equal(extrairContatos('+55 84 99876-5432 chama!').whatsapp, '+5584998765432');
});

test('Fixo vai para telefone, não para WhatsApp', () => {
  const c = extrairContatos('Escritório (83) 3222-1100');
  assert.equal(c.telefone, '+558332221100');
  assert.equal(c.whatsapp, null);
});

test('Não confunde preço, área ou CEP com telefone', () => {
  const c = extrairContatos('Terreno 1.200m² por R$ 850.000,00 — CEP 58038-000, lote 12x30');
  assert.equal(c.whatsapp, null);
  assert.equal(c.telefone, null);
  assert.equal(normalizarTelefone('12345'), null);
});

test('Instagram por link e por @ depois da palavra instagram', () => {
  assert.equal(extrairContatos('https://www.instagram.com/ricardo.imoveis/').instagram, 'ricardo.imoveis');
  assert.equal(extrairContatos('Siga no Instagram: @Ricardo_Corretor.').instagram, 'ricardo_corretor');
  assert.equal(extrairContatos('instagram.com/p/AbC123').instagram, null);
  assert.equal(extrairContatos('email contato@imob.com.br').instagram, null);
});

test('E-mail', () => {
  assert.equal(extrairContatos('Contato: Ricardo@EscorelImoveis.com.br.').email, 'ricardo@escorelimoveis.com.br');
});

test('CRECI em vários formatos', () => {
  assert.equal(extrairCreci('CRECI 12345'), '12345');
  assert.equal(extrairCreci('CRECI-PB 12345'), 'PB-12345');
  assert.equal(extrairCreci('Creci/PB: 1234-J'), 'PB-1234-J');
  assert.equal(extrairCreci('CRECI nº 6789'), '6789');
  assert.equal(extrairCreci('creci J 4321'), '4321-J');
  assert.equal(extrairCreci('sem registro'), null);
});

test('Descrição do canal tem prioridade; o vídeo completa o que falta', () => {
  const c = extrairContatos('Corretor Ricardo · CRECI-PB 12345 · wa.me/5583999887766', 'Instagram: @ricardo.imoveis · WhatsApp 83 98888-0000');
  assert.equal(c.whatsapp, '+5583999887766');
  assert.equal(c.instagram, 'ricardo.imoveis');
  assert.equal(c.creci, 'PB-12345');
});

const base = { regiao: 'RM João Pessoa', fonte: 'youtube.com' };

test('Mesmo canal funde mesmo com nome diferente; liga a oportunidade', () => {
  const existentes = [{ id: 'c1', nome: 'Ricardo Vieira Imóveis', empresa: 'Ricardo Vieira Imóveis', canal_id: 'UC1', oportunidades_vinculadas: ['op0'], descoberto_via: ['youtube.com'], volume_zap: 0, nivel_maturidade: 1, whatsapp: null }];
  const { corretores, vinculos } = processarCandidatosCorretor(existentes, [
    { ...base, nome: 'RV Negócios', empresa: 'RV Negócios', canal_id: 'UC1', oportunidade_id: 'op1', nivel: 2, whatsapp: '+5583999887766' },
  ]);
  const c = corretores.get('c1');
  assert.ok(c);
  assert.equal(c.whatsapp, '+5583999887766');
  assert.equal(c.nivel_maturidade, 2);
  assert.deepEqual(c.oportunidades_vinculadas, ['op0', 'op1']);
  assert.equal(vinculos.get('op1'), 'c1');
});

test('Canais diferentes não fundem por nome parecido', () => {
  const existentes = [{ id: 'c1', nome: 'Imobiliária Central', empresa: 'Imobiliária Central', canal_id: 'UC1', descoberto_via: [], volume_zap: 0 }];
  const { corretores } = processarCandidatosCorretor(existentes, [
    { ...base, nome: 'Imobiliaria Central', empresa: 'Imobiliaria Central', canal_id: 'UC2', oportunidade_id: 'op9' },
  ]);
  assert.equal(corretores.has('c1'), false);
  assert.equal(corretores.size, 1);
  assert.equal([...corretores.values()][0].canal_id, 'UC2');
});

test('Coleta nunca sobrescreve contato já preenchido', () => {
  const existentes = [{ id: 'c1', nome: 'Ana Lins', empresa: null, canal_id: 'UC1', whatsapp: '+5583911112222', instagram: null, descoberto_via: [], volume_zap: 0 }];
  const { corretores } = processarCandidatosCorretor(existentes, [
    { ...base, nome: 'Ana Lins', empresa: 'Ana Lins', canal_id: 'UC1', whatsapp: '+5583999999999', instagram: 'analins' },
  ]);
  const c = corretores.get('c1');
  assert.equal(c.whatsapp, '+5583911112222');
  assert.equal(c.instagram, 'analins');
});

test('Corretor do ZAP sem canal continua fundindo pelo nome', () => {
  const existentes = [{ id: 'c1', nome: 'Escorel Corretora', empresa: 'Escorel Corretora', canal_id: null, descoberto_via: ['zapimoveis.com.br'], volume_zap: 1 }];
  const { corretores, vinculos } = processarCandidatosCorretor(existentes, [
    { nome: 'Escorel Corretora', empresa: 'Escorel Corretora', creci: null, regiao: 'João Pessoa', fonte: 'zapimoveis.com.br', oportunidade_id: 'zap-1' },
  ]);
  assert.equal(corretores.get('c1').volume_zap, 2);
  assert.equal(vinculos.get('zap-1'), 'c1');
});
