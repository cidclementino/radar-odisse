// Conserto de datas dos concursos já gravados (POST /api/manutencao/reparar).
//
// O parser do Bustler gravou datas quebradas ("September-undefined-it") ou nenhuma data, porque o
// feed usa "Registration Deadline:  Oct 4, 2026; Submission Deadline: Oct 4, 2026", formato que ele
// não reconhecia, e uma das expressões tinha um grupo de captura a mais. Como o texto original fica
// em `datas.texto_bruto`, dá para reler as datas sem buscar nada de novo.
// Mesma leitura de parsers/bustler.js (extrairDatasBustler) — manter as duas em sincronia.

const MESES = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function dataValida(v) {
  return typeof v === 'string' && RE_ISO.test(v) && !Number.isNaN(new Date(v + 'T00:00:00').getTime());
}

function iso(ano, mesTexto, dia) {
  const mes = MESES[String(mesTexto).toLowerCase().slice(0, 3)];
  return mes ? `${ano}-${mes}-${String(dia).padStart(2, '0')}` : null;
}

// "Registration Deadline:  Oct 4, 2026" · "Register/Submit Deadline: Sunday, Oct 4, 2026" · "Reg/Sub: Oct 4, 2026"
const DATA = '(?:[A-Za-z]{3,9},?\\s+)?([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})';

export function datasDoTexto(texto) {
  const t = String(texto || '');
  const achar = re => { const m = t.match(re); return m ? iso(m[3], m[1], m[2]) : null; };
  let inscricao = achar(new RegExp(`(?:registration|register)(?:\\/submit)?\\s+deadline\\s*:?\\s*${DATA}`, 'i'))
    || achar(new RegExp(`\\breg(?:\\/sub)?\\s*:\\s*${DATA}`, 'i'));
  let entrega = achar(new RegExp(`submission\\s+deadline\\s*:?\\s*${DATA}`, 'i'))
    || achar(new RegExp(`\\bsub\\s*:\\s*${DATA}`, 'i'));
  // "Register/Submit Deadline" e "Reg/Sub" valem para os dois prazos
  if (/register\/submit|reg\/sub/i.test(t)) entrega = entrega || inscricao;
  return { inscricao_fim: inscricao, entrega_fim: entrega };
}

/** devolve o concurso com as datas consertadas, ou null se não mudou nada */
export function repararDatas(c) {
  const datas = { ...(c.datas || {}) };
  let mudou = false;
  for (const k of ['inscricao_fim', 'entrega_fim', 'resultado_previsto']) {
    if (datas[k] != null && !dataValida(datas[k])) { datas[k] = null; mudou = true; }
  }
  if ((!datas.inscricao_fim || !datas.entrega_fim) && datas.texto_bruto) {
    const lidas = datasDoTexto(datas.texto_bruto);
    if (!datas.inscricao_fim && lidas.inscricao_fim) { datas.inscricao_fim = lidas.inscricao_fim; mudou = true; }
    if (!datas.entrega_fim && lidas.entrega_fim) { datas.entrega_fim = lidas.entrega_fim; mudou = true; }
  }
  return mudou ? { ...c, datas } : null;
}
