// Licitações: o que conta como "contratação de projeto" e como ler um registro do PNCP.
// Separado do parser para os testes rodarem sem rede. Ver LICITACOES.md.

const { normalizeText } = require('./normalize');

// Verbos de quem contrata a ELABORAÇÃO do projeto. Sem eles, "projeto básico" aparece em quase todo
// edital de obra ("execução da reforma conforme projeto básico") e encheria a aba de obras.
const RE_ELABORAR = /\b(elabora\w*|desenvolv\w*|confec\w*|revis(ao|ar)|atualiza\w*|adequa\w*|compatibiliza\w*)\b(\s+\S+){0,6}?\s+(de\s+|do\s+|dos\s+|da\s+|das\s+)?(projet|estudo preliminar|anteprojet|plano diretor|caderno de encargos)/;
// Projeto nomeado como de arquitetura, mesmo sem o verbo.
const RE_PROJETO_ARQ = /\bprojet\w*\s+(arquitetonic|de arquitetura|de urbanismo|urbanistic|paisagistic|de paisagismo|de interiores|de restauro|de restauracao)/;
// Serviço técnico de arquitetura contratado como tal.
const RE_SERVICO_ARQ = /\bservicos?\s+(tecnicos?\s+)?(especializados?\s+)?(de\s+)?(arquitetura|urbanismo)\b/;

// Assunto ligado a edificação, cidade ou paisagem — o que interessa ao Odisse.
const RE_ASSUNTO = /(arquitet|urban|paisag|interiores|restaur|patrimonio|tombad|requalifica|retrofit|edifica|predio|sede|escola|creche|unidade basica|ubs|hospital|posto de saude|praca|parque|orla|mercado publico|ginasio|quadra|centro de|museu|teatro|biblioteca|habitac|plano diretor|reforma|ampliacao|construcao)/;
// Engenharia sem edificação (estrada, rede, poço…): fora, se não houver também um assunto acima.
const RE_INFRA = /(pavimenta|esgot|saneamento|drenagem|abastecimento de agua|adutora|rodovi|estrada|vicinal|ponte|eletrifica|iluminacao publica|\bpocos?\b|barragem|acude|aterro sanitario|georreferencia|topografi)/;
// Sistemas prediais contratados sozinhos (subestação, elevador, ar-condicionado…): é engenharia de
// instalação, não projeto de arquitetura. Fora, a não ser que o objeto também fale da edificação.
const RE_SISTEMAS = /(subestac|elevador|transporte vertical|climatiza|ar condicionado|grupo gerador|cabeamento|rede logica|cftv|energia solar|fotovolta|usina|spda|para raio|gases medicinais)/;
const RE_EDIFICACAO = /(arquitet|urban|paisag|implantacao d[oa]s?\s+(centro|escola|creche|unidade|sede|praca|parque|mercado)|construcao d|reforma d|ampliacao d|edificac|requalifica|restaur)/;
// Projeto e obra no mesmo contrato.
const RE_COM_OBRA = /(contratacao integrada|semi ?integrada|projetos?\s+(\S+\s+){0,8}?e\s+(a\s+)?execu|elabora\w*\s+(\S+\s+){0,12}?e\s+(a\s+)?execu|execu\w*\s+(\S+\s+){0,6}?e\s+elabora)/;

const ESCOPOS = [
  ['arquitetura', /(arquitet|edifica|predio|sede|escola|creche|unidade basica|ubs|hospital|ginasio|museu|teatro|biblioteca|habitac)/],
  ['urbanismo', /(urban|plano diretor|praca|orla|requalifica\w* (urbana|de via|de area|do centro)|mobilidade|loteamento|parque)/],
  ['paisagismo', /paisag/],
  ['interiores', /(interiores|mobiliario|layout)/],
  ['restauro', /(restaur|patrimonio|tombad|historic)/],
  ['complementares', /(complementares|estrutura(l|is)|hidrossanit|eletric|climatiza|prevencao (e combate )?a incendio|spda)/],
];

/** Classifica o objeto. Devolve null se não for contratação de projeto que interessa. */
function classificarObjeto(objeto, complemento = '') {
  const t = normalizeText(objeto);
  if (!t) return null;
  const ehProjeto = RE_ELABORAR.test(t) || RE_PROJETO_ARQ.test(t) || RE_SERVICO_ARQ.test(t);
  if (!ehProjeto) return null;
  const assunto = RE_ASSUNTO.test(t);
  if (!assunto && !/arquitet|urban|paisag/.test(t)) return null;
  if (RE_INFRA.test(t) && !/(arquitet|urbanis|paisag|edifica|predio|escola|creche|praca|sede)/.test(t)) return null;
  if (RE_SISTEMAS.test(t) && !RE_EDIFICACAO.test(t)) return null;

  const tudo = `${t} ${normalizeText(complemento)}`;
  const escopo = ESCOPOS.filter(([, re]) => re.test(tudo)).map(([nome]) => nome);
  return {
    tipo_objeto: RE_COM_OBRA.test(t) ? 'projeto_e_obra' : 'projeto',
    escopo: escopo.length ? escopo : ['arquitetura'],
  };
}

// No modo Concurso (modalidade 3), basta o assunto: o concurso já é de projeto por natureza.
function classificarConcurso(objeto, complemento = '') {
  const t = normalizeText(objeto);
  if (!/(arquitet|urban|paisag|projeto|design|mobiliario)/.test(t)) return null;
  const tudo = `${t} ${normalizeText(complemento)}`;
  const escopo = ESCOPOS.filter(([, re]) => re.test(tudo)).map(([nome]) => nome);
  return { tipo_objeto: 'projeto', escopo: escopo.length ? escopo : ['arquitetura'] };
}

const FONTE = 'pncp.gov.br';

/** "08778326000156-1-000123/2026" → "pncp-08778326000156-1-000123-2026" */
function idDe(numeroControle) {
  return `pncp-${String(numeroControle).replace(/[^\w-]+/g, '-')}`;
}

/** Valor em reais (número) → centavos; 0 e negativo viram null (o PNCP põe 0 quando o valor é sigiloso). */
function centavos(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const texto = v => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);

/** Registro do PNCP → Licitação do Radar (ou null se o objeto não interessa). */
function paraLicitacao(r, agora = new Date().toISOString()) {
  if (!r || !r.numeroControlePNCP) return null;
  const objeto = texto(r.objetoCompra);
  const complemento = texto(r.informacaoComplementar);
  const classe = r.modalidadeId === 3 ? classificarConcurso(objeto, complemento) : classificarObjeto(objeto, complemento);
  if (!classe) return null;
  const orgao = r.orgaoEntidade || {};
  const unidade = r.unidadeOrgao || {};
  const cnpj = orgao.cnpj || null;
  return {
    id: idDe(r.numeroControlePNCP),
    fonte: FONTE,
    numero_controle: r.numeroControlePNCP,
    objeto,
    informacao_complementar: complemento ? complemento.slice(0, 2000) : null,
    ...classe,
    orgao: texto(orgao.razaoSocial || orgao.razaosocial),
    esfera: orgao.esferaId || null,
    unidade: texto(unidade.nomeUnidade),
    municipio: texto(unidade.municipioNome),
    uf: texto(unidade.ufSigla),
    modalidade_id: r.modalidadeId ?? null,
    modalidade: texto(r.modalidadeNome),
    modo_disputa: texto(r.modoDisputaNome),
    srp: typeof r.srp === 'boolean' ? r.srp : null,
    valor_estimado: centavos(r.valorTotalEstimado),
    abertura: texto(r.dataAberturaProposta),
    encerramento: texto(r.dataEncerramentoProposta),
    publicado_em: texto(r.dataPublicacaoPncp)?.slice(0, 10) || null,
    link_pncp: cnpj && r.anoCompra && r.sequencialCompra ? `https://pncp.gov.br/app/editais/${cnpj}/${r.anoCompra}/${r.sequencialCompra}` : null,
    link_sistema: /^https?:\/\//.test(r.linkSistemaOrigem || '') ? r.linkSistemaOrigem.trim() : null,
    coletado_em: agora,
    status_interno: 'monitorando',
  };
}

module.exports = { classificarObjeto, classificarConcurso, paraLicitacao, idDe, FONTE };
