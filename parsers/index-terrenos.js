// Registro dos parsers da aba Terrenos. Cada parser exporta `{ parse, FONTE }`.
// `parse()` retorna:
//   - OLX: array de Oportunidade (só terrenista)
//   - ZAP: { oportunidades, corretoresCandidatos } (terrenista + corretor)
//   - YouTube: { oportunidades, corretoresCandidatos } (só corretor)
//
// scripts/collect-terrenos-and-send.js normaliza os dois formatos antes de
// enviar pro Worker.

module.exports = [
  require('./olx'),
  require('./zap'),
  require('./youtube'),
];
