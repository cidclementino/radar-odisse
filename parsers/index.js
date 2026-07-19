// Registro central de parsers. Cada parser exporta `{ parse, FONTE }`,
// onde `parse()` retorna uma Promise<Concurso[]> já normalizado.
//
// Pra adicionar uma nova fonte (ArchDaily, espacodearquitetura, iab.org.br):
// crie parsers/<fonte>.js seguindo o mesmo contrato de
// parsers/concursosdeprojeto.js e registre aqui.
//
// competitionsarchi.js aceita um parâmetro opcional em `parse(idsConhecidos)`
// pra pular fetch de detalhe de itens já cadastrados — ver
// scripts/collect-and-send.js, que é quem monta e passa esse Set.

module.exports = [
  require('./concursosdeprojeto'),
  require('./competitionsarchi'),
  require('./bustler'),
];
