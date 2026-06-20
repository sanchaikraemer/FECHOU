import type { Message, RadarResult } from "./types";

export function serializeConversation(messages: Message[], myName: string): string {
  return (messages || [])
    .filter((m) => m.text && (m.k === "me" || m.k === "them"))
    .slice(-80)
    .map((m) => (m.k === "me" ? myName || "Corretor" : "Cliente") + ": " + m.text)
    .join("\n");
}

export function systemPrompt(myName: string): string {
  const me = myName || "Corretor";
  return [
    `Você é especialista em negociação imobiliária. Analise uma conversa de WhatsApp entre "${me}" (corretor de imóveis) e um potencial comprador/cliente.`,
    `Responda APENAS com JSON válido (sem markdown, sem texto fora do JSON), exatamente neste formato:`,
    `{"prioridade":85,"valeRetomar":true,"oQueAconteceu":"Texto descrevendo o histórico da negociação em 2-3 frases.","ondeTravou":"O que bloqueou o avanço — objeção, silêncio, dúvida não respondida etc.","faltouDescobrir":["item 1","item 2","item 3"],"motivoPrioridade":"Por que este cliente tem essa prioridade — urgência, sinal de compra, perfil etc.","proximaAcao":"Ação concreta e específica que o corretor deve fazer agora.","mensagem":"Mensagem completa pronta para enviar no WhatsApp ao cliente. Deve ser natural, persuasiva e específica ao contexto da negociação. Máximo 3 parágrafos curtos."}`,
    `Regras:`,
    `- prioridade: número de 0 a 100 (100 = fechar contrato hoje, 0 = sem potencial)`,
    `- valeRetomar: true se vale retomar contato, false se não vale`,
    `- faltouDescobrir: lista de 2 a 4 itens específicos que o corretor ainda não sabe sobre o cliente`,
    `- mensagem: escreva como o corretor escreveria no WhatsApp, em português informal mas profissional`,
    `- Tudo em português do Brasil`,
  ].join("\n");
}

export function parseRadarJson(raw: string): RadarResult | null {
  if (!raw) return null;
  const str = String(raw).replace(/```json/gi, "").replace(/```/g, "");
  const a = str.indexOf("{");
  const b = str.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try {
    const parsed = JSON.parse(str.slice(a, b + 1)) as Partial<RadarResult>;
    return {
      prioridade: typeof parsed.prioridade === "number" ? parsed.prioridade : 50,
      valeRetomar: typeof parsed.valeRetomar === "boolean" ? parsed.valeRetomar : true,
      oQueAconteceu: parsed.oQueAconteceu || "",
      ondeTravou: parsed.ondeTravou || "",
      faltouDescobrir: Array.isArray(parsed.faltouDescobrir) ? parsed.faltouDescobrir : [],
      motivoPrioridade: parsed.motivoPrioridade || "",
      proximaAcao: parsed.proximaAcao || "",
      mensagem: parsed.mensagem || "",
    };
  } catch {
    return null;
  }
}
