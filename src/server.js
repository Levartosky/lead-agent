require('dotenv').config();
const express = require('express');
const path    = require('path');
const { executarAgente }  = require('./agent');
const { executarRPA }     = require('./rpa');
const { executarReceita } = require('./executor-receita');
const { autenticar, exigirAdmin, saldoCreditos } = require('./auth/middleware');
const { supabaseAdmin, configurado } = require('./auth/supabase');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

/* ── Rotas públicas (sem login) ─────────────────────────────────────────── */

// Config do frontend: expõe apenas URL + anon key (segura para o navegador)
app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(
    `window.__ENV = ${JSON.stringify({
      SUPABASE_URL:      process.env.SUPABASE_URL || '',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
    })};`
  );
});

// supabase-js servido localmente (sem depender de CDN)
app.get('/vendor/supabase.js', (_req, res) => {
  res.sendFile(require.resolve('@supabase/supabase-js/dist/umd/supabase.js'));
});

/* ── Daqui para baixo, toda rota /api/* exige JWT válido (história 0.3) ── */
app.use('/api', autenticar);

// Sessões ativas: guardam eventos emitidos e clientes SSE conectados
const sessoes = new Map();

/* ── GET /api/me ── dados da conta: plano, saldo, papel */
app.get('/api/me', async (req, res) => {
  try {
    const [{ data: perfil }, saldo] = await Promise.all([
      supabaseAdmin.from('profiles').select('email, role, criado_em, termos_aceitos_em').eq('id', req.usuario.id).single(),
      saldoCreditos(req.usuario.id),
    ]);
    res.json({
      id:        req.usuario.id,
      email:     perfil?.email ?? req.usuario.email,
      role:      req.usuario.role,
      criadoEm:  perfil?.criado_em ?? null,
      saldo,
      plano:     saldo > 0 ? 'premium' : 'free',
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/* ── POST /api/iniciar ── inicia o agente ou RPA e retorna sessionId */
app.post('/api/iniciar', async (req, res) => {
  const { nicho, regiao, quantidade, modo = 'agente' } = req.body;

  if (!nicho?.trim() || !regiao?.trim() || !quantidade) {
    return res.status(400).json({ erro: 'Preencha todos os campos.' });
  }

  const qty = parseInt(quantidade, 10);
  if (isNaN(qty) || qty < 1 || qty > 1000) {
    return res.status(400).json({ erro: 'Quantidade deve ser entre 1 e 1000.' });
  }

  if (modo === 'agente' && (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'sua_chave_aqui')) {
    return res.status(400).json({ erro: 'ANTHROPIC_API_KEY não configurada no .env — use o modo RPA.' });
  }

  // Regra de negócio no backend (história 1.4): free (saldo 0) não gera leads;
  // premium gera até o limite do saldo.
  let saldo;
  try {
    saldo = await saldoCreditos(req.usuario.id);
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
  if (saldo <= 0) {
    return res.status(403).json({ erro: 'Você está sem créditos. Compre um pacote para gerar leads.', saldo });
  }
  if (qty > saldo) {
    return res.status(403).json({ erro: `Saldo insuficiente: você tem ${saldo} crédito(s) e pediu ${qty} lead(s).`, saldo });
  }

  // Registra a busca no histórico (tabela searches)
  let searchId = null;
  try {
    const { data } = await supabaseAdmin
      .from('searches')
      .insert({ user_id: req.usuario.id, nicho: nicho.trim(), regiao: regiao.trim(), qtd_solicitada: qty })
      .select('id')
      .single();
    searchId = data?.id ?? null;
  } catch { /* histórico não pode derrubar a busca */ }

  const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sessoes.set(sessionId, { eventos: [], clientes: new Set(), arquivo: null, userId: req.usuario.id });

  res.json({ sessionId });

  const emit = (tipo, dados) => {
    const sessao = sessoes.get(sessionId);
    if (!sessao) return;
    const evento  = { tipo, dados, ts: Date.now() };
    sessao.eventos.push(evento);
    const payload = `data: ${JSON.stringify(evento)}\n\n`;
    sessao.clientes.forEach(c => { try { c.write(payload); } catch {} });
  };

  const executor = modo === 'receita' ? executarReceita
                 : modo === 'rpa'     ? executarRPA
                 : executarAgente;

  const atualizarBusca = (campos) => {
    if (!searchId) return;
    supabaseAdmin.from('searches').update(campos).eq('id', searchId).then(() => {}, () => {});
  };

  executor(nicho.trim(), regiao.trim(), qty, emit)
    .then(resultado => {
      const sessao = sessoes.get(sessionId);
      if (sessao && resultado?.arquivo) sessao.arquivo = resultado.arquivo;
      atualizarBusca({ status: 'concluida', qtd_entregue: resultado?.totalLeads ?? 0, arquivo: resultado?.arquivo ?? null });
      emit('fim', { totalLeads: resultado?.totalLeads ?? 0, arquivo: resultado?.arquivo ?? null });
    })
    .catch(err => {
      atualizarBusca({ status: 'erro' });
      emit('erro', { mensagem: err.message });
    });
});

/* ── GET /api/eventos/:id ── stream SSE (token via ?token=) */
app.get('/api/eventos/:id', (req, res) => {
  const sessao = sessoes.get(req.params.id);
  if (!sessao || sessao.userId !== req.usuario.id) return res.status(404).end();

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Reenvia eventos já emitidos (para reconexão ou page reload)
  sessao.eventos.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  sessao.clientes.add(res);

  req.on('close', () => sessao.clientes.delete(res));
});

/* ── GET /api/download/:id ── baixa o Excel gerado (token via ?token=) */
app.get('/api/download/:id', (req, res) => {
  const sessao = sessoes.get(req.params.id);
  if (!sessao || sessao.userId !== req.usuario.id || !sessao.arquivo) {
    return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  }
  res.download(sessao.arquivo);
});

/* ── Rotas do painel admin (guard reutilizável — história 0.3) ── */
app.get('/api/admin/ping', exigirAdmin, (req, res) => {
  res.json({ ok: true, admin: req.usuario.email });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Interface web disponível em: http://localhost:${PORT}\n`);
  if (!configurado) {
    console.warn('⚠️  SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY ausentes no .env — as rotas /api responderão 503. Veja supabase/README.md.');
  }
});
