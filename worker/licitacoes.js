// Aba Licitações: recebe a coleta do PNCP e guarda a decisão do painel. Ver LICITACOES.md.
//
// Uma licitação coletada de novo mantém a situação, as observações e a data da primeira coleta;
// o resto (prazo, valor, objeto) vem sempre do PNCP, que é a fonte oficial e pode ser retificado.

export const SITUACOES_LICITACAO = ['monitorando', 'acompanhando', 'participando', 'descartado'];
// Contratadas (contrato de obra assinado): a pista é a construtora vencedora.
export const SITUACOES_CONTRATADA = ['monitorando', 'contatado', 'parceria', 'descartado'];
const situacoesDe = item => (item.fase === 'contratada' ? SITUACOES_CONTRATADA : SITUACOES_LICITACAO);

const DO_PAINEL = ['status_interno', 'observacoes', 'coletado_em'];

export async function coletarLicitacoes(request, env, json) {
  let corpo;
  try { corpo = await request.json(); } catch { return json({ error: 'corpo inválido' }, 400); }
  const recebidas = Array.isArray(corpo?.licitacoes) ? corpo.licitacoes.filter(l => l && typeof l.id === 'string' && /^pncpc?-/.test(l.id)) : null;
  if (!recebidas) return json({ error: 'envie { licitacoes: [...] }' }, 400);

  const existentes = await Promise.all(recebidas.map(l => env.LICITACOES.get(l.id, 'json')));
  const agora = new Date().toISOString();
  for (const [i, l] of recebidas.entries()) {
    const antiga = existentes[i];
    const gravar = { ...l, visto_em: agora };
    if (antiga) for (const k of DO_PAINEL) if (antiga[k] !== undefined) gravar[k] = antiga[k];
    if (antiga?.contrato_id) gravar.contrato_id = antiga.contrato_id;
    await env.LICITACOES.put(l.id, JSON.stringify(gravar));
  }
  // Contrato de uma licitação que já estava no Radar: a aberta passa a apontar para ele.
  for (const l of recebidas) {
    if (l.fase !== 'contratada' || !l.licitacao_id) continue;
    const aberta = await env.LICITACOES.get(l.licitacao_id, 'json');
    if (aberta && aberta.contrato_id !== l.id) await env.LICITACOES.put(aberta.id, JSON.stringify({ ...aberta, contrato_id: l.id }));
  }
  return json({ recebidas: recebidas.length, novas: recebidas.length - existentes.filter(Boolean).length });
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
