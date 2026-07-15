const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const BORDA_FINA = {
  top:    { style: 'thin', color: { argb: 'FFB0BEC5' } },
  left:   { style: 'thin', color: { argb: 'FFB0BEC5' } },
  bottom: { style: 'thin', color: { argb: 'FFB0BEC5' } },
  right:  { style: 'thin', color: { argb: 'FFB0BEC5' } }
};

const BORDA_CABECALHO = {
  top:    { style: 'medium', color: { argb: 'FF1F4E79' } },
  left:   { style: 'medium', color: { argb: 'FF1F4E79' } },
  bottom: { style: 'medium', color: { argb: 'FF1F4E79' } },
  right:  { style: 'medium', color: { argb: 'FF1F4E79' } }
};

async function gerarExcel(leads, nicho, regiao) {
  const workbook = new ExcelJS.Workbook();
  const aba = workbook.addWorksheet('Leads SDR');

  // Colunas com larguras generosas para evitar cortes
  aba.columns = [
    { header: 'Nº',             key: 'numero',       width: 6  },
    { header: 'Empresa',        key: 'nomeEmpresa',  width: 42 },
    { header: 'Nome Contato',   key: 'nomeContato',  width: 32 },
    { header: 'E-mail',         key: 'email',        width: 38 },
    { header: 'Telefone',       key: 'telefone',     width: 22 },
    { header: 'CPF / CNPJ',     key: 'cpfCnpj',      width: 22 },
    { header: 'Domínio',        key: 'dominio',      width: 32 },
    { header: 'Tipo Registro',  key: 'tipoRegistro', width: 16 },
    { header: 'CNAE/Atividade', key: 'atividade',    width: 42 },
    { header: 'Cidade',         key: 'cidade',       width: 24 },
    { header: 'Endereço',       key: 'endereco',     width: 42 }
  ];

  // Estilo do cabeçalho
  const cabecalho = aba.getRow(1);
  cabecalho.height = 26;
  cabecalho.eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    cell.border    = BORDA_CABECALHO;
  });

  const na = (v) => (v && String(v).trim()) ? String(v).trim() : 'N/A';

  // Ordem das colunas (deve espelhar exatamente aba.columns acima)
  const COLUNAS = [
    (l, i) => i + 1,
    (l)    => na(l.nomeEmpresa),
    (l)    => na(l.nomeContato),
    (l)    => na(l.email),
    (l)    => na(l.telefone),
    (l)    => na(l.cpfCnpj),
    (l)    => na(l.dominio),
    (l)    => na(l.tipoRegistro),
    (l)    => na(l.atividade),
    (l)    => na(l.cidade),
    (l)    => na(l.endereco)
  ];

  // Linha de dados — atribuição direta por índice de coluna (evita quirks do addRow)
  leads.forEach((lead, index) => {
    const rowNum = index + 2; // linha 1 = cabeçalho
    const linha  = aba.getRow(rowNum);
    linha.height = 22;

    const fundo = index % 2 === 0
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9F0F8' } }
      : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

    COLUNAS.forEach((fn, ci) => {
      const cell = linha.getCell(ci + 1);
      cell.value     = fn(lead, index);
      cell.fill      = fundo;
      cell.border    = BORDA_FINA;
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'center' : 'left' };
      // Telefone e CPF/CNPJ sempre como texto
      if (ci === 4 || ci === 5) cell.numFmt = '@';
    });

    linha.commit();
  });

  // Congela o cabeçalho ao rolar
  aba.views = [{ state: 'frozen', ySplit: 1 }];

  // Filtro automático em todas as colunas
  aba.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: aba.columns.length }
  };

  // Garante que a pasta "leads" existe
  const pastaLeads = path.join(process.cwd(), 'leads');
  if (!fs.existsSync(pastaLeads)) fs.mkdirSync(pastaLeads, { recursive: true });

  const agora    = new Date();
  const dataHora = agora.toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const nichoSlug  = nicho.replace(/\s+/g, '_').toLowerCase();
  const regiaoSlug = regiao.replace(/\s+/g, '_').toLowerCase();
  const nomeArquivo   = `leads_${nichoSlug}_${regiaoSlug}_${dataHora}.xlsx`;
  const caminhoCompleto = path.join(pastaLeads, nomeArquivo);

  await workbook.xlsx.writeFile(caminhoCompleto);
  return caminhoCompleto;
}

module.exports = { gerarExcel };
