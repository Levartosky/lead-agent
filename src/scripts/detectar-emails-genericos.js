// Detecta emails "genéricos" — o mesmo endereço usado no cadastro de
// centenas de CNPJs diferentes (padrão comum: email do escritório de
// contabilidade cadastrado como contato oficial de todos os clientes).
// Sem filtrar isso, um único contador pode dominar boa parte de uma
// planilha de leads sem ser o contato real da empresa.
//
// Gera/atualiza a tabela `emails_genericos`, consultada por
// src/tools/receita.js (busca de leads) quando ela existir.
//
// Uso:
//   npm run detectar-emails-genericos              (limiar padrão: 50 CNPJs)
//   npm run detectar-emails-genericos -- 100        (limiar customizado)
//
// Reexecutar periodicamente — a base da Receita é atualizada mensalmente
// (ver Épico 7.6) e novos emails genéricos podem surgir.

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../../data/receita.db');
const LIMIAR_PADRAO = 50;

function main() {
  const limiar = Number(process.argv[2]) || LIMIAR_PADRAO;

  let db;
  try {
    db = new Database(DB_PATH, { fileMustExist: true });
  } catch (err) {
    console.error(`Não foi possível abrir ${DB_PATH}: ${err.message}`);
    console.error('Rode este script numa máquina com data/receita.db disponível.');
    process.exitCode = 1;
    return;
  }

  console.log(`Detectando emails com mais de ${limiar} CNPJs associados...`);
  console.log('(isso varre a tabela inteira de estabelecimentos — pode levar alguns minutos)\n');

  db.exec(`
    CREATE TABLE IF NOT EXISTS emails_genericos (
      email       TEXT PRIMARY KEY,
      ocorrencias INTEGER NOT NULL
    );
  `);

  const genericos = db.prepare(`
    SELECT email, COUNT(*) AS ocorrencias
    FROM estabelecimentos
    GROUP BY email
    HAVING ocorrencias > ?
  `).all(limiar);

  const upsert = db.prepare(`
    INSERT INTO emails_genericos (email, ocorrencias) VALUES (?, ?)
    ON CONFLICT(email) DO UPDATE SET ocorrencias = excluded.ocorrencias
  `);

  const transacao = db.transaction((linhas) => {
    db.prepare('DELETE FROM emails_genericos').run();
    for (const { email, ocorrencias } of linhas) upsert.run(email, ocorrencias);
  });
  transacao(genericos);

  db.close();

  console.log(`✓ ${genericos.length} email(s) genérico(s) registrado(s) em emails_genericos.`);
  if (genericos.length > 0) {
    console.log('\nTop 10 mais frequentes:');
    genericos
      .sort((a, b) => b.ocorrencias - a.ocorrencias)
      .slice(0, 10)
      .forEach(({ email, ocorrencias }) => console.log(`  ${ocorrencias.toString().padStart(6)}  ${email}`));
  }
}

main();
