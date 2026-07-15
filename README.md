# Lead Agent AI

Agente de geração de leads B2B no Brasil com inteligência artificial. Busca empresas por nicho e região, consulta WHOIS e CNPJ automaticamente e exporta os dados em planilha Excel.

Suporta dois modelos de IA:
- **Claude (Anthropic)** — pago, mais preciso
- **Gemini (Google)** — gratuito

Cada modelo pode ser usado de duas formas: pelo **terminal** ou pela **interface web** no navegador.

## Como usar a interface web
npm run web

---

## Requisitos

### O que você NÃO precisa
- Java / JDK — este projeto é 100% JavaScript, não usa Java

### O que você PRECISA instalar

#### 1. Node.js
Versão recomendada: **20.x LTS** ou superior (18.x também funciona).

Verifique se já está instalado:
```bash
node --version
npm --version
```

Se não estiver instalado, baixe em: https://nodejs.org  
Escolha a versão **LTS** e instale normalmente.

#### 2. Git (opcional, para clonar o projeto)
Baixe em: https://git-scm.com

#### 3. VS Code (recomendado como IDE)
Baixe em: https://code.visualstudio.com

---

## Instalação do projeto

### Opção A — Clonar pelo Git
Abra o terminal e execute:
```bash
git clone https://github.com/Levartosky/lead-agent.git
cd lead-agent
npm install
```

### Opção B — Baixar o ZIP
1. Acesse https://github.com/Levartosky/lead-agent
2. Clique em **Code > Download ZIP**
3. Extraia o arquivo
4. Abra a pasta no terminal e execute:
```bash
npm install
```

---

## Como abrir o projeto na IDE

### VS Code
1. Abra o VS Code
2. Vá em **File > Open Folder**
3. Selecione a pasta `lead-agent`
4. Para abrir o terminal integrado: **View > Terminal** (ou `Ctrl + '`)

---

## Configuração das chaves de API

O projeto precisa de uma chave de API para funcionar. Crie um arquivo chamado `.env` na raiz do projeto (mesma pasta onde está o `package.json`).

### Como criar o arquivo .env

No terminal, dentro da pasta do projeto:

**Windows (PowerShell):**
```powershell
New-Item .env
```

**Ou crie manualmente** pelo VS Code: clique com botão direito na pasta > New File > `.env`

### Conteúdo do arquivo .env

Escolha o modelo que vai usar e preencha a chave correspondente:

```env
# Para usar o Claude (pago)
ANTHROPIC_API_KEY=sua_chave_aqui

# Para usar o Gemini (gratuito)
GEMINI_API_KEY=sua_chave_aqui
```

Você pode ter as duas chaves no mesmo arquivo se quiser usar os dois modelos.

### Onde obter as chaves

**Claude (Anthropic) — pago:**
1. Acesse https://console.anthropic.com
2. Faça login ou crie uma conta
3. Vá em **API Keys > Create Key**
4. Copie a chave e cole no `.env` no lugar de `sua_chave_aqui`

**Gemini (Google) — gratuito:**
1. Acesse https://aistudio.google.com/apikey
2. Faça login com sua conta Google
3. Clique em **Create API Key**
4. Copie a chave e cole no `.env` no lugar de `sua_chave_aqui`

---

## Como rodar o projeto

O projeto tem 4 modos de uso. Abra o terminal na pasta do projeto e escolha um:

### Modo 1 — Claude pelo Terminal
Usa o modelo Claude da Anthropic. Interage via perguntas no próprio terminal.
```bash
npm start
```
O terminal vai perguntar:
- Qual o nicho? (ex: `clínica veterinária`)
- Qual a região? (ex: `São Paulo SP`)
- Quantos leads? (ex: `10`)

### Modo 2 — Claude pela Interface Web
Mesma IA do modo anterior, mas com interface visual no navegador.
```bash
npm run web
```
Depois abra o navegador em: **http://localhost:3000**

### Modo 3 — Gemini pelo Terminal
Usa o Gemini do Google (gratuito). Interage via terminal.
```bash
npm run gemini
```
Funciona igual ao Modo 1: responde as perguntas de nicho, região e quantidade.

### Modo 4 — Gemini pela Interface Web
Gemini com interface visual no navegador.
```bash
npm run web:gemini
```
Depois abra o navegador em: **http://localhost:3001**

---

## Como usar a interface web

1. Execute um dos comandos web acima (`npm run web` ou `npm run web:gemini`)
2. Abra o navegador no endereço indicado
3. Preencha os campos:
   - **Nicho / Segmento**: o tipo de empresa que quer encontrar (ex: `escola`, `dentista`, `mecânico`)
   - **Região**: cidade e estado (ex: `Curitiba PR`, `Rio de Janeiro RJ`)
   - **Quantidade**: entre 1 e 50 leads
4. Clique em **Iniciar Busca**
5. Acompanhe o progresso em tempo real no painel de atividade
6. Quando concluir, clique em **Baixar Planilha Excel**

---

## Onde ficam os arquivos gerados

As planilhas Excel são salvas automaticamente na pasta `leads/` dentro do projeto.  
O nome do arquivo inclui o nicho, a região e a data/hora da geração.

Exemplo:
```
leads/leads_dentista_sao_paulo_sp_2026-05-26T14-30-00.xlsx
```

---

## Estrutura do projeto

```
lead-agent/
├── src/
│   ├── index.js          # Entrada — Claude via terminal
│   ├── index-gemini.js   # Entrada — Gemini via terminal
│   ├── server.js         # Servidor web — Claude
│   ├── server-gemini.js  # Servidor web — Gemini
│   ├── agent.js          # Lógica do agente Claude
│   ├── agent-gemini.js   # Lógica do agente Gemini
│   ├── tools/
│   │   ├── cnpj.js       # Consulta CNPJ via API pública
│   │   ├── leads.js      # Gerenciamento e exportação dos leads
│   │   └── whois.js      # Consulta WHOIS no registro.br
│   └── utils/
│       └── excel.js      # Geração da planilha Excel
├── public/
│   └── index.html        # Interface web (HTML/CSS/JS)
├── leads/                # Planilhas geradas (criada automaticamente)
├── .env                  # Suas chaves de API (NÃO versionar)
├── .gitignore
└── package.json
```

---

## Solução de problemas comuns

**Erro: `ANTHROPIC_API_KEY não configurada`**  
O arquivo `.env` não existe ou a chave está como `sua_chave_aqui`. Crie o arquivo e cole a chave real.

**Erro: `Cannot find module`**  
Execute `npm install` para instalar as dependências.

**Porta já em uso (EADDRINUSE)**  
Outra instância do servidor já está rodando. Feche o terminal anterior ou troque a porta no `.env`:
```env
PORT=3002
```

**`node` não é reconhecido como comando**  
Node.js não está instalado ou não foi adicionado ao PATH. Reinstale pelo site oficial: https://nodejs.org
