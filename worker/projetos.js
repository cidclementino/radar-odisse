// Radar → Projetos: um concurso em acompanhamento vira um projeto ativo no Universo (projetos.odisse).
//
// Fala com a API do Universo pelo service binding PROJETOS (Worker universo-hub, ponto de entrada
// "Projetos" — as mesmas permissões da ferramenta Projetos, que já cadastra projetos à mão).
//
// Regras (decididas pelo Cid em 18/11/2026):
//   - nome: o nome exibido no Radar (apelido, ou o capturado);
//   - núcleo Odisse Arquitetos, sem cliente, situação ativo, serviço "Concurso";
//   - início: o dia seguinte ao envio (horário de Brasília);
//   - previsão de fim: 1 dia antes do prazo de ENTREGA; sem data de entrega, 1 dia antes do fim das
//     inscrições (com aviso). É uma data indicativa: o fluxo de etapas não é encaixado nela;
//   - etapas: as do Plano Geral de Trabalho publicado que valem (P) para o serviço Concurso, na ordem do
//     PGT, com o prazo que o PGT calcula para esse serviço (turnos ÷ 10 = semanas). Fases "soltas"
//     (ilhas: etapas avulsas) ficam de fora. Se o fluxo passar da previsão de fim, só avisa;
//   - o projeto gasta um número da sequência oficial (OA-AAAA-NNN);
//   - no Radar, o concurso passa a "inscrito" e guarda { id, codigo, enviado_em } em `projeto`.

const SERVICO_CONCURSO = 'srv_co';
const NUCLEO = 'arquitetos';

function hojeBrasilia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function somarDias(dia, n) {
  const d = new Date(dia + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const br = dia => (dia ? dia.split('-').reverse().join('/') : '');
const valida = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function universo(env, metodo, caminho, corpo) {
  if (!env.PROJETOS) throw Object.assign(new Error('ligação com o Projetos não configurada no Worker'), { status: 503 });
  const res = await env.PROJETOS.fetch(`https://universo/api/v1/${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(dados.erro || dados.error || `Projetos respondeu ${res.status}`), { status: res.status });
  return dados;
}

/** Etapas do PGT publicado que valem para o serviço Concurso, com semanas. */
async function etapasDoPgt(env) {
  let pub;
  try { pub = await universo(env, 'GET', 'publicacoes/ultima?tipo=pgt'); } catch (err) {
    if (err.status === 404) throw Object.assign(new Error('o Plano Geral de Trabalho ainda não foi publicado'), { status: 422 });
    throw err;
  }
  const pgt = pub.dados || {};
  const fases = Object.fromEntries((pgt.fases || []).map(f => [f.id, f]));
  const etapas = (pgt.etapas || [])
    .filter(e => e.servicos?.[SERVICO_CONCURSO]?.pertinencia === 'P' && !fases[e.fase_id]?.solta)
    .map(e => {
      const turnos = e.prazos?.[SERVICO_CONCURSO];
      return { sigla: e.sigla, nome: e.nome, fase: fases[e.fase_id]?.nome || null, semanas: turnos ? Math.round((turnos / 10) * 10) / 10 : null };
    });
  return { etapas, pgt_numero: pub.numero };
}

/** O que será criado para este concurso (sem gravar nada). */
export async function planejar(env, c) {
  const datas = c.datas || {};
  const usouInscricao = !valida(datas.entrega_fim);
  const prazo = usouInscricao ? datas.inscricao_fim : datas.entrega_fim;
  const avisos = [];
  const bloqueios = [];
  if (c.projeto?.id) bloqueios.push(`Este concurso já foi enviado (${c.projeto.codigo}).`);
  if (!valida(prazo)) bloqueios.push('O concurso não tem data de entrega nem de fim das inscrições. Corrija as datas pelo lápis antes de enviar.');
  const inicio = somarDias(hojeBrasilia(), 1);
  const limite = valida(prazo) ? somarDias(prazo, -1) : null;
  if (limite && limite < inicio) bloqueios.push(`O prazo (${br(prazo)}) já passou ou é amanhã: a data limite (${br(limite)}) ficaria antes do início (${br(inicio)}). Corrija as datas pelo lápis se houve prorrogação.`);
  if (valida(prazo) && usouInscricao) avisos.push(`Sem data de entrega: a data limite usa o fim das inscrições (${br(prazo)}).`);

  const { etapas, pgt_numero } = await etapasDoPgt(env);
  if (!etapas.length) avisos.push('O PGT publicado não tem etapas marcadas para o serviço Concurso: o projeto será criado sem etapas.');
  const semPrazo = etapas.filter(e => !e.semanas).length;
  if (semPrazo) avisos.push(`${semPrazo} etapa(s) sem prazo no PGT.`);
  const dias = Math.round(etapas.reduce((s, e) => s + (e.semanas || 0) * 7, 0));
  const fimFluxo = dias ? somarDias(inicio, dias) : null;
  if (fimFluxo && limite && fimFluxo > limite) {
    avisos.push(`O fluxo padrão do PGT termina em ${br(fimFluxo)}, depois da data limite (${br(limite)}). Ajuste as etapas no Projetos.`);
  }
  const link = c.link_oficial || c.fonte_url_original || null;
  const projeto = {
    codigo: null,
    nome: (c.apelido || c.nome || '').trim(),
    nucleo_id: NUCLEO,
    cliente_id: null,
    situacao: 'ativo',
    servico: 'Concurso',
    inicio,
    previsao_fim: limite,
    observacoes: [
      `Concurso enviado pelo Radar em ${br(hojeBrasilia())}.`,
      `${usouInscricao ? 'Fim das inscrições' : 'Entrega das propostas'}: ${br(prazo)} (data limite = 1 dia antes).`,
      link ? `Site oficial: ${link}` : null,
      c.promotor ? `Promotor: ${c.promotor}` : null,
    ].filter(Boolean).join('\n'),
    etapas: etapas.map(e => ({ nome: e.nome, fase: e.fase, ref_vendas: null, semanas: e.semanas })),
  };
  return { projeto, etapas, prazo, usouInscricao, inicio, limite, fim_fluxo: fimFluxo, pgt_numero, avisos, bloqueios };
}

/** Cria o projeto no Universo. Devolve { projeto: { id, codigo }, plano }. */
export async function criarProjeto(env, c) {
  const plano = await planejar(env, c);
  if (plano.bloqueios.length) throw Object.assign(new Error(plano.bloqueios.join(' ')), { status: 422 });
  const reg = await universo(env, 'POST', 'projetos', plano.projeto);
  return { projeto: { id: reg.id, codigo: reg.codigo }, plano };
}
