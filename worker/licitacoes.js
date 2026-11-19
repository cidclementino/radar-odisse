// Aba Licitações: recebe a coleta do PNCP e guarda a decisão do painel. Ver LICITACOES.md.
//
// Uma licitação coletada de novo mantém a situação, as observações e a data da primeira coleta;
// o resto (prazo, valor, objeto) vem sempre do PNCP, que é a fonte oficial e pode ser retificado.
//
// Uso do plano gratuito da Cloudflare (LICITACOES.md, "Uso da Cloudflare"):
//   - a coleta chega em lotes de até LOTE_MAX itens (até 1.000 operações de KV por pedido);
//   - só grava o que mudou (1.000 gravações por dia);
//   - a limpeza tira o que não serve mais, para a cópia da lista não crescer sem fim.

export const SITUACOES_LICITACAO = ['monitorando', 'acompanhando', 'participando', 'descartado'];
// Contratadas (contrato de obra assinado): a pista é a construtora vencedora.
export const SITUACOES_CONTRATADA = ['monitorando', 'contatado', 'parceria', 'descartado'];
const situacoesDe = item => (item.fase === 'contratada' ? SITUACOES_CONTRATADA : SITUACOES_LICITACAO);
const EM_CURSO = new Set(['acompanhando', 'participando', 'contatado', 'parceria']);

export const LOTE_MAX = 50;
// O que é do painel ou da própria gravação: não conta para saber se o PNCP trouxe algo novo.
const DO_PAINEL = ['status_interno', 'observacoes', 'coletado_em'];
const NAO_COMPARA = new Set([...DO_PAINEL, 'visto_em', 'atualizado_em', 'contrato_id']);

// Contratada apagada deixa uma lápide, para a janela de 3 dias da coleta não a trazer de volta.
// A lápide some sozinha depois do maior recuo possível da coleta (120 dias) com folga.
const LAPIDE = '_ignorado:';
const LAPIDE_TTL = 150 * 86400;

// Limpeza
const ABERTA_ENCERRADA_DIAS = 60;
const CONTRATADA_DIAS = 180;
const LIMPEZA_MAX = 200; // apagamentos por chamada

function mudou(nova, antiga) {
  for (const k of Object.keys(nova)) {
    if (NAO_COMPARA.has(k)) continue;
    if (JSON.stringify(nova[k] ?? null) !== JSON.stringify(antiga[k] ?? null)) return true;
  }
  return false;
}

export async function coletarLicitacoes(request, env, json) {
  let corpo;
  try { corpo = await request.json(); } catch { return json({ error: 'corpo inválido' }, 400); }
  const recebidas = Array.isArray(corpo?.licitacoes) ? corpo.licitacoes.filter(l => l && typeof l.id === 'string' && /^pncpc?-/.test(l.id)) : null;
  if (!recebidas) return json({ error: 'envie { licitacoes: [...] }' }, 400);
  if (recebidas.length > LOTE_MAX) return json({ error: `mande no máximo ${LOTE_MAX} por pedido` }, 413);

  const contratadas = recebidas.filter(l => l.fase === 'contratada');
  const [existentes, lapides] = await Promise.all([
    Promise.all(recebidas.map(l => env.LICITACOES.get(l.id, 'json'))),
    Promise.all(contratadas.map(l => env.LICITACOES.get(LAPIDE + l.id))),
  ]);
  const apagadas = new Set(contratadas.filter((_, i) => lapides[i] !== null).map(l => l.id));

  const agora = new Date().toISOString();
  let novas = 0, alteradas = 0, iguais = 0;
  for (const [i, l] of recebidas.entries()) {
    if (apagadas.has(l.id)) continue;
    const antiga = existentes[i];
    if (antiga && !mudou(l, antiga)) { iguais++; continue; }
    const gravar = { ...l, visto_em: agora };
    if (antiga) {
      for (const k of DO_PAINEL) if (antiga[k] !== undefined) gravar[k] = antiga[k];
      if (antiga.contrato_id) gravar.contrato_id = antiga.contrato_id;
      alteradas++;
    } else novas++;
    await env.LICITACOES.put(l.id, JSON.stringify(gravar));
  }

  // Contrato de uma licitação que já estava no Radar: a aberta passa a apontar para ele.
  for (const l of contratadas) {
    if (!l.licitacao_id || apagadas.has(l.id)) continue;
    const aberta = await env.LICITACOES.get(l.licitacao_id, 'json');
    if (aberta && aberta.contrato_id !== l.id) await env.LICITACOES.put(aberta.id, JSON.stringify({ ...aberta, contrato_id: l.id }));
  }
  return json({ recebidas: recebidas.length, novas, alteradas, iguais, ignoradas: apagadas.size });
}

const diasDesde = data => (data ? (Date.now() - new Date(String(data).slice(0, 10) + 'T12:00:00Z').getTime()) / 86400000 : null);

/** O que sai na limpeza (puro, para teste). Itens em curso (contato, parceria, participando) ficam sempre. */
export function paraApagar(itens) {
  return itens.filter(l => {
    if (EM_CURSO.has(l.status_interno)) return false;
    if (l.fase === 'contratada') {
      if (l.status_interno === 'descartado') return true;
      const idade = diasDesde(l.assinatura || l.publicado_em);
      return idade !== null && idade > CONTRATADA_DIAS;
    }
    const encerrada = diasDesde(l.encerramento);
    return encerrada !== null && encerrada > ABERTA_ENCERRADA_DIAS;
  });
}

/** POST /api/manutencao/limpar-licitacoes — lê a cópia da lista (1 leitura) e apaga o que não serve mais. */
export async function limparLicitacoes(env, json) {
  const copia = await env.LICITACOES.get('_lista', 'json');
  if (!copia?.itens) return json({ apagadas: 0, motivo: 'sem cópia da lista ainda' });
  const alvos = paraApagar(Object.values(copia.itens)).slice(0, LIMPEZA_MAX);
  const agora = new Date().toISOString();
  for (const l of alvos) {
    if (l.fase === 'contratada') await env.LICITACOES.put(LAPIDE + l.id, agora, { expirationTtl: LAPIDE_TTL });
    await env.LICITACOES.delete(l.id);
  }
  return json({ apagadas: alvos.length });
}

export async function patchLicitacao(request, env, id, json) {
  const existente = await env.LICITACOES.get(id, 'json');
  if (!existente) return json({ error: 'licitação não encontrada' }, 404);
  let corpo;
  try { corpo = await request.json(); } catch { return json({ error: 'corpo inválido' }, 400); }
  if (!corpo || typeof corpo !== 'object') return json({ error: 'corpo inválido' }, 400);

  const atualizado = { ...existente };
  if ('status_interno' in corpo) {
    const validas = situacoesDe(existente);
    if (!validas.includes(corpo.status_interno)) {
      return json({ error: `status_interno: use um de ${validas.join(', ')}` }, 400);
    }
    atualizado.status_interno = corpo.status_interno;
  }
  if ('observacoes' in corpo) {
    const o = corpo.observacoes;
    if (o !== null && typeof o !== 'string') return json({ error: 'observacoes: esperado texto' }, 400);
    const t = (o || '').replace(/\r\n/g, '\n').trim();
    if (t.length > 4000) return json({ error: 'observações maiores que 4000 caracteres' }, 400);
    atualizado.observacoes = t || null;
  }
  if (!('status_interno' in corpo) && !('observacoes' in corpo)) {
    return json({ error: 'nada pra atualizar — envie status_interno e/ou observacoes' }, 400);
  }
  atualizado.atualizado_em = new Date().toISOString();
  await env.LICITACOES.put(id, JSON.stringify(atualizado));
  return json(atualizado);
}
