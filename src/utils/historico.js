const fs   = require('fs');
const path = require('path');

const ARQUIVO = path.join(process.cwd(), 'leads', 'historico_dominios.json');

function carregarHistorico() {
  try {
    if (fs.existsSync(ARQUIVO)) {
      return new Set(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')));
    }
  } catch {}
  return new Set();
}

function salvarHistorico(dominios) {
  try {
    const pasta = path.dirname(ARQUIVO);
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify([...dominios], null, 2));
  } catch {}
}

function limparHistorico() {
  try {
    if (fs.existsSync(ARQUIVO)) fs.unlinkSync(ARQUIVO);
  } catch {}
}

module.exports = { carregarHistorico, salvarHistorico, limparHistorico };
