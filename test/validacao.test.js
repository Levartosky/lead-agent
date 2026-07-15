const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciarBodySchema, sessionIdParamSchema } = require('../src/validation/schemas');
const { validar } = require('../src/middleware/validar');

test('iniciarBodySchema aceita um corpo válido e coage quantidade para número', () => {
  const r = iniciarBodySchema.safeParse({ nicho: 'dentista', regiao: 'Sao Paulo SP', quantidade: '50', modo: 'receita' });
  assert.equal(r.success, true);
  assert.equal(r.data.quantidade, 50);
  assert.equal(typeof r.data.quantidade, 'number');
});

test('iniciarBodySchema usa "agente" como modo padrão quando omitido', () => {
  const r = iniciarBodySchema.safeParse({ nicho: 'dentista', regiao: 'Sao Paulo SP', quantidade: 10 });
  assert.equal(r.success, true);
  assert.equal(r.data.modo, 'agente');
});

test('iniciarBodySchema rejeita nicho vazio ou muito curto', () => {
  const r = iniciarBodySchema.safeParse({ nicho: 'a', regiao: 'Sao Paulo SP', quantidade: 10 });
  assert.equal(r.success, false);
});

test('iniciarBodySchema rejeita quantidade fora do intervalo 1-1000', () => {
  assert.equal(iniciarBodySchema.safeParse({ nicho: 'dentista', regiao: 'SP', quantidade: 0 }).success, false);
  assert.equal(iniciarBodySchema.safeParse({ nicho: 'dentista', regiao: 'SP', quantidade: 1001 }).success, false);
  assert.equal(iniciarBodySchema.safeParse({ nicho: 'dentista', regiao: 'SP', quantidade: 'abc' }).success, false);
});

test('iniciarBodySchema rejeita modo desconhecido', () => {
  const r = iniciarBodySchema.safeParse({ nicho: 'dentista', regiao: 'SP', quantidade: 10, modo: 'hackeado' });
  assert.equal(r.success, false);
});

test('sessionIdParamSchema aceita o formato gerado pelo servidor', () => {
  assert.equal(sessionIdParamSchema.safeParse({ id: 's_1234567890_ab3xz' }).success, true);
});

test('sessionIdParamSchema rejeita formatos estranhos (ex.: tentativa de path traversal)', () => {
  assert.equal(sessionIdParamSchema.safeParse({ id: '../../etc/passwd' }).success, false);
  assert.equal(sessionIdParamSchema.safeParse({ id: '' }).success, false);
});

test('middleware validar() chama next() e substitui req.body em caso de sucesso', () => {
  const req = { body: { nicho: 'dentista', regiao: 'Sao Paulo SP', quantidade: '10' } };
  let chamouNext = false;
  const res = { status() { return this; }, json() {} };

  validar(iniciarBodySchema, 'body')(req, res, () => { chamouNext = true; });

  assert.equal(chamouNext, true);
  assert.equal(req.body.quantidade, 10);
});

test('middleware validar() responde 400 com detalhes por campo em caso de erro', () => {
  const req = { body: { nicho: 'a', regiao: '', quantidade: -5 } };
  let statusCode = null;
  let corpo = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { corpo = payload; },
  };

  validar(iniciarBodySchema, 'body')(req, res, () => assert.fail('next() não deveria ser chamado'));

  assert.equal(statusCode, 400);
  assert.ok(Array.isArray(corpo.detalhes));
  assert.ok(corpo.detalhes.length > 0);
});
