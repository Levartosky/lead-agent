/* Sessão Supabase compartilhada entre as páginas.
   Requer <script src="/config.js"> e <script src="/vendor/supabase.js"> antes deste. */

const sb = (window.__ENV?.SUPABASE_URL && window.__ENV?.SUPABASE_ANON_KEY)
  ? window.supabase.createClient(window.__ENV.SUPABASE_URL, window.__ENV.SUPABASE_ANON_KEY)
  : null;

function supabaseDisponivel() { return !!sb; }

async function sessaoAtual() {
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

/* Redireciona para o login se não houver sessão. Retorna a sessão (ou null). */
async function exigirSessao() {
  const session = await sessaoAtual();
  if (!session) { window.location.href = '/login.html'; return null; }
  return session;
}

/* Access token vigente — o supabase-js renova sozinho quando expira. */
async function tokenAtual() {
  const session = await sessaoAtual();
  return session?.access_token ?? null;
}

/* fetch com Authorization: Bearer; 401 → volta para o login. */
async function authFetch(url, opts = {}) {
  const token = await tokenAtual();
  if (!token) { window.location.href = '/login.html'; throw new Error('Sem sessão'); }
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('Sessão expirada'); }
  return res;
}

/* Logout: limpa a sessão e volta para o login (história 1.2). */
async function sair() {
  if (sb) await sb.auth.signOut();
  window.location.href = '/login.html';
}
