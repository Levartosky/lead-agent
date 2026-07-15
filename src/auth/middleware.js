const { configurado, supabaseAuth, supabaseAdmin } = require('./supabase');

/**
 * Exige JWT válido do Supabase em toda rota /api/* (história 0.3).
 * Token via header `Authorization: Bearer <jwt>` ou, para SSE/download
 * (EventSource e location.href não enviam headers), via query `?token=`.
 * Injeta req.usuario = { id, email, role } para as camadas seguintes.
 */
async function autenticar(req, res, next) {
  if (!configurado) {
    return res.status(503).json({ erro: 'Supabase não configurado no servidor — preencha SUPABASE_* no .env.' });
  }

  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ erro: 'Não autenticado.' });

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
  }

  const { data: perfil } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();

  req.usuario = {
    id:    data.user.id,
    email: data.user.email,
    role:  perfil?.role ?? 'user',
  };
  next();
}

/** Guard reutilizável para as rotas do painel admin (usar após autenticar). */
function exigirAdmin(req, res, next) {
  if (req.usuario?.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
  }
  next();
}

/** Saldo de créditos do usuário (sum(delta) do credit_ledger). */
async function saldoCreditos(userId) {
  const { data, error } = await supabaseAdmin.rpc('saldo_creditos', { uid: userId });
  if (error) throw new Error(`Falha ao consultar saldo: ${error.message}`);
  return data ?? 0;
}

module.exports = { autenticar, exigirAdmin, saldoCreditos };
