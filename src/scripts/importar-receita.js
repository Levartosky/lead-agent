#!/usr/bin/env node
/**
 * Importa os dados abertos CNPJ da Receita Federal para SQLite local.
 * Uso: node src/scripts/importar-receita.js "C:\caminho\para\pasta-com-zips"
 *
 * Arquivos necessários na pasta:
 *   Cnaes.zip, Municipios.zip
 *   Empresas0.zip … Empresas9.zip
 *   Estabelecimentos0.zip … Estabelecimentos9.zip
 */

const path     = require('path');
const fs       = require('fs');
const readline = require('readline');
const StreamZip = require('node-stream-zip');
const Database  = require('better-sqlite3');
const iconv     = require('iconv-lite');

// Remove aspas duplas externas do CSV (ex: '"SAO PAULO"' → 'SAO PAULO')
const strip = v => { const t = (v || '').trim(); return t[0] === '"' && t[t.length - 1] === '"' ? t.slice(1, -1) : t; };

// ── Argumentos ────────────────────────────────────────────────────────────────
const pastaZips = process.argv[2];
if (!pastaZips || !fs.existsSync(pastaZips)) {
  console.error('\n❌  Informe a pasta com os ZIPs da Receita Federal:');
  console.error('    node src/scripts/importar-receita.js "C:\\Downloads\\2026-06"\n');
  process.exit(1);
}

const DB_PATH = path.join(process.cwd(), 'data', 'receita.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ── Banco de dados ────────────────────────────────────────────────────────────
console.log(`\n📦 Banco: ${DB_PATH}`);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -131072');  // 128 MB de cache
db.pragma('temp_store = MEMORY');

db.exec(`
  CREATE TABLE IF NOT EXISTS cnaes (
    codigo    TEXT PRIMARY KEY,
    descricao TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS municipios (
    codigo TEXT PRIMARY KEY,
    nome   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS empresas (
    cnpj_basico  TEXT PRIMARY KEY,
    razao_social TEXT
  );

  CREATE TABLE IF NOT EXISTS estabelecimentos (
    cnpj        TEXT PRIMARY KEY,
    cnpj_basico TEXT NOT NULL,
    nome        TEXT,
    email       TEXT NOT NULL,
    telefone    TEXT NOT NULL,
    cnae        TEXT NOT NULL,
    uf          TEXT NOT NULL,
    municipio   TEXT NOT NULL,
    logradouro  TEXT,
    numero      TEXT,
    bairro      TEXT,
    cep         TEXT,
    matriz      INTEGER DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_cnae_uf_mun
    ON estabelecimentos(cnae, uf, municipio);

  CREATE INDEX IF NOT EXISTS idx_uf_mun
    ON estabelecimentos(uf, municipio);

  -- Controle de progresso: rastreia quais ZIPs já foram importados por completo
  CREATE TABLE IF NOT EXISTS importados (
    arquivo     TEXT PRIMARY KEY,
    importado_em TEXT NOT NULL
  );
`);

// Verifica se um ZIP já foi totalmente importado
function jaImportado(arquivo) {
  return !!db.prepare('SELECT 1 FROM importados WHERE arquivo = ?').get(arquivo);
}

// Marca um ZIP como concluído
function marcarConcluido(arquivo) {
  db.prepare("INSERT OR REPLACE INTO importados VALUES (?, datetime('now'))").run(arquivo);
}

// ── Leitor de ZIP em streaming ────────────────────────────────────────────────
async function processarZip(zipPath, onLote, tamanhoLote = 10000) {
  const zip     = new StreamZip.async({ file: zipPath });
  const entries = await zip.entries();
  const nomes   = Object.keys(entries).filter(n => !entries[n].isDirectory);

  if (nomes.length === 0) { await zip.close(); return 0; }

  const stream  = await zip.stream(nomes[0]);
  const decoded = stream.pipe(iconv.decodeStream('ISO-8859-1'));
  const rl      = readline.createInterface({ input: decoded, crlfDelay: Infinity });

  let lote  = [];
  let total = 0;

  await new Promise((resolve, reject) => {
    rl.on('line', linha => {
      if (!linha.trim()) return;
      lote.push(linha);
      if (lote.length >= tamanhoLote) {
        onLote(lote.splice(0));
        total += tamanhoLote;
        process.stdout.write(`\r   ${(total / 1_000_000).toFixed(1)}M linhas processadas...`);
      }
    });
    rl.on('close', () => {
      if (lote.length > 0) { onLote(lote); total += lote.length; }
      resolve();
    });
    rl.on('error', reject);
  });

  await zip.close();
  return total;
}

// ── 1. CNAEs ──────────────────────────────────────────────────────────────────
async function importarCnaes() {
  const arquivo = 'Cnaes.zip';
  const zipPath = path.join(pastaZips, arquivo);

  // Carrega do banco mesmo se já importado (precisamos do mapa em memória)
  const mapa = new Map();
  for (const row of db.prepare('SELECT codigo, descricao FROM cnaes').all()) {
    mapa.set(row.codigo, row.descricao);
  }

  if (!fs.existsSync(zipPath)) {
    console.log('\n⚠️   Cnaes.zip não encontrado — pulando');
    return mapa;
  }

  if (jaImportado(arquivo)) {
    console.log(`\n📋 [1/4] CNAEs — já importado ✓ (${mapa.size} registros)`);
    return mapa;
  }

  console.log('\n📋 [1/4] Importando CNAEs...');
  const insert = db.prepare('INSERT OR REPLACE INTO cnaes VALUES (?, ?)');

  const processarLote = db.transaction(linhas => {
    for (const l of linhas) {
      const p    = l.split(';');
      const cod  = (p[0] || '').trim().replace(/\D/g, '');
      const desc = (p[1] || '').trim();
      if (!cod) continue;
      insert.run(cod, desc);
      mapa.set(cod, desc);
    }
  });

  await processarZip(zipPath, processarLote);
  marcarConcluido(arquivo);
  console.log(`\n   ✅ ${mapa.size} CNAEs importados`);
  return mapa;
}

// ── 2. Municípios ─────────────────────────────────────────────────────────────
async function importarMunicipios() {
  const arquivo = 'Municipios.zip';
  const zipPath = path.join(pastaZips, arquivo);

  const mapa = new Map();
  for (const row of db.prepare('SELECT codigo, nome FROM municipios').all()) {
    mapa.set(strip(row.codigo), strip(row.nome));
  }

  if (!fs.existsSync(zipPath)) {
    console.log('\n⚠️   Municipios.zip não encontrado — pulando');
    return mapa;
  }

  if (jaImportado(arquivo)) {
    console.log(`\n🗺️  [2/4] Municípios — já importado ✓ (${mapa.size} registros)`);
    return mapa;
  }

  console.log('\n🗺️  [2/4] Importando municípios...');
  const insert = db.prepare('INSERT OR REPLACE INTO municipios VALUES (?, ?)');

  const processarLote = db.transaction(linhas => {
    for (const l of linhas) {
      const p    = l.split(';');
      const cod  = (p[0] || '').trim();
      const nome = (p[1] || '').trim();
      if (!cod) continue;
      insert.run(cod, nome);
      mapa.set(cod, nome);
    }
  });

  await processarZip(zipPath, processarLote);
  marcarConcluido(arquivo);
  console.log(`\n   ✅ ${mapa.size} municípios importados`);
  return mapa;
}

// ── 3. Empresas (razão social) ────────────────────────────────────────────────
async function importarEmpresas() {
  console.log('\n🏢 [3/4] Importando empresas (razão social)...');
  const insert = db.prepare('INSERT OR REPLACE INTO empresas VALUES (?, ?)');

  const processarLote = db.transaction(linhas => {
    for (const l of linhas) {
      const p      = l.split(';');
      const basico = (p[0] || '').trim();
      const razao  = (p[1] || '').trim();
      if (!basico) continue;
      insert.run(basico, razao || null);
    }
  });

  let totalEmpresas = 0;
  for (let i = 0; i <= 9; i++) {
    const arquivo = `Empresas${i}.zip`;
    const zipPath = path.join(pastaZips, arquivo);
    if (!fs.existsSync(zipPath)) continue;

    if (jaImportado(arquivo)) {
      process.stdout.write(`\n   ${arquivo} — já importado ✓`);
      continue;
    }

    process.stdout.write(`\n   ${arquivo} `);
    const n = await processarZip(zipPath, processarLote);
    totalEmpresas += n;
    marcarConcluido(arquivo);
  }

  console.log(`\n   ✅ ${(totalEmpresas / 1_000_000).toFixed(1)}M empresas novas importadas`);
}

// ── 4. Estabelecimentos ───────────────────────────────────────────────────────
async function importarEstabelecimentos(mapaCnaes, mapaMunicipios) {
  console.log('\n🏪 [4/4] Importando estabelecimentos (ativos com email e telefone)...');

  // Índices das colunas no CSV (separado por ";", sem header)
  const C = {
    basico:   0,  // CNPJ básico (8 dígitos)
    ordem:    1,  // CNPJ ordem  (4 dígitos)
    dv:       2,  // CNPJ DV     (2 dígitos)
    matriz:   3,  // 1=matriz, 2=filial
    fantasia: 4,  // nome fantasia
    situacao: 5,  // 02 = ativa
    cnae:    11,  // CNAE fiscal principal
    logra:   14,  // logradouro
    numero:  15,
    bairro:  17,
    cep:     18,
    uf:      19,
    mun:     20,  // código do município
    ddd1:    21,
    tel1:    22,
    ddd2:    23,
    tel2:    24,
    email:   27,  // correio eletrônico
  };

  const insert = db.prepare(`
    INSERT OR REPLACE INTO estabelecimentos
      (cnpj, cnpj_basico, nome, email, telefone, cnae, uf, municipio,
       logradouro, numero, bairro, cep, matriz)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalLinhas = 0;
  let totalSalvos = 0;

  function formatarTel(ddd, tel) {
    const d = ddd.replace(/\D/g, '');
    const t = tel.replace(/\D/g, '');
    if (!d || !t) return '';
    return t.length >= 9
      ? `(${d}) ${t.slice(0, 5)}-${t.slice(5)}`
      : `(${d}) ${t.slice(0, 4)}-${t.slice(4)}`;
  }

  const processarLote = db.transaction(linhas => {
    for (const l of linhas) {
      // Strip outer quotes from every CSV field (Receita Federal envolve valores em aspas)
      const p = l.split(';').map(strip);

      // Somente empresas ativas
      if (p[C.situacao] !== '02') continue;

      // Precisa de e-mail válido
      const email = (p[C.email] || '').toLowerCase();
      if (!email || !email.includes('@')) continue;

      // Precisa de ao menos um telefone
      const tel = formatarTel(p[C.ddd1] || '', p[C.tel1] || '')
               || formatarTel(p[C.ddd2] || '', p[C.tel2] || '');
      if (!tel) continue;

      const basico = (p[C.basico] || '').replace(/\D/g, '');
      const ordem  = (p[C.ordem]  || '').replace(/\D/g, '');
      const dv     = (p[C.dv]     || '').replace(/\D/g, '');
      const cnpj   = basico + ordem + dv;
      if (cnpj.length !== 14) continue;

      const cnae    = (p[C.cnae] || '').replace(/\D/g, '');
      const uf      = (p[C.uf]   || '').toUpperCase();
      const munCod  = p[C.mun] || '';
      const municipio = mapaMunicipios.get(munCod) || munCod;

      insert.run(
        cnpj, basico,
        p[C.fantasia] || null,
        email, tel, cnae, uf, municipio,
        p[C.logra]  || null,
        p[C.numero] || null,
        p[C.bairro] || null,
        p[C.cep]    || null,
        (p[C.matriz] || '1') === '1' ? 1 : 2
      );
      totalSalvos++;
    }
  });

  for (let i = 0; i <= 9; i++) {
    const arquivo = `Estabelecimentos${i}.zip`;
    const zipPath = path.join(pastaZips, arquivo);
    if (!fs.existsSync(zipPath)) continue;

    if (jaImportado(arquivo)) {
      process.stdout.write(`\n   ${arquivo} — já importado ✓`);
      continue;
    }

    process.stdout.write(`\n   ${arquivo} `);
    const n = await processarZip(zipPath, processarLote);
    totalLinhas += n;
    marcarConcluido(arquivo);
    process.stdout.write(` — ${totalSalvos.toLocaleString('pt-BR')} salvos`);
  }

  console.log(`\n\n   ✅ ${totalLinhas.toLocaleString('pt-BR')} linhas lidas`);
  console.log(`   ✅ ${totalSalvos.toLocaleString('pt-BR')} estabelecimentos com email + telefone`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const inicio = Date.now();
  console.log('\n🚀 Iniciando importação da base Receita Federal...');
  console.log(`   Pasta: ${pastaZips}\n`);

  const mapaCnaes      = await importarCnaes();
  const mapaMunicipios = await importarMunicipios();
  await importarEmpresas();
  await importarEstabelecimentos(mapaCnaes, mapaMunicipios);

  const mins   = ((Date.now() - inicio) / 60000).toFixed(1);
  const dbSize = (fs.statSync(DB_PATH).size / 1024 / 1024 / 1024).toFixed(2);

  console.log(`\n🎉 Importação concluída em ${mins} min`);
  console.log(`   Arquivo: ${DB_PATH} (${dbSize} GB)\n`);
})().catch(err => {
  console.error('\n❌ Erro fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
