// PNCP — documentos de cada licitação ou contrato coletado: o link do contrato assinado e o do termo
// de referência; nos contratos só de projeto, também o que se tira do texto do TR (área, fases…).
// Ver LICITACOES.md, "Documentos e termo de referência". As escolhas e a leitura do texto estão em
// parsers/lib/documentos.js (testadas sem rede).
//
// API de integração do PNCP, sem chave:
//   GET /api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{seq}/arquivos
//   GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/arquivos
// Só busca o que ainda não tem documentos no Radar (a coleta passa a lista do que já tem).

const { escolherContrato, escolherTR, escolherEdital, lerTR } = require('./lib/documentos');

const API = 'https://pncp.gov.br/api/pncp/v1/orgaos';
const UA = 'radar.odisse.com.br (Odisse, Estúdio de Arquitetura e Design)';
const ESPERA_MS = 1500;
const PDF_MAX_BYTES = 25 * 1024 * 1024;
// Arquivo publicado há pouco pode ainda não ter o TR: tenta de novo por alguns dias.
const DIAS_PARA_DESISTIR_DO_TR = 7;

const dormir = ms => new Promise(r => setTimeout(r, ms));

/** "08778326000156-2-000025/2026" ou "pncp-08778326000156-1-000095-2026" → { cnpj, seq, ano } */
function partes(numero) {
  const m = String(numero || '').match(/(\d{14})-[12]-0*(\d+)[/-](\d{4})$/);
  return m ? { cnpj: m[1], seq: Number(m[2]), ano: m[3] } : null;
}

async function getJSON(url) {
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (res.status === 204 || res.status === 404) return [];
    if (res.ok) return res.json();
    if (tentativa === 4 || !(res.status === 429 || res.status >= 500)) throw new Error(`PNCP respondeu ${res.status}`);
    const pedido = Number(res.headers.get('retry-after'));
    await dormir(Number.isFinite(pedido) && pedido > 0 ? pedido * 1000 : 15000 * tentativa);
  }
  return [];
}

async function arquivosContrato(numero) {
  const p = partes(numero);
  return p ? getJSON(`${API}/${p.cnpj}/contratos/${p.ano}/${p.seq}/arquivos`) : [];
}

async function arquivosCompra(numero) {
  const p = partes(numero);
  return p ? getJSON(`${API}/${p.cnpj}/compras/${p.ano}/${p.seq}/arquivos`) : [];
}

/** Baixa um PDF (até PDF_MAX_BYTES) e devolve o texto; { erro } se não for PDF ou não abrir. */
async function textoDoPDF(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) return { erro: `o PNCP respondeu ${res.status}` };
    const tamanho = Number(res.headers.get('content-length'));
    if (tamanho > PDF_MAX_BYTES) return { erro: 'arquivo grande demais' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > PDF_MAX_BYTES) return { erro: 'arquivo grande demais' };
    const cabeca = String.fromCharCode(...bytes.slice(0, 5));
    if (cabeca !== '%PDF-') return { erro: cabeca.startsWith('PK') ? 'arquivo compactado ou do Word (não lido)' : 'não é PDF' };
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return { texto: text };
  } catch (err) {
    return { erro: err.name === 'AbortError' ? 'o PNCP demorou demais' : `não abriu (${String(err.message).slice(0, 60)})` };
  } finally {
    clearTimeout(t);
  }
}

const ehProjetoContratado = item => item.fase === 'contratada' && item.tipo_objeto === 'projeto';
const numeroDaCompra = item => (item.fase === 'contratada' ? item.licitacao_id : item.numero_controle);

/**
 * Acrescenta `documentos` ({ contrato, tr }) aos itens e, nos contratos só de projeto, `tr` (leitura
 * do termo de referência). `prontos` = ids que já têm documentos no Radar (não busca de novo).
 */
async function completarDocumentos(itens, prontos = new Set()) {
  let buscados = 0, lidos = 0;
  for (const item of itens) {
    if (prontos.has(item.id)) continue;
    try {
      const docs = {};
      if (item.fase === 'contratada') {
        docs.contrato = escolherContrato(await arquivosContrato(item.numero_controle));
        await dormir(ESPERA_MS);
      }
      const daCompra = numeroDaCompra(item) ? await arquivosCompra(numeroDaCompra(item)) : [];
      if (numeroDaCompra(item)) await dormir(ESPERA_MS);
      docs.tr = escolherTR(daCompra);
      // Nas abertas, o edital também (quando é outro arquivo que não o escolhido como TR).
      if (item.fase !== 'contratada') {
        const edital = escolherEdital(daCompra);
        if (edital && edital.url !== docs.tr?.url) docs.edital = edital;
      }
      const publicado = item.publicado_em || item.assinatura;
      const recente = publicado && (Date.now() - new Date(publicado).getTime()) / 86400000 < DIAS_PARA_DESISTIR_DO_TR;
      // Sem TR ainda e publicado há pouco: deixa sem `documentos` para a próxima coleta tentar de novo.
      if (!docs.tr && !docs.contrato && recente) continue;
      item.documentos = JSON.parse(JSON.stringify(docs));
      buscados++;

      if (ehProjetoContratado(item) && docs.tr) {
        const { texto, erro } = await textoDoPDF(docs.tr.url);
        item.tr = erro ? { legivel: false, erro } : lerTR(texto);
        item.tr.documento = docs.tr.titulo;
        lidos++;
        await dormir(ESPERA_MS);
      }
    } catch (err) {
      console.error(`[pncp.gov.br] documentos de ${item.id}:`, err.message);
    }
  }
  console.log(`[pncp.gov.br] documentos: ${buscados} itens com links, ${lidos} termos de referência lidos`);
  return itens;
}

module.exports = { completarDocumentos, textoDoPDF, partes };

// Teste à mão: node parsers/pncp-documentos.js <url de um PDF do PNCP>
if (require.main === module) {
  const url = process.argv[2];
  if (!url) { console.error('Uso: node parsers/pncp-documentos.js <url do PDF>'); process.exit(1); }
  textoDoPDF(url).then(r => {
    if (r.erro) { console.log('Erro:', r.erro); return; }
    console.log(JSON.stringify(lerTR(r.texto), null, 2));
  });
}
