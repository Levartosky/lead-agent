const axios = require('axios');
const { buscarEmpresasGoogleMaps }          = require('./tools/maps');
const { consultarWhois }                    = require('./tools/whois');
const { consultarCnpj }                     = require('./tools/cnpj');
const { criarGerenciadorLeads }             = require('./tools/leads');
const { carregarHistorico, salvarHistorico } = require('./utils/historico');

// Semáforo para limitar conexões simultâneas ao registro.br
let whoisAtivos = 0;
const WHOIS_MAX  = 3;

async function whoisComTimeout(dominio, ms = 12000) {
  while (whoisAtivos >= WHOIS_MAX) {
    await new Promise(r => setTimeout(r, 150));
  }
  whoisAtivos++;
  try {
    return await Promise.race([
      consultarWhois(dominio),
      new Promise(resolve =>
        setTimeout(() => resolve({ sucesso: false, dominio, erro: 'Timeout WHOIS' }), ms)
      ),
    ]);
  } finally {
    whoisAtivos--;
  }
}

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

// Busca CNPJ em múltiplas URLs do site em paralelo — antes era sequencial (até 40s)
async function extrairCnpjDoSite(dominio) {
  const CNPJ_RE = /\d{2}[.\-\s]?\d{3}[.\-\s]?\d{3}[\/\s]?\d{4}[.\-\s]?\d{2}/g;
  const urls = [
    `https://${dominio}`,
    `https://www.${dominio}`,
    `https://${dominio}/sobre`,
    `https://${dominio}/quem-somos`,
    `https://${dominio}/contato`,
  ];

  const resultados = await Promise.allSettled(
    urls.map(url =>
      axios.get(url, {
        timeout: 8000,
        maxContentLength: 400_000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)' },
      }).then(resp => {
        const matches = resp.data.match(CNPJ_RE) || [];
        for (const m of matches) {
          const digits = m.replace(/\D/g, '');
          if (cnpjValido(digits)) return digits;
        }
        return null;
      }).catch(() => null)
    )
  );

  for (const r of resultados) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
}

// Pool de workers paralelos — substitui o for-await sequencial
async function processarEmParalelo(items, fn, concurrency = 5) {
  const queue = [...items];

  async function worker() {
    while (true) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  }

  await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
}

async function executarRPA(nicho, regiao, quantidade, onEvento = null) {
  const emit = (tipo, dados) => { if (onEvento) onEvento(tipo, dados); };

  console.log(`\n🤖 Iniciando RPA — Nicho: ${nicho} | Região: ${regiao} | Qtd: ${quantidade}\n`);
  emit('inicio', { nicho, regiao, quantidade });

  const { salvarLead, finalizarLeads } = criarGerenciadorLeads();
  let totalSalvos = 0;

  const historico = carregarHistorico();
  console.log(`\n📚 Histórico: ${historico.size} domínio(s) já coletado(s) anteriormente.`);
  emit('log', { mensagem: `Histórico: ${historico.size} domínio(s) já visitado(s)` });

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

  console.log(`\n📋 ${empresas.length} empresa(s) coletada(s). Enriquecendo em paralelo (5 workers)...\n`);
  emit('log', { mensagem: `${empresas.length} empresa(s). Enriquecendo dados em paralelo...` });

  await processarEmParalelo(empresas, async (empresa) => {
    if (totalSalvos >= quantidade) return;

    try {
      if (historico.has(empresa.dominio)) {
        console.log(`   ⏭️  ${empresa.dominio} já coletado — pulando`);
        emit('log', { mensagem: `Já coletado: ${empresa.dominio} — pulando` });
        return;
      }

      let email        = null;
      let nomeContato  = null;
      let telefone     = empresa.telefone || null;
      let tipoRegistro = 'N/A';
      let cpfCnpj      = null;

      // --- WHOIS (limitado a 3 simultâneos pelo semáforo) ---
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
          console.log(`   ⚠️  WHOIS falhou (${whois.erro})`);
        }
      }

      // --- Lookup CNPJ via Receita Federal ---
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

      // --- Fallback: raspa CNPJ do site (agora em paralelo) ---
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

      // --- Qualificação mínima ---
      if (!email || !telefone) {
        const faltando = [!email && 'email', !telefone && 'telefone'].filter(Boolean).join(' e ');
        console.log(`   ⏭️  ${empresa.nome} descartado — sem ${faltando}`);
        emit('log', { mensagem: `Descartado: ${empresa.nome} — sem ${faltando}` });
        return;
      }

      if (totalSalvos >= quantidade) return;

      // --- Salva lead ---
      const resultado = await salvarLead({
        nome_empresa:  empresa.nome,
        nome_contato:  nomeContato,
        email,
        telefone,
        dominio:       empresa.dominio,
        tipo_registro: tipoRegistro,
        cpf_cnpj:      cpfCnpj,
      });

      if (resultado.sucesso) {
        totalSalvos = resultado.totalLeads;
        const lead  = resultado.lead;
        historico.add(empresa.dominio);
        console.log(`\n✅ Lead #${totalSalvos}: ${lead.nomeEmpresa}`);
        emit('lead_salvo', {
          numero:       totalSalvos,
          nomeEmpresa:  lead.nomeEmpresa,
          nomeContato:  lead.nomeContato,
          email:        lead.email,
          telefone:     lead.telefone,
          dominio:      lead.dominio,
          tipoRegistro: lead.tipoRegistro,
          cpfCnpj:      lead.cpfCnpj,
        });
      }

    } catch (erro) {
      console.log(`\n⚠️  Erro ao processar ${empresa.dominio}: ${erro.message}`);
      emit('log', { mensagem: `Erro em ${empresa.dominio}: ${erro.message}` });
    }
  }, 5);

  // Salva histórico uma única vez após todo o processamento paralelo
  salvarHistorico(historico);

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
