require('dotenv').config();
const express = require('express');
const path    = require('path');
const { executarAgente }  = require('./agent');
const { executarRPA }     = require('./rpa');
const { executarReceita } = require('./executor-receita');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Sessões ativas: guardam eventos emitidos e clientes SSE conectados
const sessoes = new Map();

/* ── POST /api/iniciar ── inicia o agente ou RPA e retorna sessionId */
app.post('/api/iniciar', (req, res) => {
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

  const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sessoes.set(sessionId, { eventos: [], clientes: new Set(), arquivo: null });

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

  executor(nicho.trim(), regiao.trim(), qty, emit)
    .then(resultado => {
      const sessao = sessoes.get(sessionId);
      if (sessao && resultado?.arquivo) sessao.arquivo = resultado.arquivo;
      emit('fim', { totalLeads: resultado?.totalLeads ?? 0, arquivo: resultado?.arquivo ?? null });
    })
    .catch(err => {
      emit('erro', { mensagem: err.message });
    });
});

/* ── GET /api/eventos/:id ── stream SSE */
app.get('/api/eventos/:id', (req, res) => {
  const sessao = sessoes.get(req.params.id);
  if (!sessao) return res.status(404).end();

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

/* ── GET /api/download/:id ── baixa o Excel gerado */
app.get('/api/download/:id', (req, res) => {
  const sessao = sessoes.get(req.params.id);
  if (!sessao?.arquivo) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  res.download(sessao.arquivo);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Interface web disponível em: http://localhost:${PORT}\n`);
});
