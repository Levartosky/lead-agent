const test = require('node:test');
const assert = require('node:assert/strict');
const { expandirTermos, sugerirTermos, normalizar } = require('../src/tools/receita');

test('normalizar remove acento e coloca em maiúsculo', () => {
  assert.equal(normalizar('Psicólogo'), 'PSICOLOGO');
  assert.equal(normalizar('São Paulo'), 'SAO PAULO');
});

test('expandirTermos inclui o sinônimo mapeado para um nicho conhecido', () => {
  const termos = expandirTermos('petshop');
  assert.ok(termos.includes('ANIMAIS DE ESTIMACAO'), termos.join(', '));
});

test('expandirTermos ignora tokens com menos de 3 letras', () => {
  const termos = expandirTermos('ir');
  assert.deepEqual(termos, []);
});

test('expandirTermos funciona com nicho fora do dicionário (usa o próprio termo)', () => {
  const termos = expandirTermos('confeitaria');
  assert.ok(termos.includes('CONFEITARIA'));
});

test('sugerirTermos aponta o nicho mais próximo para erro de digitação', () => {
  const sugestoes = sugerirTermos('dentsta');
  assert.ok(sugestoes.some(s => s.toUpperCase() === 'DENTISTA'), sugestoes.join(', '));
});

test('sugerirTermos devolve lista vazia para entrada vazia', () => {
  assert.deepEqual(sugerirTermos(''), []);
});
