// Schemas de validação de entrada (história 4.2). Mantidos separados das
// rotas para poderem ser testados sem precisar subir o servidor Express.

const { z } = require('zod');

const iniciarBodySchema = z.object({
  nicho: z.string().trim().min(2, 'Nicho deve ter ao menos 2 caracteres.').max(100),
  regiao: z.string().trim().min(2, 'Região deve ter ao menos 2 caracteres.').max(100),
  quantidade: z.coerce.number({ message: 'Quantidade deve ser um número.' })
    .int('Quantidade deve ser um número inteiro.')
    .min(1, 'Quantidade deve ser no mínimo 1.')
    .max(1000, 'Quantidade deve ser no máximo 1000.'),
  modo: z.enum(['agente', 'rpa', 'receita'], { message: 'Modo deve ser agente, rpa ou receita.' })
    .default('agente'),
});

// Formato gerado em server.js: `s_${Date.now()}_${random}`
const sessionIdParamSchema = z.object({
  id: z.string().regex(/^s_\d+_[a-z0-9]+$/, 'Identificador de sessão inválido.'),
});

module.exports = { iniciarBodySchema, sessionIdParamSchema };
