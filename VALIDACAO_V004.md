# Validação — Radar de Vendas v004

## Data da validação

2026-06-22

## Arquivos e pastas removidos

- `.github/workflows/deploy.yml` — workflow antigo que empurrava para branch temporária
- `design_handoff/` (7 arquivos) — protótipos com marca Fechou e imagens pessoais
- `design_handoff/assets/cartao-redemoi.jpg` — imagem pessoal
- `design_handoff/assets/matricula-604.jpg` — documento particular
- `design_handoff/assets/matricula-box.jpg` — documento particular
- `public/assets/cartao-redemoi.jpg` — imagem pessoal na pasta pública
- `public/assets/matricula-604.jpg` — documento particular na pasta pública
- `public/assets/matricula-box.jpg` — documento particular na pasta pública
- `postcss.config.mjs` — configuração PostCSS sem uso
- `tailwind.config.ts` — configuração Tailwind sem uso (não há importações de Tailwind em src/)
- `supabase/migrations/0001_init.sql` — migração Supabase sem uso
- `src/middleware.ts` — middleware vazio sem efeito

## package-lock.json

URLs resolvidas corrigidas de proxy interno (`packages.applied-caas-gateway1.internal.api.openai.org`) para `registry.npmjs.org`. O conteúdo das dependências permanece idêntico.

## Problemas verificados e confirmados corrigidos

- Transcrições de áudio entram no texto enviado para análise (`[Áudio transcrito] ...`)
- Identificação do corretor via nome informado pelo usuário
- Exportações Android e iPhone aceitas e validadas em teste
- Datas, horários e tempo sem resposta enviados para análise
- Mensagens de sistema do WhatsApp não são atribuídas ao corretor ou cliente
- Rotas `/api/analyze` e `/api/transcribe` com validação, rate limit por IP e verificação de origem
- Limite de tipo (extensão + MIME), tamanho (20 MB áudio / 180 KB JSON) e quantidade (300 mensagens)
- Prompt não usa "faz sentido", "fiquei pensando", "estive pensando", "ainda tem interesse?"
- Prompt não cria objeções e não desvaloriza o produto
- Mensagem termina com uma única pergunta principal
- Sem emojis
- Retomada usa pendência real como gancho, não cobrança genérica
- Nenhuma chave da OpenAI no código — somente `process.env.OPENAI_API_KEY`
- `.env.example` sem valor sensível (campo vazio)

## Comandos executados

```bash
git rm -r .github/ design_handoff/ supabase/ postcss.config.mjs tailwind.config.ts src/middleware.ts public/assets/cartao-redemoi.jpg public/assets/matricula-604.jpg public/assets/matricula-box.jpg
npm ci
npm test
npm run typecheck
npm run build
npm audit
```

## Resultado dos testes

```
# tests 10
# pass  10
# fail  0
```

Cobertura: parser Android, parser iPhone, mensagens de sistema, detecção de áudio, extração de participantes, serialização com transcrição e tempo parado, regras do prompt, normalização de JSON, validação de áudio, sanitização de payload.

## Resultado do build

```
▲ Next.js 16.2.9 (Turbopack)
✓ Compiled successfully
✓ TypeScript: sem erros
✓ Rotas: / (static), /share (static), /api/analyze (dynamic), /api/transcribe (dynamic)
```

## Resultado do TypeScript

```
tsc --noEmit → sem erros
```

## Resultado do npm audit

```
found 0 vulnerabilities
```

## Estrutura final da pasta public/

- `public/assets/icon-192.png` — ícone PWA
- `public/assets/icon-512.png` — ícone PWA
- `public/manifest.json` — manifesto PWA
- `public/offline.html` — página offline
- `public/sw.js` — service worker

Nenhuma imagem pessoal, documento ou arquivo de teste na pasta pública.

## Limitações que dependem de teste real com a chave OpenAI

A chamada real às APIs da OpenAI (análise e transcrição) não foi executada nesta revisão porque a chave de produção não está incluída no repositório. As rotas, validações, serialização e tratamento de resposta foram compilados e testados. A confirmação final deve ser feita após configurar `OPENAI_API_KEY` no painel do Vercel.
