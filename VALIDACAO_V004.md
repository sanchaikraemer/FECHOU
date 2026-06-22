# Validação — Radar de Vendas v004

## Revisão 1 — estrutura e segurança

- Removidos `design_handoff`, Supabase, Tailwind, middleware vazio e workflow de branch temporária.
- Removidos documentos e fotografias indevidos da pasta pública.
- Criados ícones próprios do Radar.
- Adicionados limites de tamanho, tipo de arquivo, origem e requisições por IP.
- Atualizadas dependências e identidade do projeto.

## Revisão 2 — funcionamento comercial

- Parser validado com exportação Android.
- Parser validado com exportação iPhone, segundos e AM/PM.
- Avisos de sistema não são anexados à mensagem anterior.
- Participantes são detectados antes da análise.
- Áudios transcritos entram no prompt da IA.
- Datas, horários e tempo parado entram no diagnóstico.
- Prompt comercial inclui as regras de linguagem e condução definidas para o Radar.

## Revisão 3 — compilação e regressão

Executar antes da publicação:

```bash
npm run typecheck
npm test
npm run build
npm audit
```

Também testar manualmente no domínio de produção:

1. Upload de `.txt` Android.
2. Upload de `.txt` iPhone.
3. ZIP com áudio `.opus`.
4. Escolha correta do participante.
5. Cópia da mensagem sugerida.
6. Instalação como PWA.
7. Compartilhamento do WhatsApp para o Radar em Android compatível.

## Resultado final desta entrega

- TypeScript: aprovado.
- Testes automatizados: 10 de 10 aprovados.
- Build de produção: aprovado.
- Auditoria de dependências: 0 vulnerabilidades encontradas.
- Pasta pública: somente ícones, manifesto, página offline e service worker.
- Varredura por chaves e arquivos sensíveis: nenhum item encontrado.

A chamada real à OpenAI não foi executada nesta revisão porque a chave de produção não está incluída no ZIP. As rotas, validações, serialização e tratamento das respostas foram compilados e testados; a confirmação final do provedor deve ser feita após configurar `OPENAI_API_KEY` no Vercel.
