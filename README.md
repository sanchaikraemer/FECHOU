# Radar de Vendas v004

Aplicativo web instalável (PWA) para corretores de imóveis. Recebe uma conversa exportada do WhatsApp em `.zip` ou `.txt`, identifica os participantes, transcreve os áudios anexados e gera um diagnóstico comercial com próxima ação e mensagem pronta.

## O que esta versão faz

- Lê exportações do WhatsApp em formatos comuns de Android e iPhone.
- Confirma qual participante é o corretor antes de analisar e salva essa escolha apenas no aparelho.
- Reconstrói data, horário e tempo desde a última interação.
- Transcreve áudios `.opus`, `.ogg`, `.m4a`, `.mp3`, `.wav`, `.aac` e `.amr`.
- Envia as transcrições junto com as mensagens para a análise.
- Entrega prioridade, estágio, interesse, pendências, objeção, responsável pelo próximo passo, ação recomendada e uma mensagem objetiva.
- Não possui login, banco de dados ou histórico. As conversas não são persistidas pelo Radar.

## Tecnologias

- Next.js 16, React 19 e TypeScript.
- OpenAI para análise e transcrição.
- `fflate` para abrir o ZIP no navegador.
- PWA com Share Target para receber a exportação diretamente do WhatsApp em aparelhos compatíveis.

## Rodar localmente

```bash
npm install
cp .env.example .env.local
# preencha OPENAI_API_KEY em .env.local
npm run dev
```

Abra `http://localhost:3000`.

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---:|---|
| `OPENAI_API_KEY` | sim | análise e transcrição |
| `OPENAI_MODEL` | não | modelo de análise; padrão `gpt-4o` |
| `OPENAI_TRANSCRIBE_MODEL` | não | modelo de transcrição; padrão `gpt-4o-transcribe` |
| `RADAR_ALLOWED_ORIGIN` | não | restringe as APIs à origem informada |

Na Vercel, use `RADAR_ALLOWED_ORIGIN=https://radardevendas.vercel.app` depois de confirmar o domínio definitivo.

## Validação

```bash
npm run typecheck
npm test
npm run build
npm audit
```

O comando completo é:

```bash
npm run validate
```

## Publicação correta

1. Envie estes arquivos para a branch `main` do GitHub.
2. Na Vercel, abra **Settings → Git → Production Branch**.
3. Defina `main` como branch de produção.
4. Configure as variáveis de ambiente.
5. Faça um novo deploy.

Este pacote não contém o antigo workflow que copiava `main` para uma branch temporária do Claude.

## Limites de segurança

- Análise: até 12 solicitações por IP a cada hora.
- Transcrição: até 30 solicitações por IP a cada hora.
- Áudio: até 20 MB por arquivo.
- ZIP: até 100 MB, com limite de arquivos e tamanho extraído.
- Conversa: até 300 itens e 90 mil caracteres enviados à API.

O limitador em memória reduz abuso comum, mas pode reiniciar entre instâncias serverless. Para uso comercial em escala, complemente com Vercel Firewall ou um rate limit persistente.
