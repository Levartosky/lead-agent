const Database = require('better-sqlite3');
const path     = require('path');
const { SINONIMOS } = require('../config/sinonimos-cnae');

const DB_PATH = path.join(__dirname, '../../data/receita.db');

function normalizar(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function parsearRegiao(regiao) {
  const m = regiao.trim().match(/^(.*?)\s+([A-Za-z]{2})$/);
  if (m) return { cidade: normalizar(m[1].trim()), uf: m[2].toUpperCase() };
  return { cidade: normalizar(regiao.trim()), uf: null };
}

function expandirTermos(nicho) {
  const base = normalizar(nicho).split(/\s+/).filter(t => t.length >= 3);
  const set  = new Set();
  for (const t of base) {
    set.add(t);
    if (SINONIMOS[t]) set.add(SINONIMOS[t]);
    // Stem simples: remove sufixo para casar variações (odontologia → odontolog)
    if (t.length > 6) set.add(t.slice(0, -2));
  }
  return [...set];
}

function distanciaLevenshtein(a, b) {
  const linhas = a.length + 1;
  const colunas = b.length + 1;
  const dp = Array.from({ length: linhas }, () => new Array(colunas).fill(0));
  for (let i = 0; i < linhas; i++) dp[i][0] = i;
  for (let j = 0; j < colunas; j++) dp[0][j] = j;
  for (let i = 1; i < linhas; i++) {
    for (let j = 1; j < colunas; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[linhas - 1][colunas - 1];
}

// Sugere os nichos conhecidos mais próximos do termo digitado, para o caso de
// erro de digitação ou nicho fora do dicionário (ex: "dentsta" → "dentista").
function sugerirTermos(nicho, limite = 3) {
  const alvo = normalizar(nicho).split(/\s+/)[0] || '';
  if (!alvo) return [];

  const chaves = Object.keys(SINONIMOS);
  return chaves
    .map(chave => ({ chave, dist: distanciaLevenshtein(alvo, chave) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limite)
    .map(({ chave }) => chave.charAt(0) + chave.slice(1).toLowerCase());
}

function buscarLeadsReceita(nicho, regiao, quantidade) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    // 1. CNAEs: matching em JS (SQLite upper() ignora acentos)
    const termos = expandirTermos(nicho);
    const cnaeCodigos = db.prepare('SELECT codigo, descricao FROM cnaes').all()
      .filter(c => termos.some(t => normalizar(c.descricao).includes(t)))
      .map(c => c.codigo);

    if (cnaeCodigos.length === 0) {
      const sugestoes = sugerirTermos(nicho);
      const dica = sugestoes.length
        ? `Você quis dizer: ${sugestoes.join(', ')}?`
        : 'Tente: odontologia, restaurante, contábil, engenharia, farmácia...';
      return {
        sucesso: false,
        mensagem: `Nenhum CNAE encontrado para "${nicho}". ${dica}`,
      };
    }

    // 2. Município: busca na tabela municipios (5572 linhas) — muito mais rápido
    //    que SELECT DISTINCT na tabela de 24M linhas
    const { cidade, uf } = parsearRegiao(regiao);
    let nomesMunicipio = [];

    if (cidade) {
      // municipios.nome está armazenado com aspas ex: '"SAO PAULO"'
      // LIKE '%SAO PAULO%' funciona pois a string contém o nome mesmo com aspas
      const munRows = db.prepare(
        `SELECT REPLACE(REPLACE(nome, '"', ''), '"', '') AS n FROM municipios WHERE nome LIKE ?`
      ).all(`%${cidade}%`);

      nomesMunicipio = munRows.map(r => r.n).filter(n => n && normalizar(n).includes(cidade));

      if (nomesMunicipio.length === 0) {
        return { sucesso: false, mensagem: `Município "${regiao}" não encontrado na base.` };
      }
    }

    // 3. Query principal — usa idx_cnae_uf_mun
    // JOIN com empresas: empresas.cnpj_basico tem aspas ex: '"41273589"'
    // mas estabelecimentos.cnpj_basico é limpo "41273589"
    const cnaePH = cnaeCodigos.map(() => '?').join(',');
    const munPH  = nomesMunicipio.map(() => '?').join(',');
    const params = [...cnaeCodigos];

    let sql = `
      SELECT
        e.cnpj,
        REPLACE(COALESCE(NULLIF(TRIM(e.nome), ''), em.razao_social), '"', '') AS nome_fantasia,
        REPLACE(em.razao_social, '"', '') AS razao_social,
        e.email,
        e.telefone,
        e.uf,
        e.municipio,
        e.logradouro,
        e.numero,
        e.bairro,
        e.cep
      FROM estabelecimentos e
      LEFT JOIN empresas em ON em.cnpj_basico = '"' || e.cnpj_basico || '"'
      WHERE e.cnae IN (${cnaePH})
    `;

    if (uf) { sql += ' AND e.uf = ?'; params.push(uf); }
    if (nomesMunicipio.length > 0) { sql += ` AND e.municipio IN (${munPH})`; params.push(...nomesMunicipio); }
    sql += ' LIMIT ?';
    params.push(quantidade);

    const leads = db.prepare(sql).all(...params);

    if (leads.length === 0) {
      return {
        sucesso: false,
        mensagem: `Sem resultados para "${nicho}" em "${regiao}". CNAEs encontrados: ${cnaeCodigos.length}. Tente uma região maior ou palavras-chave diferentes.`,
      };
    }

    return { sucesso: true, leads, cnaesUsados: cnaeCodigos.length };
  } finally {
    db.close();
  }
}

module.exports = { buscarLeadsReceita, expandirTermos, sugerirTermos, normalizar };
