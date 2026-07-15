// Middleware genérico de validação (história 4.2): valida req[fonte] contra
// um schema zod. Em caso de erro, responde 400 com uma mensagem por campo.
// Em caso de sucesso, substitui req[fonte] pelos dados já validados/coagidos
// (ex.: "quantidade" como string vira number).

function validar(schema, fonte = 'body') {
  return (req, res, next) => {
    const resultado = schema.safeParse(req[fonte]);

    if (!resultado.success) {
      const erros = resultado.error.issues.map(issue => ({
        campo: issue.path.join('.') || fonte,
        mensagem: issue.message,
      }));
      return res.status(400).json({ erro: 'Dados inválidos.', detalhes: erros });
    }

    req[fonte] = resultado.data;
    next();
  };
}

module.exports = { validar };
