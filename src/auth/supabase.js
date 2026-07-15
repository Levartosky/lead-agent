const { createClient } = require('@supabase/supabase-js');

const url        = process.env.SUPABASE_URL;
const anonKey    = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const configurado = !!(url && anonKey && serviceKey);

// Cliente com anon key: usado só para validar o JWT do usuário (auth.getUser)
const supabaseAuth = configurado
  ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// Cliente com service_role: ignora RLS — uso exclusivo do backend
const supabaseAdmin = configurado
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

module.exports = { configurado, supabaseAuth, supabaseAdmin };
