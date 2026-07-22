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

// Descarta telefones-lixo comuns na base da Receita: números onde o
// assinante (tudo após o DDD) é o mesmo dígito repetido — ex.: (11) 9999-9999,
// (11) 0000-0000, (11) 1111-1111. Esses números nunca completam uma ligação.
function ehTelefoneValido(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (digitos.length < 10) return false;

  const assinante = digitos.slice(2);
  if (/^(\d)\1+$/.test(assinante)) return false;

  return true;
}

// Monta uma única string de endereço a partir dos campos separados do
// estabelecimento, omitindo o que não vier preenchido.
function formatarEndereco({ logradouro, numero, bairro, cep } = {}) {
  const partes = [];
  if (logradouro) partes.push(numero ? `${logradouro}, ${numero}` : logradouro);
  if (bairro) partes.push(bairro);
  if (cep) partes.push(`CEP ${cep}`);
  return partes.join(' - ');
}

function buscarLeadsReceita(nicho, regiao, quantidade) {
  const db = new Database(DB_PATH, { readonly: true });
  db.function('telefone_valido', (telefone) => (ehTelefoneValido(telefone) ? 1 : 0));

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
    const munPH = nomesMunicipio.map(() => '?').join(',');

    // Emails genéricos (ex.: contador que registra o mesmo email em centenas
    // de CNPJs de clientes) só são filtrados se a tabela auxiliar já tiver
    // sido gerada — ver src/scripts/detectar-emails-genericos.js.
    const avisos = [];
    const temEmailsGenericos = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'emails_genericos'`
    ).get();
    if (!temEmailsGenericos) {
      avisos.push('Filtro de e-mails genéricos ainda não foi gerado (rode: npm run detectar-emails-genericos). Busca seguiu sem esse filtro.');
    }

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
        e.cep,
        REPLACE(c.descricao, '"', '') AS atividade
      FROM estabelecimentos e
      LEFT JOIN empresas em ON em.cnpj_basico = '"' || e.cnpj_basico || '"'
      LEFT JOIN cnaes c ON c.codigo = e.cnae
      WHERE e.cnae = ?
        AND e.matriz = 1
        AND telefone_valido(e.telefone) = 1
    `;

    if (uf) sql += ' AND e.uf = ?';
    if (nomesMunicipio.length > 0) sql += ` AND e.municipio IN (${munPH})`;
    if (temEmailsGenericos) sql += ' AND e.email NOT IN (SELECT email FROM emails_genericos)';
    sql += ' LIMIT ?';

    // Uma query por CNAE (em vez de um único WHERE cnae IN (...) com LIMIT):
    // quando o nicho digitado casa com várias atividades diferentes (ex.:
    // "petshop" bate em canil/criação E em varejo de pet shop), um único
    // LIMIT sem ORDER BY sempre esgotava o CNAE de código numericamente menor
    // primeiro. Buscando até `quantidade` por CNAE e intercalando os lotes
    // round-robin garante uma amostra representativa de todas as atividades.
    const stmt = db.prepare(sql);
    const porCnae = cnaeCodigos.map(codigo => {
      const params = [codigo];
      if (uf) params.push(uf);
      if (nomesMunicipio.length > 0) params.push(...nomesMunicipio);
      params.push(quantidade);
      return stmt.all(...params);
    });

    const leads = [];
    for (let i = 0; leads.length < quantidade && porCnae.some(lote => lote.length > i); i++) {
      for (const lote of porCnae) {
        if (leads.length >= quantidade) break;
        if (lote[i]) leads.push(lote[i]);
      }
    }

    if (leads.length === 0) {
      return {
        sucesso: false,
        mensagem: `Sem resultados para "${nicho}" em "${regiao}". CNAEs encontrados: ${cnaeCodigos.length}. Tente uma região maior ou palavras-chave diferentes.`,
      };
    }

    return { sucesso: true, leads, cnaesUsados: cnaeCodigos.length, avisos };
  } finally {
    db.close();
  }
}

module.exports = {
  buscarLeadsReceita,
  expandirTermos,
  sugerirTermos,
  normalizar,
  ehTelefoneValido,
  formatarEndereco,
};
