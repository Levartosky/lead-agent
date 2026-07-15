const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SINONIMOS,
  SINONIMOS_VALIDADOS,
  SINONIMOS_NOVOS_PENDENTE_VALIDACAO,
} = require('../src/config/sinonimos-cnae');

test('nenhuma chave ou raiz vazia', () => {
  for (const [chave, raiz] of Object.entries(SINONIMOS)) {
    assert.ok(chave.length > 0, 'chave vazia encontrada');
    assert.ok(typeof raiz === 'string' && raiz.length > 0, `raiz vazia para "${chave}"`);
  }
});

test('chaves em maiúsculo e sem espaço nas pontas', () => {
  for (const chave of Object.keys(SINONIMOS)) {
    assert.equal(chave, chave.toUpperCase(), `"${chave}" deveria estar em maiúsculo`);
    assert.equal(chave, chave.trim(), `"${chave}" tem espaço sobrando`);
  }
});

test('sem chaves duplicadas entre validados e pendentes de validação', () => {
  const validadas = new Set(Object.keys(SINONIMOS_VALIDADOS));
  const duplicadas = Object.keys(SINONIMOS_NOVOS_PENDENTE_VALIDACAO).filter(k => validadas.has(k));
  assert.deepEqual(duplicadas, [], `chaves duplicadas entre os dois grupos: ${duplicadas.join(', ')}`);
});

test('cobre pelo menos 45 conceitos de nicho (história 3.3 pede ~50)', () => {
  assert.ok(Object.keys(SINONIMOS).length >= 45, `só há ${Object.keys(SINONIMOS).length} chaves`);
});
