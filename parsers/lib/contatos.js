// Extração de contatos de um texto livre (descrição de vídeo ou de canal do YouTube).
//
// O corretor costuma publicar o próprio WhatsApp, Instagram, e-mail e CRECI na descrição
// justamente para ser procurado. Aqui só se lê o que está escrito; nada é deduzido.
// Ausência = null (nunca um valor padrão).
//
// Formatos devolvidos:
//   whatsapp / telefone: "+55DDNNNNNNNNN" (só dígitos, com +55) — whatsapp é celular ou link wa.me;
//                        telefone é fixo (8 dígitos depois do DDD).
//   instagram: nome do perfil, sem @ e em minúsculas.
//   email: em minúsculas.
//   creci: "PB-12345", "PB-1234-J" ou só "12345" quando a UF não aparece.

const UFS = new Set('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '));
const DDDS_VALIDOS = /^[1-9][1-9]$/;

/** Normaliza para +55DD + número; null se não parece telefone brasileiro. */
function normalizarTelefone(digitos) {
  let d = String(digitos).replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDDS_VALIDOS.test(d.slice(0, 2))) return null;
  const numero = d.slice(2);
  if (numero.length === 9 && numero[0] !== '9') return null; // celular sempre começa com 9
  if (numero.length === 8 && !/^[2-5]/.test(numero)) return null; // fixo começa com 2 a 5
  return `+55${d}`;
}

const ehCelular = tel => tel && tel.length === 14; // +55 + DD + 9 dígitos

function extrairWhatsappsDeLink(texto) {
  const achados = [];
  const re = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^\s]*&)?phone=|whatsapp\.com\/send\/?\?(?:[^\s]*&)?phone=)\+?(\d{10,13})/gi;
  let m;
  while ((m = re.exec(texto))) {
    const tel = normalizarTelefone(m[1]);
    if (tel) achados.push(tel);
  }
  return achados;
}

function extrairTelefones(texto) {
  // DDD (com ou sem parênteses e +55), depois 8 ou 9 dígitos com separadores comuns.
  // Os limites (?<!\d) e (?!\d) evitam pegar pedaços de números maiores (preços, CEP, áreas).
  const re = /(?<![\d\w])(?:\+?55[\s.-]*)?\(?0?([1-9][1-9])\)?[\s.-]*(9[\s.]?\d{4}|[2-5]\d{3})[\s.-]?(\d{4})(?!\d)/g;
  const achados = [];
  let m;
  while ((m = re.exec(texto))) {
    const tel = normalizarTelefone(`${m[1]}${m[2]}${m[3]}`);
    if (tel) achados.push(tel);
  }
  return achados;
}

const INSTAGRAM_RESERVADOS = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'about', 'direct']);

function limparPerfil(perfil) {
  const p = perfil.replace(/\.+$/, '').toLowerCase();
  if (p.length < 2 || INSTAGRAM_RESERVADOS.has(p) || /^\d+$/.test(p)) return null;
  return p;
}

function extrairInstagram(texto) {
  const porLink = texto.match(/instagram\.com\/([A-Za-z0-9_.]{1,30})/i);
  if (porLink) {
    const p = limparPerfil(porLink[1]);
    if (p) return p;
  }
  // "@perfil" só quando a palavra instagram/insta/ig aparece logo antes (evita e-mails e menções soltas)
  const porArroba = texto.match(/\b(?:instagram|insta|ig)\b[^@\n]{0,25}@([A-Za-z0-9_.]{2,30})/i);
  if (porArroba) return limparPerfil(porArroba[1]);
  return null;
}

function extrairEmail(texto) {
  const m = texto.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].replace(/\.+$/, '').toLowerCase() : null;
}

function extrairCreci(texto) {
  // CRECI 12345 · CRECI-PB 12345 · Creci/PB: 1234-J · CRECI nº 1234 · CRECI PB 1234 F · CRECI J 1234
  const re = /creci\b[\s:\/.-]*(?:([A-Za-z]{2})\b[\s:\/.-]*)?(?:([JjFf])\b[\s:\/.-]*)?(?:n[º°o]?\.?\s*)?(\d{3,6})(?:[\s-]*([JjFf])\b)?/i;
  const m = texto.match(re);
  if (!m) return null;
  const uf = m[1] && UFS.has(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
  const tipo = (m[2] || m[4] || '').toUpperCase();
  return [uf, m[3], tipo || null].filter(Boolean).join('-');
}

/**
 * Lê os contatos de um ou mais textos (o primeiro tem prioridade em cada campo).
 * Devolve { whatsapp, telefone, instagram, email, creci }, com null no que não achou.
 */
function extrairContatos(...textos) {
  const r = { whatsapp: null, telefone: null, instagram: null, email: null, creci: null };
  for (const bruto of textos) {
    if (!bruto) continue;
    const texto = String(bruto);
    if (!r.whatsapp) {
      const doLink = extrairWhatsappsDeLink(texto)[0];
      const celular = extrairTelefones(texto).find(ehCelular);
      r.whatsapp = doLink || celular || null;
    }
    if (!r.telefone) r.telefone = extrairTelefones(texto).find(t => !ehCelular(t)) || null;
    if (!r.instagram) r.instagram = extrairInstagram(texto);
    if (!r.email) r.email = extrairEmail(texto);
    if (!r.creci) r.creci = extrairCreci(texto);
  }
  return r;
}

module.exports = { extrairContatos, normalizarTelefone, extrairCreci, extrairInstagram };
