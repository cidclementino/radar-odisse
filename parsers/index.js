// Registro central de parsers. Cada parser exporta `{ parse, FONTE }`,
// onde `parse()` retorna uma Promise<Concurso[]> já normalizado.
//
// Pra adicionar uma nova fonte (ArchDaily, competitions.archi, espacodearquitetura,
// iab.org.br): crie parsers/<fonte>.js seguindo o mesmo contrato de
// parsers/concursosdeprojeto.js e registre aqui.

module.exports = [
  require('./concursosdeprojeto'),
];
