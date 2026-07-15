const test = require('node:test');
const assert = require('node:assert/strict');
const { ehTelefoneValido, formatarEndereco } = require('../src/tools/receita');

test('rejeita os exemplos de telefone-lixo citados no backlog', () => {
  assert.equal(ehTelefoneValido('(11) 9999-9999'), false);
  assert.equal(ehTelefoneValido('(11) 0000-0000'), false);
});

test('rejeita qualquer dígito repetido no assinante, não só 9 e 0', () => {
  assert.equal(ehTelefoneValido('(11) 1111-1111'), false);
  assert.equal(ehTelefoneValido('(21) 55555-5555'), false);
});

test('aceita telefone com dígitos variados', () => {
  assert.equal(ehTelefoneValido('(11) 91234-5678'), true);
  assert.equal(ehTelefoneValido('(21) 3456-7890'), true);
});

test('rejeita telefone vazio, nulo ou curto demais', () => {
  assert.equal(ehTelefoneValido(''), false);
  assert.equal(ehTelefoneValido(null), false);
  assert.equal(ehTelefoneValido('123'), false);
});

test('formatarEndereco monta a string com o que estiver disponível', () => {
  const endereco = formatarEndereco({
    logradouro: 'Rua das Flores',
    numero: '123',
    bairro: 'Centro',
    cep: '01000-000',
  });
  assert.equal(endereco, 'Rua das Flores, 123 - Centro - CEP 01000-000');
});

test('formatarEndereco omite campos ausentes sem quebrar', () => {
  assert.equal(formatarEndereco({ logradouro: 'Rua X' }), 'Rua X');
  assert.equal(formatarEndereco({}), '');
  assert.equal(formatarEndereco(), '');
});

test('formatarEndereco não duplica a vírgula quando não há número', () => {
  assert.equal(formatarEndereco({ logradouro: 'Rua sem número', bairro: 'Bairro' }), 'Rua sem número - Bairro');
});
