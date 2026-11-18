// Edição manual da aba Terrenos: corretores e oportunidades (terrenos).
//
// A coleta nem sempre traz tudo, então o painel pode corrigir, completar e criar à mão.
// Todo campo mexido à mão entra em `campos_manuais` e a coleta deixa de mexer nele
// (inclusive quando foi esvaziado de propósito). Ver TERRENOS.md, "Edição manual".

import { normalizarTelefone, extrairCreci } from '../parsers/lib/contatos.js';

export const SITUACOES_OPORTUNIDADE = ['monitorando', 'descartado', 'no_funil'];
export const SITUACOES_CORRETOR = ['ativo', 'descartado'];

class Invalido extends Error {}

const texto = (v, max = 300) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new Invalido('esperado texto');
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length > max) throw new Invalido(`texto maior que ${max} caracteres`);
  return t || null;
};

const textoLongo = v => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new Invalido('esperado texto');
  const t = v.replace(/\r\n/g, '\n').trim();
  if (t.length > 4000) throw new Invalido('observações maiores que 4000 caracteres');
  return t || null;
};

const telefone = v => {
  const t = texto(v, 40);
  if (!t) return null;
  const n = normalizarTelefone(t);
  if (!n) throw new Invalido('telefone não reconhecido — use DDD + número');
  return n;
};

const instagram = v => {
  const t = texto(v, 120);
  if (!t) return null;
  const m = t.match(/instagram\.com\/([A-Za-z0-9_.]{1,30})/i);
  const perfil = (m ? m[1] : t.replace(/^@/, '')).replace(/\.+$/, '').toLowerCase();
  if (!/^[a-z0-9_.]{1,30}$/.test(perfil)) throw new Invalido('perfil do Instagram inválido');
  return perfil;
};

const email = v => {
  const t = texto(v, 200);
  if (!t) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) throw new Invalido('e-mail inválido');
  return t.toLowerCase();
};

const creci = v => {
  const t = texto(v, 40);
  if (!t) return null;
  // aceita "PB-12345", "12345", "CRECI-PB 1234 J"…; guarda no mesmo formato da coleta
  return extrairCreci(/creci/i.test(t) ? t : `CRECI ${t.replace(/-/g, ' ')}`) || t.toUpperCase();
};

const nivel = v => {
  const n = Number(v);
  if (![1, 2, 3].includes(n)) throw new Invalido('nível deve ser 1, 2 ou 3');
  return n;
};

const regioes = v => {
  if (v === null || v === undefined) return [];
  const lista = Array.isArray(v) ? v : String(v).split(',');
  return [...new Set(lista.map(r => texto(String(r), 80)).filter(Boolean))];
};

const link = v => {
  const t = texto(v, 1000);
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) throw new Invalido('link deve começar com http:// ou https://');
  return t;
};

const umDe = lista => v => {
  if (!lista.includes(v)) throw new Invalido(`use um de: ${lista.join(', ')}`);
  return v;
};

const CAMPOS_CORRETOR = {
  nome: v => texto(v, 200),
  empresa: v => texto(v, 200),
  creci,
  whatsapp: telefone,
  telefone,
  instagram,
  email,
  regioes_atuacao: regioes,
  nivel_maturidade: nivel,
  observacoes: textoLongo,
  status_interno: umDe(SITUACOES_CORRETOR),
};

const CAMPOS_OPORTUNIDADE = {
  titulo: v => texto(v, 300),
  local: v => texto(v, 200),
  persona: umDe(['terrenista', 'corretor']),
  categoria: umDe(['terreno', 'imovel']),
  nivel_maturidade: nivel,
  link_original: link,
  observacoes: textoLongo,
  status_interno: umDe(SITUACOES_OPORTUNIDADE),
  corretor_vinculado_id: v => texto(v, 100),
};

// Situação e observações são do painel por natureza; não precisam de marca.
const SEM_MARCA = new Set(['status_interno', 'observacoes']);

/** Aplica os campos enviados; devolve { valores, erro }. */
function validar(corpo, campos) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { erro: 'corpo inválido — esperado JSON' };
  const valores = {};
  for (const [k, v] of Object.entries(corpo)) {
    if (!(k in campos)) continue;
    try {
      valores[k] = campos[k](v);
    } catch (err) {
      if (err instanceof Invalido) return { erro: `${k}: ${err.message}` };
      throw err;
    }
  }
  if (!Object.keys(valores).length) return { erro: `nada pra atualizar — campos aceitos: ${Object.keys(campos).join(', ')}` };
  return { valores };
}

function marcarManuais(registro, valores) {
  const manuais = new Set(registro.campos_manuais || []);
  for (const k of Object.keys(valores)) if (!SEM_MARCA.has(k)) manuais.add(k);
  return [...manuais];
}

async function lerCorpo(request) {
  try { return await request.json(); } catch { return null; }
}

/** Liga ou desliga uma oportunidade da lista de um corretor. */
async function ajustarVinculo(env, corretorId, oportunidadeId, ligar) {
  if (!corretorId) return null;
  const c = await env.CORRETORES.get(corretorId, 'json');
  if (!c) return null;
  const ligadas = new Set(c.oportunidades_vinculadas || []);
  if (ligar) ligadas.add(oportunidadeId); else ligadas.delete(oportunidadeId);
  const atualizado = { ...c, oportunidades_vinculadas: [...ligadas], atualizado_em: new Date().toISOString() };
  await env.CORRETORES.put(c.id, JSON.stringify(atualizado));
  return atualizado;
}

const idNovo = prefixo => `${prefixo}-${new Date().getFullYear()}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------- corretores

export async function patchCorretor(request, env, id, json) {
  const existente = await env.CORRETORES.get(id, 'json');
  if (!existente) return json({ error: 'corretor não encontrado' }, 404);
  const { valores, erro } = validar(await lerCorpo(request), CAMPOS_CORRETOR);
  if (erro) return json({ error: erro }, 400);
  if ('nome' in valores && !valores.nome) return json({ error: 'nome não pode ficar vazio' }, 400);

  const atualizado = {
    ...existente,
    ...valores,
    campos_manuais: marcarManuais(existente, valores),
    atualizado_em: new Date().toISOString(),
  };
  await env.CORRETORES.put(id, JSON.stringify(atualizado));
  return json(atualizado);
}

export async function criarCorretorManual(request, env, json) {
  const { valores, erro } = validar(await lerCorpo(request), CAMPOS_CORRETOR);
  if (erro) return json({ error: erro }, 400);
  if (!valores.nome) return json({ error: 'nome é obrigatório' }, 400);

  const agora = new Date().toISOString();
  const novo = {
    id: idNovo('corretor'),
    nome: valores.nome,
    empresa: null, creci: null, whatsapp: null, telefone: null, instagram: null, email: null,
    canal_id: null, canal_url: null, foto_url: null,
    regioes_atuacao: [],
    volume_zap: 0,
    descoberto_via: ['manual'],
    nivel_maturidade: 1,
    oportunidades_vinculadas: [],
    status_interno: 'ativo',
    ...valores,
    campos_manuais: marcarManuais({}, valores),
    criado_em: agora,
    atualizado_em: agora,
  };
  await env.CORRETORES.put(novo.id, JSON.stringify(novo));
  return json(novo, 201);
}

// ---------------------------------------------------------------- oportunidades (terrenos)

async function conferirCorretor(env, valores) {
  if (!valores.corretor_vinculado_id) return null;
  const c = await env.CORRETORES.get(valores.corretor_vinculado_id, 'json');
  return c ? null : 'corretor_vinculado_id: corretor não encontrado';
}

export async function patchOportunidade(request, env, id, json) {
  const existente = await env.OPORTUNIDADES.get(id, 'json');
  if (!existente) return json({ error: 'oportunidade não encontrada' }, 404);
  const { valores, erro } = validar(await lerCorpo(request), CAMPOS_OPORTUNIDADE);
  if (erro) return json({ error: erro }, 400);
  if ('titulo' in valores && !valores.titulo) return json({ error: 'título não pode ficar vazio' }, 400);
  const erroCorretor = await conferirCorretor(env, valores);
  if (erroCorretor) return json({ error: erroCorretor }, 400);

  const atualizado = {
    ...existente,
    ...valores,
    campos_manuais: marcarManuais(existente, valores),
    atualizado_em: new Date().toISOString(),
  };
  await env.OPORTUNIDADES.put(id, JSON.stringify(atualizado));

  // troca de corretor: ajusta a lista dos dois lados
  const corretores = [];
  if ('corretor_vinculado_id' in valores && valores.corretor_vinculado_id !== existente.corretor_vinculado_id) {
    const antigo = await ajustarVinculo(env, existente.corretor_vinculado_id, id, false);
    const novo = await ajustarVinculo(env, valores.corretor_vinculado_id, id, true);
    corretores.push(...[antigo, novo].filter(Boolean));
  }
  return json({ oportunidade: atualizado, corretores });
}

export async function criarOportunidadeManual(request, env, json) {
  const { valores, erro } = validar(await lerCorpo(request), CAMPOS_OPORTUNIDADE);
  if (erro) return json({ error: erro }, 400);
  if (!valores.titulo) return json({ error: 'título é obrigatório' }, 400);
  const erroCorretor = await conferirCorretor(env, valores);
  if (erroCorretor) return json({ error: erroCorretor }, 400);

  const agora = new Date().toISOString();
  const nova = {
    id: idNovo('manual'),
    persona: valores.corretor_vinculado_id ? 'corretor' : 'terrenista',
    categoria: 'terreno',
    fonte: 'manual',
    local: null,
    nivel_maturidade: 1,
    corretor_vinculado_id: null,
    link_original: null,
    texto_bruto: null,
    publicado_em: null,
    status_interno: 'monitorando',
    ...valores,
    campos_manuais: marcarManuais({}, valores),
    coletado_em: agora,
    atualizado_em: agora,
  };
  await env.OPORTUNIDADES.put(nova.id, JSON.stringify(nova));
  const corretor = await ajustarVinculo(env, nova.corretor_vinculado_id, nova.id, true);
  return json({ oportunidade: nova, corretores: corretor ? [corretor] : [] }, 201);
}
