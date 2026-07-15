const { buscarLeadsReceita }             = require('./tools/receita');
const { criarGerenciadorLeads }           = require('./tools/leads');

async function executarReceita(nicho, regiao, quantidade, onEvento = null) {
  const emit = (tipo, dados) => { if (onEvento) onEvento(tipo, dados); };

  console.log(`\n🗂️  Iniciando motor Receita Federal — Nicho: ${nicho} | Região: ${regiao} | Qtd: ${quantidade}\n`);
  emit('inicio', { nicho, regiao, quantidade });
  emit('log', { mensagem: 'Consultando base de dados da Receita Federal...' });

  const resultado = buscarLeadsReceita(nicho, regiao, quantidade);

  if (!resultado.sucesso) {
    emit('log', { mensagem: resultado.mensagem });
    return { sucesso: false, mensagem: resultado.mensagem };
  }

  const { leads, cnaesUsados } = resultado;
  emit('log', { mensagem: `${leads.length} estabelecimento(s) encontrado(s) — ${cnaesUsados} CNAE(s) mapeado(s)` });

  const { salvarLead, finalizarLeads } = criarGerenciadorLeads();

  for (const e of leads) {
    const r = await salvarLead({
      nome_empresa:  e.nome_fantasia || e.razao_social || 'N/A',
      nome_contato:  e.razao_social  || null,
      email:         e.email,
      telefone:      e.telefone,
      dominio:       null,
      tipo_registro: 'CNPJ',
      cpf_cnpj:      e.cnpj,
    });

    if (r.sucesso) {
      const lead = r.lead;
      console.log(`✅ Lead #${r.totalLeads}: ${lead.nomeEmpresa}`);
      emit('lead_salvo', {
        numero:       r.totalLeads,
        nomeEmpresa:  lead.nomeEmpresa,
        nomeContato:  lead.nomeContato,
        email:        lead.email,
        telefone:     lead.telefone,
        dominio:      null,
        tipoRegistro: 'CNPJ',
        cpfCnpj:      lead.cpfCnpj,
      });
    }
  }

  console.log('\n📊 Gerando planilha...');
  emit('gerando_excel', {});

  const final = await finalizarLeads(nicho, regiao);

  if (final.sucesso) {
    console.log(`\n✅ Concluído! ${final.totalLeads} leads → ${final.arquivo}`);
  } else {
    console.log(`\n⚠️  ${final.mensagem}`);
  }

  return final;
}

module.exports = { executarReceita };
