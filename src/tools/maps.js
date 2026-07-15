const { chromium } = require('playwright');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

function pausa(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

// Gera variações da query para superar o limite de ~200 resultados por busca no Maps
function gerarVariacoesQuery(nicho, regiao, quantidade) {
  const vars = [
    `${nicho} ${regiao}`,
    `${nicho} em ${regiao}`,
    `empresa ${nicho} ${regiao}`,
    `${nicho} profissional ${regiao}`,
    `${nicho} ${regiao} centro`,
    `${nicho} zona norte ${regiao}`,
    `${nicho} zona sul ${regiao}`,
    `${nicho} zona leste ${regiao}`,
    `${nicho} zona oeste ${regiao}`,
    `${nicho} ${regiao} serviços`,
    `${nicho} ${regiao} LTDA`,
    `${nicho} ${regiao} MEI`,
  ];
  // Cada busca rende ~150-200 resultados; pool precisa de ~8x a meta final
  const needed = Math.max(3, Math.ceil((quantidade * 8) / 170));
  return vars.slice(0, Math.min(needed, vars.length));
}

// Patcha o contexto do browser para esconder sinais de automação
async function aplicarFurtividade(context) {
  await context.addInitScript(() => {
    // Principal sinal detectado pelo Google — deve ser undefined, não false
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Chrome headless não tem window.chrome; navegadores reais têm
    window.chrome = {
      runtime: {},
      loadTimes: () => ({}),
      csi: () => ({}),
      app: {},
    };

    // Plugins ausentes é um forte indicador de headless
    const pluginData = [
      { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer',           description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client',      filename: 'internal-nacl-plugin',           description: '' },
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = pluginData.slice();
        arr.item       = (i) => arr[i];
        arr.namedItem  = (n) => arr.find(p => p.name === n) || null;
        arr.refresh    = () => {};
        return arr;
      },
    });

    Object.defineProperty(navigator, 'languages',          { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'platform',           { get: () => 'Win32' });
    Object.defineProperty(navigator, 'hardwareConcurrency',{ get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory',       { get: () => 8 });

    // API de permissões tem comportamento diferente em headless
    if (navigator.permissions) {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    }
  });
}

async function buscarEmpresasGoogleMaps(nicho, regiao, quantidade, onProgresso = null) {
  const emitir = (msg) => { if (onProgresso) onProgresso(msg); };
  const queries = gerarVariacoesQuery(nicho, regiao, quantidade);
  const meta    = quantidade * 8; // pool largo; enriquecimento filtra ~70-80%

  const largura = 1280 + Math.floor(Math.random() * 160);
  const altura  =  800 + Math.floor(Math.random() * 120);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled', // esconde flag de automação do Chrome
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      `--window-size=${largura},${altura}`,
    ],
  });

  const dominiosVistos = new Set();
  const empresas       = [];

  emitir(`🎯 Meta: ${meta} candidatas via ${queries.length} busca(s) no Maps`);

  try {
    for (let qi = 0; qi < queries.length; qi++) {
      if (empresas.length >= meta) break;

      const query = queries[qi];
      emitir(`🔍 [${qi + 1}/${queries.length}] "${query}"`);

      // Novo contexto por busca = nova sessão/fingerprint
      const context = await browser.newContext({
        locale:    'pt-BR',
        viewport:  { width: largura + Math.floor(Math.random() * 40), height: altura + Math.floor(Math.random() * 40) },
        userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7' },
      });

      await aplicarFurtividade(context);

      const page = await context.newPage();
      page.setDefaultTimeout(25000);

      try {
        const novas = await pesquisarNaMapa(page, query, meta - empresas.length, dominiosVistos, emitir);
        empresas.push(...novas);
        emitir(`📊 Acumulado: ${empresas.length} empresa(s) com site`);
      } catch (err) {
        emitir(`⚠️  Busca "${query}" falhou: ${err.message}`);
      } finally {
        await context.close();
      }

      if (qi < queries.length - 1 && empresas.length < meta) {
        const espera = 4000 + Math.random() * 5000;
        emitir(`⏳ Intervalo de ${Math.round(espera / 1000)}s entre buscas...`);
        await pausa(4000, 9000);
      }
    }
  } finally {
    await browser.close();
  }

  emitir(`✅ Google Maps: ${empresas.length} candidata(s) coletada(s)`);
  return empresas;
}

async function pesquisarNaMapa(page, query, alvo, dominiosVistos, emitir) {
  const empresas    = [];
  const encodedQuery = encodeURIComponent(query);

  await page.goto(`https://www.google.com/maps/search/${encodedQuery}`, { waitUntil: 'domcontentloaded' });
  await pausa(1800, 3200);

  try {
    const botaoAceitar = page.locator(
      'button:has-text("Aceitar tudo"), button:has-text("Accept all"), form[action*="consent"] button'
    ).first();
    if (await botaoAceitar.isVisible({ timeout: 4000 })) {
      await pausa(600, 1200);
      await botaoAceitar.click();
      await pausa(900, 1800);
    }
  } catch {}

  await page.waitForSelector('div[role="feed"]', { timeout: 20000 });
  await pausa(1000, 2000);

  // Offset de scroll variável — evita sempre pegar os mesmos primeiros resultados
  const saltarResultados = Math.floor(Math.random() * 8);
  if (saltarResultados > 0) {
    await page.evaluate((n) => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) feed.scrollTop = n * 90;
    }, saltarResultados);
    await pausa(1000, 1800);
  }

  const bufferUrl = Math.min(alvo * 3, 600);
  const links     = await coletarLinks(page, bufferUrl, emitir);
  emitir(`🔗 ${links.length} links encontrados para "${query}"`);

  for (const link of links) {
    if (empresas.length >= alvo) break;

    await pausa(1800, 4000);

    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await pausa(900, 2000);

      // Simula olhar para a tela
      await page.mouse.move(200 + Math.random() * 600, 200 + Math.random() * 300);

      const nome = await page.locator('h1').first().textContent({ timeout: 8000 }).catch(() => null);
      if (!nome?.trim()) continue;

      await pausa(300, 700);

      const websiteEl   = page.locator('a[data-item-id="authority"]');
      const websiteHref = await websiteEl.getAttribute('href', { timeout: 5000 }).catch(() => null);
      const telefone    = await extrairTelefone(page);

      let dominio = null;
      if (websiteHref) {
        try {
          const url = new URL(websiteHref);
          dominio = url.hostname.replace(/^www\./, '');
        } catch {}
      }

      if (!dominio || dominiosVistos.has(dominio)) continue;
      dominiosVistos.add(dominio);

      empresas.push({ nome: nome.trim(), dominio, telefone: telefone || null });
      emitir(`  ✅ ${empresas.length}. ${nome.trim()} — ${dominio}`);

    } catch {}
  }

  return empresas;
}

async function coletarLinks(page, alvo, emitir) {
  const links    = new Set();
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

    const textoFeed = await page.locator('div[role="feed"]').textContent({ timeout: 3000 }).catch(() => '');
    if (textoFeed.includes('Você chegou ao fim') || textoFeed.includes('end of the list')) break;

    const scrollAmt = 600 + Math.floor(Math.random() * 600);
    await page.evaluate((amt) => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) feed.scrollBy(0, amt);
    }, scrollAmt);

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
