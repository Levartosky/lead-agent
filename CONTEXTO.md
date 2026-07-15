# CONTEXTO.md — Documento de contexto do projeto lead-agent

> **Para quem é este documento:** este arquivo dá visão global do projeto para qualquer pessoa (ou Claude Code) que entre agora. Ele descreve o que o produto faz, a arquitetura, o rumo estratégico e todas as atualizações até 2026-07-14.
>
> **Dica:** para o Claude Code carregar este contexto automaticamente, crie um `CLAUDE.md` na raiz com a linha `Leia o arquivo CONTEXTO.md antes de qualquer tarefa.` — ou renomeie este arquivo para `CLAUDE.md`.

---

## 1. O que é o projeto

**lead-agent** é um gerador de leads B2B para o Brasil. O usuário informa **nicho** (ex: "dentista"), **região** (ex: "São Paulo SP") e **quantidade**, e o sistema entrega uma **planilha Excel** com empresas contendo **email + telefone + CNPJ** (qualificação mínima: lead só é salvo se tiver email E telefone).

O produto será **vendido como SaaS** (ver seção 8 — decisões de negócio). Somos dois sócios trabalhando nele.

---

## 2. Rumo estratégico — MOTOR RECEITA FEDERAL É O CAMINHO

Este é o ponto mais importante do documento:

**O futuro do produto é o motor Receita Federal.** Ele consulta uma base local SQLite construída a partir dos dados abertos de CNPJ da Receita Federal, e resolve os problemas dos motores antigos:

| | Motores antigos (Agente IA / RPA) | Motor Receita Federal |
|---|---|---|
| Velocidade | 15 leads em ~6 min | 500+ leads em **< 20 ms** de query |
| Escala | Inviável para 500–1000 leads | 1000 leads sem esforço |
| Risco | Bloqueio do Google Maps / registro.br | Zero — banco local, sem scraping |
| Custo | Tokens de API (modo Agente) | Zero |
| Fonte | Maps + WHOIS + cnpj.ws | Base oficial da RFB (23,9M estabelecimentos) |

**Estado atual da UI:** os botões "Agente IA" e "RPA" estão **ocultos** (`display:none` no [public/index.html](public/index.html)) e o modo padrão é `receita`. O backend continua suportando os 3 modos — os motores antigos ficam como fallback/legado, não foram removidos.

O motor Receita Federal foi **validado na prática**: busca de 500 leads de academia em São Paulo SP feita com sucesso pelo usuário.

---

## 3. Os três motores

### Motor 1 — Agente IA (legado, oculto na UI)
- [src/agent.js](src/agent.js) (Claude) e [src/agent-gemini.js](src/agent-gemini.js) (Gemini)
- LLM orquestra as ferramentas (Maps, WHOIS, CNPJ) via tool-use
- Requer `ANTHROPIC_API_KEY` ou `GEMINI_API_KEY` no `.env`
- Custo por token; lento

### Motor 2 — RPA (legado, oculto na UI, mas recém-otimizado)
- [src/rpa.js](src/rpa.js) + [src/tools/maps.js](src/tools/maps.js)
- Fluxo: Google Maps (Playwright) → WHOIS registro.br → API cnpj.ws → fallback: raspar CNPJ do site da empresa
- Sem custo de tokens, mas depende de scraping (risco de bloqueio)
- Recebeu grandes melhorias de paralelismo e stealth neste commit (ver seção 6)

### Motor 3 — Receita Federal (ATUAL, padrão) ⭐
- [src/tools/receita.js](src/tools/receita.js) — consulta ao SQLite
- [src/executor-receita.js](src/executor-receita.js) — orquestração: busca → salva leads → gera Excel → emite eventos SSE
- [src/scripts/importar-receita.js](src/scripts/importar-receita.js) — importador da base (roda uma vez; `npm run importar-receita`)
- Busca por **CNAE + município** com índice; sem rede, sem risco, instantâneo

---

## 4. Arquitetura e mapa de arquivos

```
lead-agent/
├── src/
│   ├── server.js              # Servidor Express (porta 3000) — roteia os 3 modos
│   ├── executor-receita.js    # ⭐ Motor Receita Federal
│   ├── rpa.js                 # Motor RPA (paralelo, 5 workers)
│   ├── agent.js               # Motor Agente IA (Claude)
│   ├── agent-gemini.js        # Motor Agente IA (Gemini)
│   ├── index*.js              # Entradas via terminal (start / gemini / rpa)
│   ├── server-gemini.js       # Servidor web Gemini (porta 3001)
│   ├── scripts/
│   │   ├── importar-receita.js          # ⭐ Importa ZIPs da RFB → data/receita.db
│   │   ├── validar-sinonimos.js         # Confere dicionário de nichos contra o banco real
│   │   └── detectar-emails-genericos.js # Gera tabela emails_genericos (filtro de qualidade)
│   ├── config/
│   │   └── sinonimos-cnae.js  # Dicionário nicho → raiz de CNAE (18 validados + 34 pendentes)
│   ├── middleware/
│   │   ├── seguranca.js       # Helmet, CORS restrito, rate limit (história 4.1)
│   │   └── validar.js         # Middleware genérico de validação zod (história 4.2)
│   ├── validation/
│   │   └── schemas.js         # Schemas zod das rotas (história 4.2)
│   ├── tools/
│   │   ├── receita.js         # ⭐ Query SQLite: sinônimos + CNAE + município + filtros de qualidade
│   │   ├── maps.js            # Scraping Google Maps (Playwright + stealth)
│   │   ├── whois.js           # WHOIS registro.br
│   │   ├── cnpj.js            # API pública cnpj.ws
│   │   └── leads.js           # Gerenciador de leads + exportação
│   └── utils/
│       ├── excel.js           # Geração da planilha (exceljs)
│       └── historico.js       # Dedup de domínios entre execuções (RPA)
├── public/index.html          # Interface web (SPA única, SSE para tempo real)
├── data/receita.db            # ⚠️ Base RFB 5,2 GB — NÃO versionada (.gitignore)
├── leads/                     # Planilhas geradas
└── .env                       # Chaves de API (só p/ modo Agente) — NÃO versionado
```

**Fluxo web:** `POST /api/iniciar` (nicho, região, quantidade, modo) → servidor escolhe o executor → eventos em tempo real via **SSE** (`inicio`, `log`, `ferramenta`, `lead_salvo`, `gerando_excel`, `fim`) → botão de download da planilha ao final. Sessões ficam **em memória** no server (relevante para o plano de deploy).

---

## 5. Motor Receita Federal em detalhe

### O banco `data/receita.db` (SQLite, 5,2 GB)

```sql
cnaes(codigo PK, descricao)                 -- 1.359 linhas
municipios(codigo PK, nome)                 -- 5.572 linhas (nome COM aspas: '"SAO PAULO"')
empresas(cnpj_basico PK, razao_social)      -- 68.629.147 linhas (cnpj_basico COM aspas)
estabelecimentos(cnpj PK, cnpj_basico, nome, email, telefone, cnae, uf,
                 municipio, logradouro, numero, bairro, cep, matriz)
                                            -- 23.931.353 linhas (valores LIMPOS)
importados(arquivo PK, importado_em)        -- checkpoint por ZIP (todos os 10 marcados)

INDEX idx_cnae_uf_mun ON estabelecimentos(cnae, uf, municipio)
INDEX idx_uf_mun      ON estabelecimentos(uf, municipio)
```

Só entram no banco estabelecimentos **ativos** (situação 02) **com email válido e telefone** — por isso 23,9M de um universo maior.

### ⚠️ Quirks do banco — LEIA ANTES DE MEXER EM receita.js

- `empresas.cnpj_basico` está armazenado **COM aspas** (ex: `"41273589"`) — legado do primeiro import.
- `estabelecimentos.cnpj_basico` está **LIMPO** (ex: `41273589`) — corrigido no reimport.
- O JOIN em [src/tools/receita.js](src/tools/receita.js) compensa: `ON em.cnpj_basico = '"' || e.cnpj_basico || '"'`.
- `municipios.nome` também tem aspas; o SELECT usa `REPLACE()` para limpar.
- `estabelecimentos.municipio` guarda o **nome** da cidade (não o código), limpo, MAIÚSCULO e sem acentos.
- `cnaes.descricao` **pode vir com aspas** (o importador só faz `.trim()`, não remove aspas como faz para os outros campos) — por isso o SELECT de atividade também usa `REPLACE()`.
- `estabelecimentos.matriz` é `INTEGER`: `1` = matriz, `2` = filial (confirmado em `importar-receita.js`, linha ~329).

### Qualidade dos resultados (história 3.4, 2026-07-15)

`buscarLeadsReceita` agora aplica três filtros de qualidade na query principal:
- **Somente matriz**: `AND e.matriz = 1` — evita filiais duplicando a mesma empresa na planilha.
- **Telefone-lixo**: função pura `ehTelefoneValido()` registrada como UDF do SQLite (`db.function('telefone_valido', ...)`) — descarta números onde o assinante (dígitos após o DDD) é o mesmo dígito repetido (`9999-9999`, `0000-0000` etc).
- **Email genérico** (ex.: email de escritório de contabilidade repetido em centenas de CNPJs de clientes): filtrado via `NOT IN (SELECT email FROM emails_genericos)`, mas **só se essa tabela já existir** — ela é gerada por [src/scripts/detectar-emails-genericos.js](src/scripts/detectar-emails-genericos.js) (`npm run detectar-emails-genericos`), que precisa ser rodado contra o banco real (varre as 23,9M linhas de `estabelecimentos`). Se a tabela não existir, a busca segue normalmente e retorna um aviso em `resultado.avisos` (propagado pro SSE como `log`).

Planilha ganhou 3 colunas novas (sempre no fim, pra não deslocar índices de formatação existentes): **CNAE/Atividade**, **Cidade**, **Endereço** (este último montado por `formatarEndereco()` a partir de logradouro/número/bairro/CEP).

Tudo isso foi testado de ponta a ponta com um banco SQLite fake (schema idêntico, sem dados reais) antes do commit — ver `test/qualidade-resultados.test.js` para os testes permanentes das funções puras.

### Sinônimos de nicho

Dicionário extraído para [src/config/sinonimos-cnae.js](src/config/sinonimos-cnae.js) (história 3.3, 2026-07-15) — antes vivia inline em `receita.js`. Traduz termo coloquial → raiz que aparece na descrição do CNAE: `dentista→ODONTOL`, `médico→MEDIC`, `advogado→ADVOCA`, `contador→CONTAB`, `academia→CONDICIONAMENTO FISICO`, `farmácia→FARMAC`, etc. Além disso há um stemming simples (corta 2 chars finais de palavras > 6 letras) e sugestão de termos parecidos via distância de Levenshtein quando nenhum CNAE bate.

---

## 5.1 Segurança — Hardening HTTP e validação de entrada (histórias 4.1/4.2, 2026-07-15)

### Hardening HTTP básico ([src/middleware/seguranca.js](src/middleware/seguranca.js))
- **Helmet**: headers de segurança padrão (CSP, HSTS, X-Frame-Options, X-Content-Type-Options etc.) em toda resposta.
- **CORS restrito**: só aceita `origin` igual à variável de ambiente `APP_ORIGIN` (default `http://localhost:3000` em dev). **Definir `APP_ORIGIN` no `.env` de produção** quando o domínio final existir (ver Épico 7.3).
- **Limite de payload**: `express.json({ limit: '10kb' })` — corpo maior que isso recebe `413` antes mesmo de chegar na lógica de negócio.
- **Rate limit**: 100 requisições/minuto por IP, aplicado só em `/api/*` (não trava o carregamento de assets estáticos da SPA). Primeira barreira, grossa — limite por usuário autenticado é a história 4.3, que depende do Épico 0/1.

### Validação de entrada ([src/validation/schemas.js](src/validation/schemas.js) + [src/middleware/validar.js](src/middleware/validar.js))
- Schemas **zod** para `POST /api/iniciar` (nicho, região, quantidade, modo) e para o parâmetro `:id` de `/api/eventos/:id` e `/api/download/:id`.
- Erro de validação → `400` com `{ erro, detalhes: [{ campo, mensagem }] }`, um item por campo inválido.
- `quantidade` é coagida de string pra number automaticamente (`z.coerce.number()`); `modo` tem allowlist estrita (`agente`/`rpa`/`receita`) — um valor fora disso já não passa da validação, então o roteamento de executor em `server.js` nunca recebe modo inesperado.
- **Confirmado**: todas as queries SQL do projeto (em `receita.js`, `importar-receita.js`, `detectar-emails-genericos.js`, `validar-sinonimos.js`) já usavam `?` parametrizado antes desta história — nenhuma interpolação direta de input do usuário em SQL foi encontrada na varredura feita para fechar esta história.

Testado manualmente de ponta a ponta (headers presentes, erros 400 com mensagem por campo, payload grande rejeitado com 413, rate limit ativando em ~100 req/min) além de 10 testes automatizados em `test/validacao.test.js`.

**Nota de dependências**: `npm audit fix` (sem `--force`) resolveu 3 das 5 vulnerabilidades pré-existentes nas dependências transitivas antigas (form-data, qs, tmp). Resta uma (`uuid`, via `exceljs`) que só se resolve com downgrade do `exceljs` — deixada de lado por ora por ser breaking change, não introduzida por esta história.

O arquivo é dividido em dois grupos:
- `SINONIMOS_VALIDADOS` — os 18 originais, **validados contra o banco** em 2026-07-13.
- `SINONIMOS_NOVOS_PENDENTE_VALIDACAO` — mais 34 nichos (petshop, salão de beleza, imobiliária, restaurante, oficina, escola, transportadora, hotel, construtora, seguros, ótica, joalheria, gráfica, etc.), mapeados a partir da nomenclatura oficial do CNAE 2.3, mas **ainda não conferidos linha a linha contra `receita.db`** (banco indisponível no momento da expansão). Rodar `npm run validar-sinonimos` numa máquina com o banco antes de considerar a história 3.3 encerrada — o script reporta qualquer raiz sem correspondência.

Testes automatizados em `test/sinonimos-cnae.test.js` e `test/receita-matching.test.js` (`npm test`, Node test runner nativo, sem dependência nova) cobrem a integridade do dicionário e a lógica pura de matching/sugestão.

### Importação (já feita — não precisa rodar de novo)

`npm run importar-receita "C:\pasta\com\zips"` — espera `Cnaes.zip`, `Municipios.zip`, `Empresas0-9.zip`, `Estabelecimentos0-9.zip` dos [dados abertos de CNPJ da RFB](https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/). Streaming ZIP→CSV (ISO-8859-1), lotes de 10k em transação, checkpoint por arquivo (retomável). A RFB atualiza a base **mensalmente** — reimportação periódica está no backlog de produção.

**Bug histórico importante:** o CSV da RFB envolve valores em aspas (`"63621960"`). A primeira versão do importador não removia as aspas, o CNPJ concatenado ficava com 20 chars e **todos** os registros eram descartados. Corrigido com `strip()` por campo; reimportação feita com sucesso.

---

## 6. Atualizações deste commit (changes de 2026-07-14)

Tudo abaixo está no working tree e será commitado em sequência:

### Novos arquivos (motor Receita Federal completo)
- [src/tools/receita.js](src/tools/receita.js) — consulta SQLite (sinônimos, município, query indexada)
- [src/executor-receita.js](src/executor-receita.js) — executor do modo `receita`
- [src/scripts/importar-receita.js](src/scripts/importar-receita.js) — importador da base RFB

### [src/server.js](src/server.js)
- Aceita `modo='receita'` e roteia para `executarReceita`
- Limite de quantidade subiu de **50 → 1000**

### [public/index.html](public/index.html)
- Terceiro botão de modo **"Receita Federal"** — agora o padrão (`modoAtual = 'receita'`)
- Botões "Agente IA" e "RPA" ocultos com `display:none` (backend mantém os 3)
- Campo quantidade: máx 1000, valor inicial 20

### [src/rpa.js](src/rpa.js) — paralelização do enriquecimento
- Enriquecimento agora roda em **pool de 5 workers paralelos** (antes: for sequencial com pausa de 1,2s entre empresas)
- **Semáforo WHOIS**: máx. 3 consultas simultâneas ao registro.br
- Raspagem de CNPJ do site: as 5 URLs candidatas são buscadas **em paralelo** (`Promise.allSettled`; antes sequencial, até 40s)
- Histórico de domínios salvo **uma única vez** ao final (antes: a cada lead)

### [src/tools/maps.js](src/tools/maps.js) — escala + anti-detecção
- **Múltiplas variações de query** (até 12: "X em Y", "X zona norte Y", "X Y LTDA"...) para superar o limite de ~200 resultados por busca do Maps; meta de pool = 8× a quantidade pedida
- **Novo contexto de browser por busca** = nova sessão/fingerprint; user-agent sorteado de uma lista de 5
- **Script de furtividade** (`aplicarFurtividade`): `navigator.webdriver = undefined`, `window.chrome` fake, plugins fake, languages/platform/hardwareConcurrency/deviceMemory patcheados, permissions API corrigida
- Flags de launch: `--disable-blink-features=AutomationControlled` etc.
- Intervalo aleatório de 4–9s entre buscas; scroll com offset e incrementos variáveis

### Configuração
- [package.json](package.json): novas deps `better-sqlite3`, `iconv-lite`, `node-stream-zip`; novo script `importar-receita`. (A chave `scripts` duplicada que existia antes **já foi corrigida**.)
- [.gitignore](.gitignore): adicionado `data/` — **o banco de 5,2 GB não vai para o git** (ver seção 9)
- [README.md](README.md): nota rápida do `npm run web`

### Correções anteriores relevantes (já no working tree)
- Sinônimo `ACADEMIA` apontava para `'GINAST'`, que não existe em nenhum CNAE → corrigido para `CONDICIONAMENTO FISICO` (CNAE 9313-1/00)

---

## 7. Como rodar

```bash
npm install
npm run web        # http://localhost:3000
```

- Modo **Receita Federal** (padrão): não precisa de nenhuma chave de API — só do `data/receita.db`.
- Modos Agente IA: precisam de `.env` com `ANTHROPIC_API_KEY` e/ou `GEMINI_API_KEY`.
- Planilhas saem em `leads/`.

---

## 8. Decisões de negócio e plano de produção (definidas em 2026-07-13)

O produto será vendido. Modelo definido (proposta a validar entre os sócios):

- **1 crédito = 1 lead entregue**; pacotes via **Pix** (200/500/1000...)
- **Trial**: 20 créditos após confirmar email
- **Free** = saldo 0 (loga, vê histórico e prévia de contagem, mas não gera leads); **Premium** = saldo > 0; **Admin** = role à parte
- **Stack de produção**: **Supabase** (Auth + Postgres) para usuários/créditos/histórico; `receita.db` continua **SQLite local no VPS**
- **Dedup por usuário**: lead entregue não se repete por **6 meses** (tabela `delivered_leads` no Supabase)
- **Deploy**: **VPS + pm2 + Caddy** (HTTPS; basic auth na fase pré-login). **Vercel foi descartada** (banco de 5,2 GB no disco + SSE + sessões em memória não cabem em serverless)

### Backlog (9 épicos, 41 histórias) — artifacts publicados
- Backlog completo: https://claude.ai/code/artifact/73e7f80e-504d-459b-b720-00e1185a7fdb
  - Fase 1 — Fundação: Supabase, auth, confirmação de email
  - Fase 2 — Monetização: créditos, dedup, pacotes
  - Fase 3 — Operação: painel admin, logs, Pix
  - Fase 4 — Produção: VPS, CI/CD, atualização mensal da base RFB
- Diagrama do fluxo do motor: https://claude.ai/code/artifact/2848e2e7-f403-430d-a9df-061c27b38f3e

---

## 9. Setup para um novo dev (IMPORTANTE para o sócio)

1. `git clone https://github.com/Levartosky/lead-agent.git && cd lead-agent && npm install`
2. **O banco `data/receita.db` (5,2 GB) NÃO vem no clone** — `data/` está no `.gitignore`. Duas opções:
   - **Opção A (mais simples):** receber o arquivo `receita.db` pronto (pen drive / drive) e colocar em `data/receita.db`
   - **Opção B:** baixar os 22 ZIPs dos dados abertos de CNPJ da RFB e rodar `npm run importar-receita "C:\pasta\dos\zips"` (demora bastante; é retomável se interromper)
3. `npm run web` → http://localhost:3000 → modo Receita Federal já vem selecionado
4. `.env` só é necessário se for testar os modos Agente IA (ocultos na UI)

---

## 10. Quirks, armadilhas e próximos passos técnicos

**Armadilhas conhecidas:**
- As aspas no banco (seção 5) — qualquer query nova em `empresas`/`municipios` precisa lidar com elas
- Sessões SSE ficam em memória no server — reiniciar o server mata sessões em andamento
- O matching de CNAE é feito em JS (não em SQL) porque o `upper()` do SQLite não trata acentos

**Melhorias mapeadas (não feitas ainda):**
- Qualidade dos resultados: hoje a busca por "dentista" mistura clínicas com fornecedores de equipamentos odontológicos (o CNAE raiz `ODONTOL` pega ambos)
- Filtrar só estabelecimentos **matriz** (`matriz = 1`) para evitar filiais duplicadas
- Paginação/offset para buscar além de 1000 resultados
- Mais sinônimos no mapa de CNAE
- Todo o backlog de produção da seção 8

---

*Última atualização: 2026-07-14, refletindo o working tree que será commitado após o commit `3f5bbdf`.*
