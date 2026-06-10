const { chromium } = require('playwright');

// Pausa aleatória entre min e max ms — evita padrão de tempo fixo
function pausa(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

async function buscarEmpresasGoogleMaps(nicho, regiao, quantidade, onProgresso = null) {
  const emitir = (msg) => { if (onProgresso) onProgresso(msg); };

  // Viewport ligeiramente aleatório — sessões idênticas são suspeitas
  const largura = 1280 + Math.floor(Math.random() * 160);
  const altura  =  800 + Math.floor(Math.random() * 120);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: largura, height: altura },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  const empresas = [];
  const dominiosVistos = new Set();
  const query = encodeURIComponent(`${nicho} ${regiao}`);

  try {
    emitir(`🗺️  Abrindo Google Maps: ${nicho} em ${regiao}`);
    await page.goto(`https://www.google.com/maps/search/${query}`, { waitUntil: 'domcontentloaded' });

    // Pausa inicial — simula tempo de leitura da página
    await pausa(1800, 3200);

    // Aceita cookies se o banner aparecer
    try {
      const botaoAceitar = page.locator('button:has-text("Aceitar tudo"), button:has-text("Accept all"), form[action*="consent"] button').first();
      if (await botaoAceitar.isVisible({ timeout: 4000 })) {
        await pausa(600, 1200); // pequena hesitação antes de clicar
        await botaoAceitar.click();
        await pausa(900, 1800);
      }
    } catch {}

    // Aguarda o painel de resultados
    await page.waitForSelector('div[role="feed"]', { timeout: 20000 });
    await pausa(1000, 2000); // lê os resultados antes de começar a rolar

    emitir('📋 Painel de resultados carregado. Coletando links...');

    // Scroll offset aleatório — cada execução começa de uma posição diferente
    // evita sempre pegar os mesmos primeiros resultados
    const saltarResultados = Math.floor(Math.random() * 12); // pula 0–11 resultados
    if (saltarResultados > 0) {
      emitir(`🔀 Variando posição inicial: pulando ${saltarResultados} resultado(s)`);
      await page.evaluate((n) => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollTop = n * 90;
      }, saltarResultados);
      await pausa(1200, 2000);
    }

    // Coleta um pool grande de links — o filtro de qualificação vai descartar parte deles
    const meta      = quantidade * 5;   // empresas com site a visitar
    const bufferUrl = quantidade * 10;  // links do feed a coletar
    const links = await coletarLinks(page, bufferUrl, emitir);
    emitir(`🔗 ${links.length} links coletados. Extraindo dados (meta: ${meta} empresas com site)...`);

    // Visita cada link e extrai dados até atingir o pool
    for (const link of links) {
      if (empresas.length >= meta) break;

      // Pausa entre páginas — o intervalo mais importante para não ser detectado
      await pausa(2500, 5000);

      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // Simula tempo de carregamento visual antes de "ler" a página
        await pausa(1200, 2500);

        // Move o mouse para uma posição aleatória (simula olhar para a tela)
        await page.mouse.move(
          200 + Math.random() * 600,
          200 + Math.random() * 300
        );

        // Nome
        const nome = await page.locator('h1').first().textContent({ timeout: 8000 }).catch(() => null);
        if (!nome?.trim()) continue;

        // Pequena pausa antes de buscar os outros campos
        await pausa(400, 900);

        // Site
        const websiteEl  = page.locator('a[data-item-id="authority"]');
        const websiteHref = await websiteEl.getAttribute('href', { timeout: 5000 }).catch(() => null);

        // Telefone — tenta múltiplos seletores em ordem de confiabilidade
        const telefone = await extrairTelefone(page);

        // Extrai domínio limpo
        let dominio = null;
        if (websiteHref) {
          try {
            const url = new URL(websiteHref);
            dominio = url.hostname.replace(/^www\./, '');
          } catch {}
        }

        if (!dominio || dominiosVistos.has(dominio)) continue;
        dominiosVistos.add(dominio);

        const empresa = { nome: nome.trim(), dominio, telefone: telefone || null };
        empresas.push(empresa);
        emitir(`  ✅ #${empresas.length} ${empresa.nome} — ${empresa.dominio}`);

      } catch {
        // Ignora erros individuais e segue para o próximo
      }
    }

  } finally {
    await browser.close();
  }

  return empresas;
}

async function coletarLinks(page, alvo, emitir) {
  const links = new Set();
  let semMudancas = 0;

  while (links.size < alvo && semMudancas < 4) {
    const anterior = links.size;

    const hrefs = await page.$$eval(
      'div[role="feed"] a[href*="/maps/place/"]',
      els => els.map(el => el.href)
    );
    hrefs.forEach(h => links.add(h));

    if (links.size === anterior) {
      semMudancas++;
    } else {
      semMudancas = 0;
    }

    // Verifica fim da lista
    const textoFeed = await page.locator('div[role="feed"]').textContent({ timeout: 3000 }).catch(() => '');
    if (textoFeed.includes('Você chegou ao fim') || textoFeed.includes('end of the list')) break;

    // Rola em incrementos variáveis — humanos não rolam sempre o mesmo tanto
    const scrollAmt = 600 + Math.floor(Math.random() * 600);
    await page.evaluate((amt) => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) feed.scrollBy(0, amt);
    }, scrollAmt);

    // Pausa variável entre rolagens
    await pausa(1400, 2800);
  }

  return [...links];
}

async function extrairTelefone(page) {
  const seletores = [
    '[data-item-id*="phone:tel:"] .fontBodyMedium',
    'button[data-tooltip*="telefone"] .fontBodyMedium',
    'button[data-tooltip*="phone"] .fontBodyMedium',
    '[aria-label*="Telefone"] .fontBodyMedium',
    '[aria-label*="Phone"] .fontBodyMedium',
  ];

  for (const seletor of seletores) {
    try {
      const el = page.locator(seletor).first();
      if (await el.isVisible({ timeout: 2000 })) {
        return (await el.textContent()).trim();
      }
    } catch {}
  }
  return null;
}

module.exports = { buscarEmpresasGoogleMaps };
