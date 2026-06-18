import type { AiResult, Message, Suggestion } from "./types";

export const ACCENTS = ["#3FBE86", "#E8542F", "#6FA0D9"];

/** Monta os cards de sugestão a partir do JSON da IA (cor por índice). */
export function buildSuggestions(ai: AiResult | null): Suggestion[] | null {
  if (!ai || !Array.isArray(ai.suggestions)) return null;
  return ai.suggestions.slice(0, 3).map((x, i) => ({
    cat: (x.cat || "SUGESTÃO").toString().toUpperCase().slice(0, 22),
    accent: ACCENTS[i % 3],
    t: {
      amigavel: x.amigavel || "",
      direto: x.direto || "",
      formal: x.formal || "",
    },
  }));
}

/** Sugestões genéricas quando não há IA disponível (sem chave / offline). */
export function fallbackSuggestions(): Suggestion[] {
  return [
    {
      cat: "RETOMAR",
      accent: ACCENTS[0],
      t: {
        amigavel:
          "Oi! Passando pra retomar nossa conversa — posso te atualizar sobre as condições?",
        direto: "Oi, retomando: te passo as condições atualizadas?",
        formal: "Olá. Retomo nosso contato para apresentar as condições atualizadas.",
      },
    },
    {
      cat: "AVANÇAR",
      accent: ACCENTS[1],
      t: {
        amigavel: "Quer que eu prepare a proposta pra você ver como fica na prática?",
        direto: "Preparo a proposta pra você visualizar?",
        formal: "Posso elaborar a proposta para sua apreciação.",
      },
    },
    {
      cat: "PRÓXIMO PASSO",
      accent: ACCENTS[2],
      t: {
        amigavel: "Topa marcarmos 10 minutos pra alinhar os próximos passos?",
        direto: "Marcamos 10 min pra alinhar?",
        formal:
          "Podemos agendar uma breve conversa para alinhar os próximos passos?",
      },
    },
  ];
}

/** Transcreve um arquivo de áudio via /api/transcribe (Whisper). Devolve null se indisponível. */
export async function transcribeAudio(file: File): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/transcribe", { method: "POST", body: fd });
    const data = await r.json();
    if (data && data.ok && typeof data.text === "string") return data.text;
    return null;
  } catch {
    return null;
  }
}

/** Chama a rota /api/analyze (que conversa com a OpenAI). Devolve null se indisponível. */
export async function callAnalyze(
  messages: Message[],
  myName: string,
): Promise<AiResult | null> {
  try {
    const r = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, myName }),
    });
    const data = await r.json();
    if (data && data.ok && data.ai) return data.ai as AiResult;
    return null;
  } catch {
    return null;
  }
}
