const { gerarExcel } = require('../utils/excel');

// Factory: cada execução do agente tem sua própria lista isolada
function criarGerenciadorLeads() {
  const leads = [];

  async function salvarLead(dados) {
    const jaExiste = leads.some(l => l.dominio === dados.dominio && dados.dominio);
    if (jaExiste) {
      return { sucesso: false, aviso: `Domínio ${dados.dominio} já registrado.` };
    }

    const lead = {
      nomeEmpresa:  dados.nome_empresa   || '',
      nomeContato:  dados.nome_contato   || '',
      email:        dados.email          || '',
      telefone:     dados.telefone       || '',
      dominio:      dados.dominio        || '',
      tipoRegistro: dados.tipo_registro  || '',
      cpfCnpj:      dados.cpf_cnpj       || '',
      atividade:    dados.atividade      || '',
      cidade:       dados.cidade         || '',
      endereco:     dados.endereco       || ''
    };

    leads.push(lead);
    return {
      sucesso:    true,
      mensagem:   `Lead salvo! Total: ${leads.length}`,
      totalLeads: leads.length,
      lead
    };
  }

  async function finalizarLeads(nicho, regiao) {
    if (leads.length === 0) {
      return { sucesso: false, mensagem: 'Nenhum lead encontrado.' };
    }
    const arquivo = await gerarExcel(leads, nicho, regiao);
    return { sucesso: true, arquivo, totalLeads: leads.length };
  }

  return { salvarLead, finalizarLeads };
}

module.exports = { criarGerenciadorLeads };
