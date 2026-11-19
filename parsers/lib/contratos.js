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

// ---------------------------------------------------------------- contratos só de projeto
// Não são pista para o Radar (quem venceu é um escritório), mas são o preço que o mercado público
// pagou por um projeto: entram para o mapa de preços do Universo, do Brasil inteiro, e ficam ocultos
// por padrão no painel. Ver LICITACOES.md, "Contratos só de projeto".
//
// Mais estrito que o filtro das abertas: o contrato tem de dizer que ELABORA o projeto (ou nomeá-lo
// como de arquitetura, urbanismo…), sem executar obra, comprar, manter ou acompanhar obra.
const PROJETO_VALOR_MINIMO = 1000; // credenciamento costuma vir com valor simbólico (R$ 0,01)
const RE_ELABORA_PROJETO = /\b(elabora\w*|desenvolv\w*|revis\w*|atualiza\w*|adequa\w*)\b(\s+\S+){0,10}?\s+(projet|anteprojet|estudo preliminar|plano diretor)|\bprojet\w*\s+(arquitetonic|de arquitetura|de urbanismo|urbanistic|paisagistic|de paisagismo|de interiores|de restauro|de restauracao)|\banteprojeto\b/;
// "execução" (não "executivo"): executar obra, reforma ou serviços; manutenção; acompanhamento de obra como objeto principal.
const RE_FAZ_OBRA = /\bexecu(cao|tar|tada|tados?)\s+(\S+\s+){0,4}?(obras?|reforma|construcao|implantacao|servicos)|\bmanutencao\b|\bservicos de acompanhamento de obras?\b|\bengenharia administrativa\b/;
const RE_COMPRA = /\b(aquisicao|licencas?|software|subscricao|locacao|fornecimento de (material|materiais|equipamentos?)|mobiliario planejado|marcenaria)\b/;
const RE_OUTRO_PROJETO = /(tecnico social|\bpts\b|projeto de extensao|area degradada|\bprad\b|licenciamento ambiental|assessoria ambiental|disposicao de residuos)/;
// Só disciplina complementar ou infraestrutura (incêndio, elétrica, terraplenagem…), sem arquitetura.
const RE_SO_COMPLEMENTAR = /(incendio|panico|pscip|avcb|clcb|eletric|spda|hidraulic|hidrossanit|estrutura(l|is)|automacao|ventilacao|terraplen|pavimenta|drenagem|iluminacao publica|\bip\b)/;
const RE_ARQUITETURA_NOMEADA = /(arquitetonic|projet\w*\s+(\S+\s+){0,2}?de arquitetura|de urbanismo|urbanistic|paisagistic|paisagismo|interiores|restaur|mobiliario|plano diretor)/;

// Revisto com a primeira carga (30 dias, 19/11/2026): obra feita "conforme projeto arquitetônico",
// sondagem, coffee break, consultoria jurídica, projeto social, PPCI, pavimentação etc. passavam.
// "conforme o projeto arquitetônico…" fala do projeto que a obra segue, não de um projeto contratado.
const RE_PROJETO_DE_REFERENCIA = /\b(conforme|de acordo com|segundo|com base n[oa]s?|nos termos d[oa]s?)\s+(\S+\s+){0,3}?projet\w*(\s+\S+){0,2}/g;
// A primeira ação do objeto: se é construir, executar, implantar, fornecer, comprar ou sondar antes de
// elaborar, o contrato não é de projeto.
const RE_PRIMEIRA_ACAO_FORA = /\b(construcao|execucao|implantacao|fornecimento|aquisicao|locacao|sondagem|instalacao|realizacao de levantamento topografico)\b/;
const RE_NAO_ARQUITETURA = /((consultoria|assessoria) (\S+ ){0,2}?juridic|docente|pesquisa aplicada|museolog|turistic|turismo|natalin|cenograf|naval|\bbalsa\b|transporte escolar|limpeza urbana|residuos solidos|valorizacao de residuos|recape|restauracao de pavimentos|passagem molhada|\bppci\b|controle de acesso|acrescimo quantitativo|projeto (denominado|intitulado)|projetos? de pesquisa|selecao de projetos|apoio financeiro|vistoria tecnica|laudo tecnico|engenharia de custos|crianc|adolescent|idosos|professor|participantes|sinalizacao)/;

/** Texto com acentos estragados ("ContrataÃ§Ã£o") volta a ser UTF-8. */
function repararTexto(s) {
  if (!s || !/Ã[\u0080-\u00bf]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from([...s].map(ch => ch.charCodeAt(0) & 0xff));
    const r = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return r;
  } catch { return s; }
}

/** Contrato só de projeto de arquitetura/urbanismo (para o mapa de preços) — devolve a classe ou null. */
function classificarContratoProjeto(c) {
  if (!c || c.receita === true) return null;
  if (RE_TIPO_FORA.test(normalizeText(c.tipoContrato?.nome))) return null;
  const valor = Number(c.valorGlobal ?? c.valorInicial);
  if (!(valor >= PROJETO_VALOR_MINIMO)) return null;
  const objeto = repararTexto(c.objetoContrato);
  const t = normalizeText(objeto).replace(RE_PROJETO_DE_REFERENCIA, ' ');
  const como = classificarObjeto(t);
  if (!como || como.tipo_objeto !== 'projeto') return null;
  const elabora = t.search(RE_ELABORA_PROJETO);
  if (elabora < 0) return null;
  const acaoFora = t.search(RE_PRIMEIRA_ACAO_FORA);
  if (acaoFora >= 0 && acaoFora < elabora) return null;
  if (RE_FAZ_OBRA.test(t) || RE_COMPRA.test(t) || RE_OUTRO_PROJETO.test(t) || RE_NAO_ARQUITETURA.test(t)) return null;
  if (RE_SO_COMPLEMENTAR.test(t) && !RE_ARQUITETURA_NOMEADA.test(t)) return null;
  return { nivel: null, tipo_objeto: 'projeto', escopo: como.escopo.filter(e => e !== 'complementares').length ? como.escopo : ['arquitetura', ...como.escopo] };
}

function classificarContrato(c) {
  if (!c || c.receita === true) return null;
  // Contrato só de projeto (Brasil inteiro, pessoa física ou jurídica): mapa de preços.
  const projeto = classificarContratoProjeto(c);
  if (projeto) return projeto;
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
    objeto: texto(repararTexto(c.objetoContrato)),
    informacao_complementar: texto(c.informacaoComplementar)?.slice(0, 2000) || null,
    ...classe,
    orgao: texto(orgao.razaoSocial),
    esfera: orgao.esferaId || null,
    unidade: texto(unidade.nomeUnidade),
    municipio: texto(unidade.municipioNome),
    uf: texto(unidade.ufSigla),
    // Pessoa física: só o nome (o CPF não é guardado no Radar).
    vencedor: { cnpj: c.tipoPessoa === 'PF' ? null : texto(c.niFornecedor)?.replace(/\D/g, '') || null, nome: texto(c.nomeRazaoSocialFornecedor), pessoa: c.tipoPessoa === 'PF' ? 'fisica' : 'juridica' },
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

module.exports = { classificarContrato, classificarContratoProjeto, repararTexto, paraContratada, contatoDaReceita, idContrato, UFS, VALOR_MINIMO };
