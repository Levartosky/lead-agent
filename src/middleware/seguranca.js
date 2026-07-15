// Hardening HTTP básico (história 4.1): headers de segurança, CORS restrito,
// e rate limit global por IP como primeira barreira contra abuso.

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Em produção, definir APP_ORIGIN=https://seu-dominio.com no .env. Sem essa
// variável, assume o dev local (mesma origem do `npm run web`).
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:3000';

const corsMiddleware = cors({
  origin: APP_ORIGIN,
  methods: ['GET', 'POST'],
});

// Primeira barreira: limite grosso por IP nas rotas de API. Limites mais
// finos por usuário autenticado ficam para a história 4.3 (depende de auth).
const limiteApi = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde um minuto e tente novamente.' },
});

module.exports = { helmetMiddleware: helmet(), corsMiddleware, limiteApi, APP_ORIGIN };
