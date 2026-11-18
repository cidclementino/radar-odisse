// Radar Odisse — leitura do site oficial pelo navegador (páginas de Concursos e Acompanhamento)
//
// O Worker só repassa o HTML (GET /api/concursos/:id/site, restrito ao domínio do link oficial);
// quem lê é js/extrair-site.js, aqui no navegador. O resultado vai para `acompanhamento` e os campos
// vazios do concurso (banner, prazos) são preenchidos — nada que já existe é trocado.

const lendoSite = new Set();

async function baixarDoSite(id, url) {
  const res = await fetch(`${WORKER}/api/concursos/${encodeURIComponent(id)}/site?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}));
    throw new Error(corpo.error || `o site respondeu ${res.headers.get('X-Site-Status') || res.status}`);
  }
  return { html: await res.text(), url: res.headers.get('X-Site-Url') || url };
}

/** lê o site oficial do concurso, grava no Worker e devolve o concurso atualizado */
async function lerSiteOficial(c) {
  if (lendoSite.has(c.id)) return null;
  lendoSite.add(c.id);
  try {
    let site = null;
    let erro = null;
    const link = c.link_oficial || c.fonte_url_original;
    if (!link) {
      erro = 'o concurso não tem link oficial';
    } else {
      try {
        const principal = await baixarDoSite(c.id, link);
        const r = ExtrairSite.extrairSite(principal.html, principal.url);
        const outras = await Promise.all((r.relacionadas || []).slice(0, 3).map(u =>
          baixarDoSite(c.id, u).then(p => ExtrairSite.extrairSite(p.html, p.url)).catch(() => null)));
        site = ExtrairSite.juntar([r, ...outras]);
      } catch (err) {
        erro = err.message;
      }
    }
    const p = ExtrairSite.palpites(site);
    const res = await fetch(`${WORKER}/api/concursos/${encodeURIComponent(c.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acompanhamento: { ...(c.acompanhamento || {}), site, erro, lido_em: new Date().toISOString() },
        completar: { imagem_url: p.imagem_url, inscricao_fim: p.inscricao_fim, entrega_fim: p.entrega_fim, resultado_previsto: p.resultado_previsto },
      }),
    });
    if (!res.ok) throw new Error(`o Radar não gravou a leitura (${res.status})`);
    const atualizado = await res.json();
    // mantém a cópia guardada dos concursos em dia
    const cache = cacheLer('concursos');
    if (cache) {
      const i = cache.dados.findIndex(x => x.id === atualizado.id);
      if (i !== -1) { cache.dados[i] = atualizado; cacheGravar('concursos', cache.dados); }
    }
    return atualizado;
  } finally {
    lendoSite.delete(c.id);
  }
}
