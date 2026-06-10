const readline = require('readline');
const { executarRPA } = require('./rpa');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function perguntar(texto) {
  return new Promise(resolve => rl.question(texto, resolve));
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     🤖 RPA DE GERAÇÃO DE LEADS         ║');
  console.log('║     Google Maps + WHOIS + CNPJ         ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    const nicho = await perguntar('📌 Qual o nicho? (ex: clínica veterinária, escola, dentista): ');
    if (!nicho.trim()) { console.log('❌ O nicho não pode estar vazio.'); rl.close(); return; }

    const regiao = await perguntar('📍 Qual a região? (ex: São Paulo SP, Rio de Janeiro RJ): ');
    if (!regiao.trim()) { console.log('❌ A região não pode estar vazia.'); rl.close(); return; }

    const quantidadeTexto = await perguntar('🔢 Quantos leads deseja? (ex: 10): ');
    const quantidade = parseInt(quantidadeTexto, 10);
    if (isNaN(quantidade) || quantidade < 1) { console.log('❌ Digite um número válido.'); rl.close(); return; }

    rl.close();

    await executarRPA(nicho.trim(), regiao.trim(), quantidade);

  } catch (erro) {
    console.error('\n❌ Erro inesperado:', erro.message);
    rl.close();
    process.exit(1);
  }
}

main();
