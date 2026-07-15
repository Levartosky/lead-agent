const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '../../data/receita.db');

// Sinônimos: termo coloquial → raiz que aparece nos CNAEs
const SINONIMOS = {
  DENTISTA:       'ODONTOL',
  DENTISTAS:      'ODONTOL',
  DENTAL:         'ODONTOL',
  ODONTOLOGO:     'ODONTOL',
  MEDICO:         'MEDIC',
  MEDICOS:        'MEDIC',
  HOSPITAL:       'HOSPIT',
  CLINICA:        'CLINIC',
  ADVOGADO:       'ADVOCA',
  ADVOGADOS:      'ADVOCA',
  ADVOCACIA:      'ADVOCA',
  CONTADOR:       'CONTAB',
  CONTABILIDADE:  'CONTAB',
  ACADEMIA:       'CONDICIONAMENTO FISICO',
  ACADEMIAS:      'CONDICIONAMENTO FISICO',
  FARMACIA:       'FARMAC',
  SUPERMERCADO:   'SUPERM',
  PADARIA:        'PADARI',
  MECANICO:       'MANUTENC',
  ELETRICISTA:    'ELETRIC',
  ENGENHEIRO:     'ENGENH',
  ARQUITETO:      'ARQUIT',
  PSICÓLOGO:      'PSICOL',
  PSICOLOGO:      'PSICOL',
  NUTRICIONISTA:  'NUTRIC',
  FISIOTERAPEUTA: 'FISIOTE',
  VETERINARIO:    'VETERIN',
  VETERINÁRIA:    'VETERIN',
};

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

function buscarLeadsReceita(nicho, regiao, quantidade) {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    // 1. CNAEs: matching em JS (SQLite upper() ignora acentos)
    const termos = expandirTermos(nicho);
    const cnaeCodigos = db.prepare('SELECT codigo, descricao FROM cnaes').all()
      .filter(c => termos.some(t => normalizar(c.descricao).includes(t)))
      .map(c => c.codigo);

    if (cnaeCodigos.length === 0) {
      return {
        sucesso: false,
        mensagem: `Nenhum CNAE encontrado para "${nicho}". Tente: odontologia, restaurante, contábil, engenharia, farmácia...`,
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

module.exports = { buscarLeadsReceita };
