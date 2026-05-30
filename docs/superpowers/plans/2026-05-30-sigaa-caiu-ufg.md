# sigaa-caiu-ufg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaptar o fork sigaa-caiu-ufg para monitorar o SIGAA da UFG em vez da UFPB, atualizando URLs do worker, configuração do Cloudflare e branding do frontend.

**Architecture:** Cloudflare Worker (TypeScript) com cron a cada 3 minutos fazendo health check em 4 camadas no SIGAA UFG, persistindo no D1. Frontend Next.js no Vercel consome a API pública do worker. O subdomain `ufg.sigaacaiu.com` é apontado via CNAME pelo dono do domínio original.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare D1 (SQLite), Wrangler CLI, Next.js 15, Vercel

---

## Mapa de arquivos

| Arquivo | Ação | O que muda |
|---|---|---|
| `worker/src/health.ts` | Modify | 4 constantes de URL (linhas 9–13) |
| `worker/wrangler.jsonc` | Modify | `name`, `account_id`, `database_name`, `database_id` |
| `web/src/app/layout.tsx` | Modify | Todos os textos/URLs UFPB → UFG |
| `web/src/app/page.tsx` | Modify | Texto descritivo UFPB → UFG (linha 88) |
| `README.md` | Modify | Atualizar descrição do projeto |

---

## Task 1: Atualizar URLs do worker

**Files:**
- Modify: `worker/src/health.ts:9-13`

- [ ] **Step 1: Substituir as 4 constantes de URL**

Abrir `worker/src/health.ts` e substituir as linhas 9–13:

```ts
// Antes
const SIGAA_URL = "https://sigaa.ufpb.br/sigaa/verTelaLogin.do";
const PORTAL_URL = "https://sigaa.ufpb.br/publico/";
const PORTAL_ORIGIN = "https://sigaa.ufpb.br";
const BUNDLE_REGEX = /\/publico\/assets\/[a-zA-Z0-9._-]+\.js/;
const LOGIN_FORM_URL = "https://sigaa.ufpb.br/sigaa/logon.jsf";

// Depois
const SIGAA_URL = "https://sigaa.sistemas.ufg.br/sigaa/verTelaLogin.do";
const PORTAL_URL = "https://sigaa.sistemas.ufg.br/publico/";
const PORTAL_ORIGIN = "https://sigaa.sistemas.ufg.br";
const BUNDLE_REGEX = /\/publico\/assets\/[a-zA-Z0-9._-]+\.js/;
const LOGIN_FORM_URL = "https://sigaa.sistemas.ufg.br/sigaa/logon.jsf";
```

- [ ] **Step 2: Verificar que nenhuma outra referência a ufpb.br ficou no worker**

```bash
grep -r "ufpb" worker/src/
```

Saída esperada: nenhuma linha.

- [ ] **Step 3: Commit**

```bash
git add worker/src/health.ts
git commit -m "feat(worker): point health checks to SIGAA UFG"
```

---

## Task 2: Atualizar configuração do Wrangler

**Files:**
- Modify: `worker/wrangler.jsonc`

> **Pré-requisito:** Você precisa ter o Wrangler autenticado com sua conta Cloudflare (`wrangler login`). O `account_id` e `database_id` serão gerados nos passos abaixo.

- [ ] **Step 1: Obter seu account_id Cloudflare**

```bash
wrangler whoami
```

Copie o `Account ID` exibido.

- [ ] **Step 2: Criar o banco D1**

```bash
wrangler d1 create sigaa-caiu-ufg-db
```

Saída esperada (exemplo):
```
✅ Successfully created DB 'sigaa-caiu-ufg-db'

[[d1_databases]]
binding = "DB"
database_name = "sigaa-caiu-ufg-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copie o `database_id` gerado.

- [ ] **Step 3: Atualizar wrangler.jsonc**

Substituir o conteúdo de `worker/wrangler.jsonc` com os valores obtidos acima:

```jsonc
{
  "name": "sigaa-caiu-ufg-worker",
  "account_id": "<SEU_ACCOUNT_ID>",
  "main": "src/index.ts",
  "compatibility_date": "2024-09-23",
  "placement": {
    "mode": "smart",
    "hint": "sam"
  },
  "triggers": {
    "crons": ["* * * * *"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "sigaa-caiu-ufg-db",
      "database_id": "<DATABASE_ID_GERADO>"
    }
  ],
  "observability": {
    "logs": {
      "enabled": true,
      "invocation_logs": true
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.jsonc
git commit -m "chore(worker): configure wrangler for UFG deployment"
```

---

## Task 3: Aplicar schema no banco D1

**Files:** nenhum arquivo modificado — operação de infra.

- [ ] **Step 1: Aplicar schema principal**

```bash
cd worker
wrangler d1 execute sigaa-caiu-ufg-db --file=schema.sql
```

Saída esperada: `✅ Successfully executed SQL`

- [ ] **Step 2: Aplicar migration de layers**

```bash
wrangler d1 execute sigaa-caiu-ufg-db --file=schema_migration_layers.sql
```

Saída esperada: `✅ Successfully executed SQL`

- [ ] **Step 3: Verificar tabelas criadas**

```bash
wrangler d1 execute sigaa-caiu-ufg-db --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Saída esperada: tabelas `checks` e `incidents` presentes.

---

## Task 4: Deploy do worker

**Files:** nenhum arquivo modificado — operação de deploy.

- [ ] **Step 1: Instalar dependências**

```bash
cd worker
npm install
```

- [ ] **Step 2: Deploy**

```bash
wrangler deploy
```

Saída esperada:
```
✅ Deployed sigaa-caiu-ufg-worker
  https://sigaa-caiu-ufg-worker.<seu-subdominio>.workers.dev
```

Anote a URL do worker — será usada na Task 6.

- [ ] **Step 3: Verificar que a API responde**

```bash
curl https://sigaa-caiu-ufg-worker.<seu-subdominio>.workers.dev/api/status
```

Saída esperada: JSON com `"status": "online"` ou `"offline"` (dependendo do estado do SIGAA UFG no momento). Não deve retornar erro 500.

- [ ] **Step 4: (Opcional) Configurar secrets para E2E e Telegram**

```bash
wrangler secret put SIGAA_MONITOR_USER
wrangler secret put SIGAA_MONITOR_PASS
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

Cada comando pedirá o valor via prompt interativo.

---

## Task 5: Atualizar branding do frontend

**Files:**
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: Atualizar layout.tsx**

Substituir o conteúdo do `export const metadata` e a URL canônica em `web/src/app/layout.tsx`:

```ts
export const metadata: Metadata = {
  title: "SIGAA Caiu? — Status do SIGAA UFG",
  description:
    "O SIGAA da UFG esta no ar? Monitor em tempo real com historico de uptime, tempo de resposta e incidentes. Verifica automaticamente a cada 3 minutos.",
  keywords: [
    "SIGAA", "UFG", "SIGAA caiu", "SIGAA fora do ar", "SIGAA status",
    "SIGAA UFG", "sistema academico UFG", "SIGAA lento", "SIGAA online",
    "status SIGAA", "monitor SIGAA",
  ],
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤔</text></svg>",
  },
  metadataBase: new URL("https://ufg.sigaacaiu.com"),
  openGraph: {
    title: "SIGAA Caiu? — O SIGAA da UFG ta no ar?",
    description:
      "Monitor em tempo real do SIGAA da UFG. Veja se o sistema esta no ar, lento ou fora do ar.",
    url: "https://ufg.sigaacaiu.com",
    siteName: "SIGAA Caiu?",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "SIGAA Caiu? — Status do SIGAA UFG",
    description:
      "O SIGAA da UFG esta no ar? Confira em tempo real.",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://ufg.sigaacaiu.com",
  },
};
```

- [ ] **Step 2: Atualizar page.tsx**

Na linha 88 de `web/src/app/page.tsx`, substituir:

```tsx
// Antes
Monitor do SIGAA (Sistema Integrado de Gestao de Atividades Academicas) da UFPB.

// Depois
Monitor do SIGAA (Sistema Integrado de Gestao de Atividades Academicas) da UFG.
```

- [ ] **Step 3: Verificar que não restaram referências a UFPB no frontend**

```bash
grep -r "ufpb\|UFPB" web/src/
```

Saída esperada: nenhuma linha.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/layout.tsx web/src/app/page.tsx
git commit -m "feat(web): update branding from UFPB to UFG"
```

---

## Task 6: Deploy do frontend no Vercel

**Files:** nenhum arquivo modificado — operação de deploy.

> **Pré-requisito:** Ter a URL do worker gerada na Task 4, Step 2.

- [ ] **Step 1: Instalar dependências do frontend**

```bash
cd web
npm install
```

- [ ] **Step 2: Fazer deploy no Vercel com a env var do worker**

Se ainda não tiver o CLI Vercel:
```bash
npm i -g vercel
```

Deploy:
```bash
cd web
vercel --prod
```

Durante o setup interativo, quando perguntado sobre variáveis de ambiente, adicionar:
```
NEXT_PUBLIC_API_URL = https://sigaa-caiu-ufg-worker.<seu-subdominio>.workers.dev
```

Ou, se o projeto já estiver configurado no Vercel, adicionar via dashboard em **Settings → Environment Variables**.

- [ ] **Step 3: Verificar o deploy**

Acessar a URL gerada pelo Vercel (ex: `https://sigaa-caiu-ufg.vercel.app`) e confirmar:
- Título da página mostra "Status do SIGAA UFG"
- O status do SIGAA UFG está sendo exibido (online/offline/degradado)
- Sem erros no console do navegador

---

## Task 7: Atualizar README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Atualizar o README**

Substituir o conteúdo de `README.md`:

```markdown
# SIGAA Caiu? — UFG

Monitor em tempo real do [SIGAA da UFG](https://sigaa.sistemas.ufg.br). Verifica automaticamente se o sistema esta no ar, lento ou fora do ar a cada 3 minutos.

**Site:** [ufg.sigaacaiu.com](https://ufg.sigaacaiu.com)

Fork de [trindadetiago/sigaa-caiu](https://github.com/trindadetiago/sigaa-caiu) adaptado para a UFG.

## Como funciona

Um [Cloudflare Worker](https://workers.cloudflare.com/) faz requisicoes periodicas ao SIGAA UFG e salva o resultado num banco de dados. O frontend consome esses dados e exibe o status atual, historico e incidentes.

## API Publica

Base URL: `https://sigaa-caiu-ufg-worker.<seu-subdominio>.workers.dev`

### `GET /api/status` — Status atual
### `GET /api/history?period=24h|7d|30d` — Historico
### `GET /api/stats` — Estatisticas de uptime
### `GET /api/incidents` — Lista de incidentes
```

- [ ] **Step 2: Commit e push**

```bash
git add README.md
git commit -m "docs: update README for UFG fork"
git push origin main
```

---

## Task 8: Solicitar CNAME ao dono do domínio

Esta é uma tarefa de comunicação, não de código.

- [ ] **Step 1: Enviar ao dono do sigaacaiu.com as informações para o CNAME**

Pedir que ele adicione o seguinte registro DNS:

| Type | Name | Value |
|---|---|---|
| CNAME | `ufg` | `<URL do deployment Vercel, ex: sigaa-caiu-ufg.vercel.app>` |

- [ ] **Step 2: Após propagação do DNS, verificar o subdomínio**

```bash
curl https://ufg.sigaacaiu.com/
```

Saída esperada: HTML da página do monitor UFG.

---

## Checklist de riscos pós-deploy

Após o primeiro cron tick do worker (~3 min após o deploy), verificar:

- [ ] `GET /api/status` retorna status válido (não `null`)
- [ ] Se retornar `offline` inesperado: verificar se `/publico/` existe em `sigaa.sistemas.ufg.br` (camada 2 pode precisar de ajuste)
- [ ] Se camada 3 falhar com `login_form_missing_viewstate`: inspecionar o HTML de `https://sigaa.sistemas.ufg.br/sigaa/logon.jsf` para confirmar os seletores JSF
