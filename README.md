# Fechou — respostas que fecham 🟢

**Inteligência comercial para corretores de imóveis.** O corretor importa uma
conversa exportada do WhatsApp, o app monta a linha do tempo, **analisa a
negociação** e sugere **3 respostas prontas** em 3 tons (Amigável / Direto /
Formal) — prontas pra enviar.

PWA mobile-first (funciona no celular e no desktop).

---

## Stack

- **Next.js (App Router) + React + TypeScript + Tailwind**
- **OpenAI** para a IA:
  - **GPT** (chat, JSON mode) → análise da negociação + 3 sugestões — _já no MVP_
  - **Whisper** → transcrição dos áudios `.opus` do WhatsApp — _próxima fase_
- Deploy: **Vercel**

> Por que OpenAI e não Anthropic? A transcrição de áudio exige um modelo de voz
> (Whisper). Para usar **uma chave só**, a análise/sugestões também roda na
> OpenAI (GPT). Dá pra trocar o "cérebro" da análise por outro provedor depois
> sem mexer no front.

---

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # e preencha OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

Sem `OPENAI_API_KEY` o app **roda em modo demo**: a linha do tempo é montada
normalmente e as sugestões caem num _fallback_ genérico (a rota `/api/analyze`
responde `{ ok: false, reason: "no_key" }`).

### Variáveis de ambiente

| Variável                        | Obrigatória   | Descrição                                                            |
| ------------------------------- | ------------- | -------------------------------------------------------------------- |
| `OPENAI_API_KEY`                | sim (p/ IA)   | Chave da OpenAI (análise/sugestões via GPT; transcrição via Whisper) |
| `OPENAI_MODEL`                  | não           | Modelo de chat. Padrão `gpt-4o-mini`. Mais qualidade: `gpt-4o`       |
| `OPENAI_TRANSCRIBE_MODEL`       | não           | Modelo de transcrição. Padrão `whisper-1`                            |
| `NEXT_PUBLIC_SUPABASE_URL`      | não (p/ login)| URL do projeto Supabase. Sem ela, o app roda sem login/persistência  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | não (p/ login)| Chave anônima do Supabase                                            |

---

## Como funciona

1. **Importar** (tela escura): selecione os arquivos exportados do WhatsApp (o
   `.txt` + os áudios `.opus`/anexos) **ou** cole o texto. O parser
   (`src/lib/parseWhatsApp.ts`) monta a timeline client-side.
2. **Transcrever**: cada áudio anexado vai pra `POST /api/transcribe` (Whisper) e
   a transcrição é preenchida na timeline. Sem arquivo/chave, o áudio fica como
   pendente.
3. **Analisar**: o front manda as mensagens pra `POST /api/analyze`, que chama o
   GPT (JSON mode) e devolve `{ oneLine, chips, summary, frictions, rec,
   suggestions[] }`.
4. **Conversa**: timeline + análise recolhível + 3 sugestões (troca de tom
   instantânea, "Gerar outras" e "Modelos"). Com Supabase + login, a conversa é
   salva na conta e reaparece no inbox.

---

## Deploy na Vercel

1. Importe o repositório na Vercel.
2. Em **Environment Variables**, configure `OPENAI_API_KEY` (e opcionalmente
   `OPENAI_MODEL` / `OPENAI_TRANSCRIBE_MODEL`). Para login/persistência, adicione
   também `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Deploy. O `manifest.json` + service worker (`public/`) deixam o app
   instalável como PWA.

---

## Banco + login (Supabase)

Opcional — **sem** as variáveis o app roda local (sem login, sem persistência).
Para ligar:

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**
   para `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (`.env.local` ou Vercel).
3. No **SQL Editor**, rode a migration `supabase/migrations/0001_init.sql` (cria
   a tabela `conversations` com **RLS** isolando por usuário).
4. Em **Authentication → Providers**, deixe **Email** habilitado. Para testar
   rápido sem caixa de entrada, desligue "Confirm email".

Com isso: aparece o botão **Entrar** no app, `/login` faz cadastro/login por
e-mail+senha, e cada conversa importada é salva na conta (e recarregada no inbox).

> v1 guarda a conversa inteira como JSONB. O esquema normalizado
> (`clients`/`messages`/`analyses`) fica para a fase de histórico/RAG.

---

## Roadmap

- [x] **Scaffolding** — Next + Tailwind + PWA, 3 telas pixel-fiéis ao protótipo
- [x] **Importação manual** — parser do `.txt` → timeline
- [x] **IA** — rota `/api/analyze` (GPT, JSON mode) + troca de tom + "Gerar outras"
- [x] **Transcrição** — upload das mídias `.opus` → `/api/transcribe` (Whisper) → preenche transcrições
- [x] **Banco + Auth** — Supabase (Postgres + Auth): login e persistência das conversas _(pronto; precisa das chaves + rodar a migration)_
- [x] **Polimento PWA** — service worker com cache offline do shell + página offline
- [ ] **Histórico/RAG** — esquema normalizado (`clients`/`messages`/…), injetar histórico do cliente no prompt
- [ ] **WhatsApp Cloud API** — ingestão/resposta ao vivo

---

## Estrutura

```
src/
  middleware.ts             # renova a sessão do Supabase (no-op se não configurado)
  app/
    layout.tsx              # fontes (Google), metadata, manifest/PWA
    page.tsx
    globals.css             # tokens de animação + reset
    login/page.tsx          # login/cadastro (Supabase)
    api/analyze/route.ts    # análise+sugestões (OpenAI GPT, server-only)
    api/transcribe/route.ts # transcrição de áudio (OpenAI Whisper, server-only)
  components/
    FechouApp.tsx           # app inteiro: estado + 3 telas (Inbox/Importar/Conversa)
  lib/
    types.ts                # tipos do domínio
    parseWhatsApp.ts        # parser do .txt
    prompt.ts               # serialização da conversa + system prompt + parse do JSON
    ai.ts                   # helpers de sugestão/transcrição + fetch das rotas (client)
    sample.ts               # dados de exemplo (Gabro 604, Juliana, Marina)
    supabase/               # config + clients (browser/server) + camada de conversas
public/
  manifest.json, sw.js, offline.html, assets/   # PWA + ícones + anexos de exemplo
supabase/migrations/        # SQL (tabela conversations + RLS)
design_handoff/             # protótipo/spec de referência (NÃO é o código de produção)
```

O design original (protótipo HTML + tokens + spec) está em `design_handoff/`
como referência para as próximas fases.
