const axios = require('axios');
const { buscarEmpresasGoogleMaps }          = require('./tools/maps');
const { consultarWhois }                    = require('./tools/whois');
const { consultarCnpj }                     = require('./tools/cnpj');
const { criarGerenciadorLeads }             = require('./tools/leads');
const { carregarHistorico, salvarHistorico } = require('./utils/historico');

// WHOIS com timeout explícito — o servidor registro.br pode travar sem responder
function whoisComTimeout(dominio, ms = 12000) {
  return Promise.race([
    consultarWhois(dominio),
    new Promise(resolve =>
      setTimeout(() => resolve({ sucesso: false, dominio, erro: 'Timeout WHOIS' }), ms)
    )
  ]);
}

// Valida o dígito verificador do CNPJ para evitar falsos positivos (ex: telefones)
function cnpjValido(digits) {
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calc = (d, n) => {
    let s = 0, w = n;
    for (let i = 0; i < n - 1; i++) { s += parseInt(d[i]) * w; w = w === 2 ? 9 : w - 1; }
    const r = s % 11;
    return parseInt(d[n - 1]) === (r < 2 ? 0 : 11 - r);
  };
  return calc(digits, 13) && calc(digits, 14);
}

// Raspa o HTML do site da empresa procurando CNPJ no rodapé / página "sobre"
async function extrairCnpjDoSite(dominio) {
  const CNPJ_RE = /\d{2}[.\-\s]?\d{3}[.\-\s]?\d{3}[\/\s]?\d{4}[.\-\s]?\d{2}/g;
  const urls = [
    `https://${dominio}`,
    `https://www.${dominio}`,
    `https://${dominio}/sobre`,
    `https://${dominio}/quem-somos`,
    `https://${dominio}/contato`,
  ];

  for (const url of urls) {
    try {
      const resp = await axios.get(url, {
        timeout: 8000,
        maxContentLength: 400000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)' }
      });
      const matches = resp.data.match(CNPJ_RE) || [];
      for (const m of matches) {
        const digits = m.replace(/\D/g, '');
        if (cnpjValido(digits)) return digits;
      }
    } catch {}
  }
  return null;
}

async function executarRPA(nicho, regiao, quantidade, onEvento = null) {
  const emit = (tipo, dados) => { if (onEvento) onEvento(tipo, dados); };

  console.log(`\n🤖 Iniciando RPA — Nicho: ${nicho} | Região: ${regiao} | Qtd: ${quantidade}\n`);
  emit('inicio', { nicho, regiao, quantidade });

  const { salvarLead, finalizarLeads } = criarGerenciadorLeads();
  let totalSalvos = 0;

  // Carrega histórico de domínios já coletados em execuções anteriores
  const historico = carregarHistorico();
  console.log(`\n📚 Histórico: ${historico.size} domínio(s) já coletado(s) anteriormente.`);
  emit('log', { mensagem: `Histórico: ${historico.size} domínio(s) já visitado(s)` });

  // Etapa 1: Coletar empresas via Google Maps
  emit('log', { mensagem: 'Abrindo Google Maps...' });
  const empresas = await buscarEmpresasGoogleMaps(nicho, regiao, quantidade, (msg) => {
    console.log(msg);
    emit('log', { mensagem: msg.replace(/^\s*[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}]\s*/u, '') });
  });

  if (empresas.length === 0) {
    console.log('\n⚠️  Nenhuma empresa encontrada no Google Maps.');
    emit('log', { mensagem: 'Nenhuma empresa encontrada no Google Maps.' });
    return { sucesso: false, mensagem: 'Nenhuma empresa encontrada.' };
  }

  console.log(`\n📋 ${empresas.length} empresa(s) coletada(s). Enriquecendo dados...\n`);
  emit('log', { mensagem: `${empresas.length} empresa(s) coletada(s). Enriquecendo dados...` });

  // Etapa 2: Enriquecer cada empresa — WHOIS → CNPJ → fallback site
  for (const empresa of empresas) {
    if (totalSalvos >= quantidade) break;

    try {
      // --- Pula domínio já coletado em execução anterior ---
      if (historico.has(empresa.dominio)) {
        console.log(`   ⏭️  ${empresa.dominio} já coletado — pulando`);
        emit('log', { mensagem: `Já coletado: ${empresa.dominio} — pulando` });
        continue;
      }

      let email        = null;
      let nomeContato  = null;
      let telefone     = empresa.telefone || null;
      let tipoRegistro = 'N/A';
      let cpfCnpj      = null;

      // --- WHOIS ---
      const eBr = empresa.dominio.endsWith('.br');
      if (eBr) {
        console.log(`\n🔧 WHOIS → ${empresa.dominio}`);
        emit('ferramenta', { nome: 'consultar_whois', dominio: empresa.dominio });
        const whois = await whoisComTimeout(empresa.dominio);

        if (whois.sucesso) {
          tipoRegistro = whois.tipo;
          nomeContato  = whois.nome     || null;
          telefone     = telefone || whois.telefone || null;

          if (whois.tipo === 'CNPJ') {
            cpfCnpj = whois.cnpj;
          } else if (whois.tipo === 'CPF') {
            email   = whois.email || null;
            cpfCnpj = whois.cpf  || null;
          }
        } else {
          console.log(`   ⚠️  WHOIS falhou (${whois.erro}) — tentando extrair CNPJ do site`);
        }
      }

      // --- Lookup CNPJ via Receita Federal (se WHOIS trouxe o número) ---
      if (cpfCnpj && tipoRegistro === 'CNPJ') {
        console.log(`\n🔧 CNPJ  → ${cpfCnpj}`);
        emit('ferramenta', { nome: 'consultar_cnpj', cnpj: cpfCnpj });
        const cnpjData = await consultarCnpj(cpfCnpj);

        if (cnpjData.sucesso) {
          email       = cnpjData.email    || null;
          telefone    = telefone || cnpjData.telefone || null;
          nomeContato = nomeContato || cnpjData.socioNome || cnpjData.razaoSocial || null;
        }
      }

      // --- Fallback: raspa CNPJ diretamente do site da empresa ---
      if (!cpfCnpj) {
        console.log(`\n🔍 Buscando CNPJ no site → ${empresa.dominio}`);
        emit('ferramenta', { nome: 'cnpj_no_site', dominio: empresa.dominio });
        const cnpjSite = await extrairCnpjDoSite(empresa.dominio);

        if (cnpjSite) {
          console.log(`   🔧 CNPJ encontrado no site: ${cnpjSite}`);
          const cnpjData = await consultarCnpj(cnpjSite);

          if (cnpjData.sucesso) {
            email        = cnpjData.email    || null;
            telefone     = telefone || cnpjData.telefone || null;
            nomeContato  = nomeContato || cnpjData.socioNome || cnpjData.razaoSocial || null;
            cpfCnpj      = cnpjSite;
            tipoRegistro = 'CNPJ';
          }
        }
      }

      // --- Qualificação mínima: lead só é salvo se tiver email E telefone ---
      if (!email || !telefone) {
        const faltando = [!email && 'email', !telefone && 'telefone'].filter(Boolean).join(' e ');
        console.log(`   ⏭️  ${empresa.nome} descartado — sem ${faltando}`);
        emit('log', { mensagem: `Descartado: ${empresa.nome} — sem ${faltando}` });
        continue;
      }

      // --- Salva lead ---
      const resultado = await salvarLead({
        nome_empresa:  empresa.nome,
        nome_contato:  nomeContato,
        email,
        telefone,
        dominio:       empresa.dominio,
        tipo_registro: tipoRegistro,
        cpf_cnpj:      cpfCnpj
      });

      if (resultado.sucesso) {
        totalSalvos = resultado.totalLeads;
        const lead  = resultado.lead;
        // Registra domínio no histórico para não repetir em buscas futuras
        historico.add(empresa.dominio);
        salvarHistorico(historico);
        console.log(`\n✅ Lead #${totalSalvos}: ${lead.nomeEmpresa}`);
        emit('lead_salvo', {
          numero:       totalSalvos,
          nomeEmpresa:  lead.nomeEmpresa,
          nomeContato:  lead.nomeContato,
          email:        lead.email,
          telefone:     lead.telefone,
          dominio:      lead.dominio,
          tipoRegistro: lead.tipoRegistro,
          cpfCnpj:      lead.cpfCnpj
        });
      }

      // Pausa entre empresas para não sobrecarregar registro.br
      await new Promise(r => setTimeout(r, 1200));

    } catch (erro) {
      console.log(`\n⚠️  Erro ao processar ${empresa.dominio}: ${erro.message}`);
      emit('log', { mensagem: `Erro em ${empresa.dominio}: ${erro.message}` });
    }
  }

  // Etapa 3: Gerar planilha
  console.log('\n📊 Gerando planilha...');
  emit('gerando_excel', {});

  const resultado = await finalizarLeads(nicho, regiao);

  if (resultado.sucesso) {
    console.log(`\n✅ Concluído! ${resultado.totalLeads} leads → ${resultado.arquivo}`);
  } else {
    console.log(`\n⚠️  ${resultado.mensagem}`);
  }

  return resultado;
}

module.exports = { executarRPA };
