// Radar Odisse — Cloudflare Worker
//
// Bindings esperados (configurar em wrangler.toml / painel Cloudflare):
//   - KV Namespace `CONCURSOS`       -> id -> Concurso (JSON)
//   - KV Namespace `REVISAO`         -> id -> { candidato_existente, candidato_novo, motivo, criado_em }
//   - KV Namespace `OPORTUNIDADES`   -> id -> Oportunidade (JSON) — aba Terrenos
//   - KV Namespace `CORRETORES`      -> id -> Corretor (JSON) — aba Terrenos
//   - Variável de ambiente `COLLECT_SECRET` -> string compartilhada com o GitHub Actions
//
// Rotas:
//   GET  /api/concursos        -> lista todos os Concursos (usado pelo front-end estático)
//   GET  /api/revisao          -> lista pendências de revisão manual (fase 2 da UI)
//   POST /api/collect          -> recebe candidatos brutos de um parser de Concurso (Authorization: Bearer <secret>)
//   GET  /api/oportunidades    -> lista todas as Oportunidades (Terrenos)
//   GET  /api/corretores       -> lista todos os Corretores (Terrenos)
//   POST /api/collect-terrenos -> recebe { oportunidades, corretoresCandidatos } de um parser de Terrenos

import { classificarConcursos } from './dedup.js';
import { processarCandidatosCorretor } from './dedup-terrenos.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function listAll(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ cursor });
    for (const key of page.keys) {
      const value = await kv.get(key.name, 'json');
      if (value) out.push(value);
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}

async function handleCollect(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${env.COLLECT_SECRET}`) {
    return json({ error: 'não autorizado' }, 401);
  }

  const candidatos = await request.json();
  if (!Array.isArray(candidatos)) {
    return json({ error: 'payload deve ser um array de Concursos' }, 400);
  }

  const existentes = await listAll(env.CONCURSOS);
  const resultado = classificarConcursos(existentes, candidatos);

  // Aplica fusões automáticas
  for (const item of resultado.fundidos) {
    await env.CONCURSOS.put(item.id, JSON.stringify(item));
  }

  // Novos concursos (sem correspondência) entram direto
  for (const item of resultado.novos) {
    await env.CONCURSOS.put(item.id, JSON.stringify(item));
  }

  // Conflitos vão pra fila de revisão manual, não sobrescrevem nada ainda
  for (const pendencia of resultado.pendentes_revisao) {
    const chave = `${pendencia.candidato_existente.id}__${pendencia.candidato_novo.id}`;
    await env.REVISAO.put(chave, JSON.stringify({ ...pendencia, criado_em: new Date().toISOString() }));
  }

  return json({
    fundidos: resultado.fundidos.length,
    novos: resultado.novos.length,
    pendentes_revisao: resultado.pendentes_revisao.length,
  });
}

async function handleCollectTerrenos(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${env.COLLECT_SECRET}`) {
    return json({ error: 'não autorizado' }, 401);
  }

  const payload = await request.json();
  const { oportunidades = [], corretoresCandidatos = [] } = payload || {};

  // 1. Processa candidatos a Corretor primeiro — oportunidades de persona
  // "corretor" (ex: YouTube) e o enriquecimento do ZAP dependem dos ids
  // resultantes pra preencher corretor_vinculado_id.
  const corretoresExistentes = await listAll(env.CORRETORES);
  const corretoresAtualizados = processarCandidatosCorretor(corretoresExistentes, corretoresCandidatos);

  for (const corretor of corretoresAtualizados.values()) {
    await env.CORRETORES.put(corretor.id, JSON.stringify(corretor));
  }

  // 2. Grava as Oportunidades (sem dedup entre fontes por ora — cada fonte
  // gera seu próprio id; ver TERRENOS.md, não havia decisão de dedup entre
  // fontes de terrenista igual à de Concurso).
  for (const op of oportunidades) {
    await env.OPORTUNIDADES.put(op.id, JSON.stringify(op));
  }

  return json({
    oportunidades_gravadas: oportunidades.length,
    corretores_atualizados: corretoresAtualizados.size,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === 'GET' && url.pathname === '/api/concursos') {
      return json(await listAll(env.CONCURSOS));
    }

    if (request.method === 'GET' && url.pathname === '/api/revisao') {
      return json(await listAll(env.REVISAO));
    }

    if (request.method === 'POST' && url.pathname === '/api/collect') {
      return handleCollect(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/oportunidades') {
      return json(await listAll(env.OPORTUNIDADES));
    }

    if (request.method === 'GET' && url.pathname === '/api/corretores') {
      return json(await listAll(env.CORRETORES));
    }

    if (request.method === 'POST' && url.pathname === '/api/collect-terrenos') {
      return handleCollectTerrenos(request, env);
    }

    return json({ error: 'não encontrado' }, 404);
  },
};
