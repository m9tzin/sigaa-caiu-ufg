# Design: sigaa-caiu-ufg

**Data:** 2026-05-30
**Repo:** github.com/m9tzin/sigaa-caiu-ufg
**Site alvo:** ufg.sigaacaiu.com

## Objetivo

Fork do [sigaa-caiu](https://github.com/trindadetiago/sigaa-caiu) adaptado para monitorar o SIGAA da UFG (Universidade Federal de Goiás) em tempo real. O subdomínio `ufg.sigaacaiu.com` será apontado pelo dono do domínio original via CNAME para o deployment Vercel deste fork.

## Arquitetura

Idêntica ao projeto original — nenhuma mudança estrutural:

```
Cloudflare Worker (cron a cada 3 min)
  └── health.ts com URLs do SIGAA UFG
  └── D1 próprio (sigaa-caiu-ufg-db)
  └── API pública REST

Frontend Next.js (Vercel)
  └── NEXT_PUBLIC_API_URL → worker UFG
  └── ufg.sigaacaiu.com (CNAME configurado pelo dono do domínio)
```

## Mudanças necessárias

### worker/src/health.ts

Substituir as 4 constantes de URL hardcoded:

| Constante | Original (UFPB) | UFG |
|---|---|---|
| `SIGAA_URL` | `https://sigaa.ufpb.br/sigaa/verTelaLogin.do` | `https://sigaa.sistemas.ufg.br/sigaa/verTelaLogin.do` |
| `PORTAL_URL` | `https://sigaa.ufpb.br/publico/` | `https://sigaa.sistemas.ufg.br/publico/` |
| `PORTAL_ORIGIN` | `https://sigaa.ufpb.br` | `https://sigaa.sistemas.ufg.br` |
| `LOGIN_FORM_URL` | `https://sigaa.ufpb.br/sigaa/logon.jsf` | `https://sigaa.sistemas.ufg.br/sigaa/logon.jsf` |

Os seletores JSF (`javax.faces.ViewState`, `form:login`, `form:senha`, `form:entrar`) são esperados iguais — SIGAA é a mesma plataforma base da UFRN. Deve ser verificado na primeira execução real.

### worker/wrangler.jsonc

- `name`: `sigaa-caiu-ufg-worker`
- `database_name`: `sigaa-caiu-ufg-db`
- `database_id`: gerado após `wrangler d1 create`
- `account_id`: conta Cloudflare do fork owner

### web/ (frontend)

- `NEXT_PUBLIC_API_URL`: apontar para o novo worker UFG
- Textos e branding: substituir referências a `UFPB` por `UFG` e `sigaa.ufpb.br` por `sigaa.sistemas.ufg.br`
- `<title>`, meta description e quaisquer logos/ícones referenciando UFPB

## Camadas de verificação (mantidas)

1. **Reachability** — GET `/sigaa/verTelaLogin.do`, espera 302/200, timeout 30s, degrada acima de 10s
2. **Portal SPA** — GET `/publico/`, verifica `id="root"` e bundle JS acessível
3. **Login form** — GET `/sigaa/logon.jsf`, verifica campos JSF obrigatórios
4. **E2E login** — POST com credenciais reais; requer `SIGAA_MONITOR_USER` e `SIGAA_MONITOR_PASS` como secrets no worker

## Variáveis de ambiente (worker)

| Var | Obrigatório | Descrição |
|---|---|---|
| `SIGAA_MONITOR_USER` | Não | Login UFG para E2E |
| `SIGAA_MONITOR_PASS` | Não | Senha UFG para E2E |
| `TELEGRAM_BOT_TOKEN` | Não | Notificações Telegram |
| `TELEGRAM_CHAT_ID` | Não | Chat de destino |

## Plano de deploy

1. Criar banco: `wrangler d1 create sigaa-caiu-ufg-db`
2. Aplicar schema: `wrangler d1 execute sigaa-caiu-ufg-db --file=worker/schema.sql` + `schema_migration_layers.sql`
3. Deploy do worker: `cd worker && wrangler deploy`
4. Configurar secrets opcionais via `wrangler secret put`
5. Deploy do frontend no Vercel com `NEXT_PUBLIC_API_URL` = URL do worker
6. Dono do domínio adiciona CNAME: `ufg` → deployment Vercel

## Riscos e pontos de atenção

- **Seletores JSF**: se o SIGAA UFG customizou os nomes de campo do formulário, as camadas 3 e 4 precisam de ajuste após verificação manual.
- **URL do portal público**: a existência de `/publico/` no SIGAA UFG precisa ser confirmada; se não existir, a camada 2 deve ser adaptada ou removida.
- **Credenciais E2E**: sem credenciais UFG, a camada 4 fica como `skipped` — as 3 primeiras já cobrem os casos principais.
