// Contratadas: quais contratos assinados são obra cuja construtora vencedora vai precisar de uma
// equipe de arquitetura. Separado do parser para os testes rodarem sem rede. Ver LICITACOES.md.

const { normalizeText } = require('./normalize');
const { classificarObjeto } = require('./licitacoes');

const UFS = ['PB', 'PE', 'RN'];
// Abaixo disso a obra é pequena demais para a construtora contratar arquitetura (reais).
const VALOR_MINIMO = 300000;
// Obra nova ou grande o bastante para pedir detalhamento, aprovação e compatibilização: nível 2.
const VALOR_GRANDE = 1500000;

// É obra (execução), não serviço contínuo nem compra.
const RE_OBRA = /\b(constru\w*|reforma\w*|amplia\w*|requalifica\w*|restaura\w*|revitaliza\w*|recupera\w*|implanta\w*|edifica\w*|execucao (da|das|de|do|dos) obras?|obras? (de|da|do))\b/;
// A obra é de edificação ou de espaço público com projeto (o que interessa ao Odisse).
const RE_EDIFICACAO = /(escola|creche|unidade basica|\bubs\b|unidade de saude|posto de saude|hospital|policlinica|maternidade|sede|predio|edificio|edificac|praca|parque|orla|mercado|feira|ginasio|quadra (poliesportiva|coberta)|centro (de|esportivo|cultural|comunitario|administrativo|de convivencia|de referencia)|cras|creas|caps\b|museu|teatro|biblioteca|habitac|unidades habitacionais|residencial|conjunto habitacional|restaurante popular|terminal|rodoviaria|estadio|arena|complexo|casarao|patrimonio|igreja|capela|cemiterio|camara municipal|prefeitura|forum|delegacia|quartel|campus|bloco|auditorio|anfiteatro|academia da saude)/;
// Infraestrutura sem edificação: fora, a não ser que o objeto também fale de uma edificação.
const RE_INFRA = /(pavimenta|recapeamento|asfalt|esgot|saneamento|drenagem|abastecimento de agua|adutora|rodovi|estrada|vicinal|ponte|eletrifica|iluminacao publica|\bpocos?\b|barragem|acude|aterro|tapa buraco|calcamento|meio fio)/;
// Serviço contínuo e compra: não é obra que pede projeto.
const RE_NAO_OBRA = /(manutencao (predial|preventiva|corretiva)|locacao|aquisicao|fornecimento de (material|materiais)|limpeza|vigilancia|conservacao predial)/;
// Instrumentos que não são a contratação em si.
const RE_TIPO_FORA = /(aditivo|apostilamento|rescis|cessao|termo de adesao)/;

function classificarContrato(c) {
  if (!c || c.receita === true) return null;
  if (c.tipoPessoa && c.tipoPessoa !== 'PJ') return null;
  if (RE_TIPO_FORA.test(normalizeText(c.tipoContrato?.nome))) return null;
  if (!UFS.includes(c.unidadeOrgao?.ufSigla)) return null;
  const valor = Number(c.valorGlobal ?? c.valorInicial);
  if (!(valor >= VALOR_MINIMO)) return null;

  const t = normalizeText(c.objetoContrato);
  const categoria = c.categoriaProcesso?.id;
  const ehObra = categoria === 7 || ((categoria === 9 || !categoria) && RE_OBRA.test(t));
  if (!ehObra || !RE_EDIFICACAO.test(t)) return null;
  if (RE_INFRA.test(t) && !/(escola|creche|praca|sede|predio|edificio|edificac|habitac|mercado|ginasio)/.test(t)) return null;
  if (RE_NAO_OBRA.test(t) && !/(reforma|amplia|constru)/.test(t)) return null;

  // Contrato só de projeto é de um escritório (concorrente), não de quem vai precisar de um.
  const comoProjeto = classificarObjeto(c.objetoContrato);
  if (comoProjeto?.tipo_objeto === 'projeto') return null;

  const projetoEObra = comoProjeto?.tipo_objeto === 'projeto_e_obra';
  const nova = /\b(constru\w*|implanta\w*|edifica\w*)\b/.test(t) && !/\breforma/.test(t);
  // 3: a vencedora tem de entregar projeto (integrada/semi-integrada) — precisa de arquitetura já.
  // 2: obra nova ou grande — detalhamento, compatibilização, aprovação, as built.
  // 1: reforma menor — vale registrar, abordar com cautela.
  const nivel = projetoEObra ? 3 : (nova || valor >= VALOR_GRANDE) ? 2 : 1;
  return { nivel, tipo_objeto: projetoEObra ? 'projeto_e_obra' : 'obra', escopo: comoProjeto?.escopo || escopoDe(t) };
}

function escopoDe(t) {
  const e = [];
  if (/(praca|parque|orla|urban|requalifica)/.test(t)) e.push('urbanismo');
  if (/(restaur|patrimonio|historic|casarao)/.test(t)) e.push('restauro');
  if (!e.length || RE_EDIFICACAO.test(t.replace(/praca|parque|orla/g, ''))) e.unshift('arquitetura');
  return [...new Set(e)];
}

const texto = v => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);
const centavos = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

/** "08778326000156-2-000025/2026" → "pncpc-08778326000156-2-000025-2026" */
const idContrato = n => `pncpc-${String(n).replace(/[^\w-]+/g, '-')}`;
const idCompra = n => (n ? `pncp-${String(n).replace(/[^\w-]+/g, '-')}` : null);

/** Contrato do PNCP → item "contratada" da aba Licitações (ou null). */
function paraContratada(c, agora = new Date().toISOString()) {
  if (!c?.numeroControlePNCP) return null;
  const classe = classificarContrato(c);
  if (!classe) return null;
  const orgao = c.orgaoEntidade || {};
  const unidade = c.unidadeOrgao || {};
  const cnpjOrgao = orgao.cnpj || String(c.numeroControlePNCP).split('-')[0];
  return {
    id: idContrato(c.numeroControlePNCP),
    fase: 'contratada',
    fonte: 'pncp.gov.br',
    numero_controle: c.numeroControlePNCP,
    licitacao_id: idCompra(c.numeroControlePncpCompra),
    objeto: texto(c.objetoContrato),
    informacao_complementar: texto(c.informacaoComplementar)?.slice(0, 2000) || null,
    ...classe,
    orgao: texto(orgao.razaoSocial),
    esfera: orgao.esferaId || null,
    unidade: texto(unidade.nomeUnidade),
    municipio: texto(unidade.municipioNome),
    uf: texto(unidade.ufSigla),
    vencedor: { cnpj: texto(c.niFornecedor)?.replace(/\D/g, '') || null, nome: texto(c.nomeRazaoSocialFornecedor) },
    valor_global: centavos(c.valorGlobal ?? c.valorInicial),
    assinatura: texto(c.dataAssinatura),
    vigencia_fim: texto(c.dataVigenciaFim),
    publicado_em: texto(c.dataPublicacaoPncp)?.slice(0, 10) || null,
    link_pncp: cnpjOrgao && c.anoContrato && c.sequencialContrato ? `https://pncp.gov.br/app/contratos/${cnpjOrgao}/${c.anoContrato}/${c.sequencialContrato}` : null,
    coletado_em: agora,
    status_interno: 'monitorando',
  };
}

/** Telefones da Receita ("8332221100") → "+558332221100". */
function telefoneReceita(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `+55${d}` : null;
}

/** Dados públicos do CNPJ (BrasilAPI, base da Receita) → contato da vencedora. */
function contatoDaReceita(r) {
  if (!r) return null;
  const tels = [telefoneReceita(r.ddd_telefone_1), telefoneReceita(r.ddd_telefone_2)].filter(Boolean);
  const email = typeof r.email === 'string' && /@/.test(r.email) ? r.email.trim().toLowerCase() : null;
  return {
    nome_fantasia: texto(r.nome_fantasia),
    telefones: [...new Set(tels)],
    email,
    cidade: [texto(r.municipio), texto(r.uf)].filter(Boolean).join('/') || null,
    atividade: texto(r.cnae_fiscal_descricao),
  };
}

module.exports = { classificarContrato, paraContratada, contatoDaReceita, idContrato, UFS, VALOR_MINIMO };
