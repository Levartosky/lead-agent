const whois = require('whois');

// Consulta o WHOIS de um domínio e retorna os dados do proprietário
async function consultarWhois(dominio) {
  return new Promise((resolve) => {
    // Remove "http://", "https://", "www." do domínio se existirem
    const dominioLimpo = dominio
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .trim();

    whois.lookup(dominioLimpo, { server: 'whois.registro.br' }, (err, dados) => {
      if (err) {
        resolve({
          sucesso: false,
          dominio: dominioLimpo,
          erro: `Não foi possível consultar o WHOIS: ${err.message}`
        });
        return;
      }

      const resultado = parseWhois(dados, dominioLimpo);
      resolve(resultado);
    });
  });
}

// Interpreta o texto bruto do WHOIS e extrai as informações importantes
function parseWhois(dadosBrutos, dominio) {
  if (!dadosBrutos || dadosBrutos.includes('No match for')) {
    return {
      sucesso: false,
      dominio,
      erro: 'Domínio não encontrado no registro.br'
    };
  }

  // Campo real do registro.br: "ownerid:" contém CPF ou CNPJ do titular
  const matchOwnerid = dadosBrutos.match(/^ownerid:\s*([^\r\n]+)/im);
  const ownerid = matchOwnerid ? matchOwnerid[1].trim() : null;

  // Detecta CNPJ (contém barra) ou CPF
  const ehCnpj = ownerid && /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(ownerid);
  const ehCpf  = ownerid && !ehCnpj;

  // Extrai email — primeiro e-mail encontrado (bloco de contato)
  const matchEmail = dadosBrutos.match(/^e-mail:\s*([^\s\r\n]+)/im);
  const email = matchEmail ? matchEmail[1].trim() : null;

  // Extrai nome da empresa (^owner: exclui owner-c:) e nome do contato (person:)
  const matchOwner  = dadosBrutos.match(/^owner:\s*([^\r\n]+)/im);
  const matchPerson = dadosBrutos.match(/^person:\s*([^\r\n]+)/im);
  const nomeEmpresa = matchOwner  ? matchOwner[1].trim()  : null;
  const nomePessoa  = matchPerson ? matchPerson[1].trim() : null;
  const nome        = nomePessoa || nomeEmpresa;

  // Extrai telefone
  const matchTelefone = dadosBrutos.match(/^phone:\s*([^\r\n]+)/im);
  const telefone = matchTelefone ? matchTelefone[1].trim() : null;

  if (ehCnpj) {
    return {
      sucesso: true,
      dominio,
      tipo: 'CNPJ',
      cnpj: ownerid,
      nome,
      nomeEmpresa,
      email,
      telefone
    };
  } else if (ehCpf) {
    const cpfMascarado = ownerid.includes('*');
    return {
      sucesso: true,
      dominio,
      tipo: 'CPF',
      cpf: ownerid,
      cpfMascarado,
      aviso: cpfMascarado ? 'Dados mascarados pela LGPD' : null,
      nome,
      email,
      telefone
    };
  } else {
    return {
      sucesso: false,
      dominio,
      erro: 'Campo ownerid não encontrado no WHOIS',
      dadosParciais: dadosBrutos.substring(0, 500)
    };
  }
}

module.exports = { consultarWhois };
