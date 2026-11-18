// ==========================================================================
// Autenticação do Radar — mesmo molde das outras ferramentas do Odisse (vendas, projetos).
// A senha é conferida pelo Worker (secret RADAR_SENHA), não pelo navegador. Depois de entrar,
// fica lembrada neste computador (localStorage) e vai em cada chamada ao Worker (cabeçalho
// Authorization, posto por js/comum.js). Sem a senha certa, o Worker não entrega nem grava nada.
// ==========================================================================

const AUTH_WORKER = 'https://radar-odisse.reservaprojectbasework.workers.dev';
const AUTH_FLAG_KEY = 'odisse-auth-ok';
const AUTH_NAME_KEY = 'odisse-auth-nome';
const AUTH_SENHA_KEY = 'odisse-senha';

function getSenha() {
  try { return localStorage.getItem(AUTH_SENHA_KEY) || ''; } catch (_) { return ''; }
}

// Pergunta ao Worker se a senha está certa: 'ok', 'senha' (incorreta) ou 'rede'.
async function conferirSenha(senha) {
  try {
    const res = await fetch(`${AUTH_WORKER}/estado`, { headers: { Authorization: `Bearer ${senha}` } });
    if (res.ok) return 'ok';
    if (res.status === 401) return 'senha';
    return 'rede';
  } catch (_) {
    return 'rede';
  }
}

function isAuthenticated() {
  try { return localStorage.getItem(AUTH_FLAG_KEY) === 'ok' && !!getSenha(); } catch (_) { return false; }
}

function getUserName() {
  try { return localStorage.getItem(AUTH_NAME_KEY) || ''; } catch (_) { return ''; }
}

function setAuthenticated(nome, senha) {
  localStorage.setItem(AUTH_FLAG_KEY, 'ok');
  localStorage.setItem(AUTH_SENHA_KEY, senha);
  localStorage.setItem(AUTH_NAME_KEY, nome || '');
}

function logout() {
  for (const k of [AUTH_FLAG_KEY, AUTH_NAME_KEY, AUTH_SENHA_KEY]) localStorage.removeItem(k);
  // dados guardados para abrir as páginas mais rápido (ver carregarComCache em comum.js)
  try { Object.keys(localStorage).filter(k => k.startsWith('radar:dados:')).forEach(k => localStorage.removeItem(k)); } catch (_) { /* sem armazenamento */ }
}

// A API recusou a senha (trocada no servidor, por exemplo): sai e volta ao login.
function senhaRecusada() {
  logout();
  irParaLogin();
}

// Leva ao login guardando a página atual, para voltar a ela depois de entrar.
function irParaLogin() {
  const aqui = location.pathname + location.hash;
  location.href = '/login' + (aqui && !aqui.startsWith('/login') ? '?volta=' + encodeURIComponent(aqui) : '');
}

// Página para onde voltar depois do login (só páginas deste site).
function paginaDeVolta() {
  const v = new URLSearchParams(location.search).get('volta') || '';
  return /^\/[a-z-]*(\.html)?(#[\w-]*)?$/i.test(v) && !v.startsWith('/login') ? v : '/';
}

// Chame no topo de qualquer página que exija acesso.
function exigirAutenticacao() {
  if (!isAuthenticated()) irParaLogin();
}
