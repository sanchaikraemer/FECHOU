import type { Message, Side } from "./types";

const MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export function fmtDate(d: string): string {
  const p = String(d).split("/");
  const mi = parseInt(p[1], 10) - 1;
  return p[0] + " " + (MESES[mi] || p[1] || "");
}

export interface ParsedConversation {
  messages: Message[];
  themName: string;
  count: number;
}

/**
 * Lê o .txt exportado do WhatsApp e monta a linha do tempo.
 * Portado da função parseWhatsApp do protótipo (Fechou.dc.html).
 * Áudios entram como documento "Áudio de voz" — a transcrição (Whisper)
 * roda no servidor numa fase posterior.
 */
export function parseWhatsApp(text: string, myName: string): ParsedConversation {
  const lines = (text || "").split(/\r?\n/);
  const re =
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2})(?::\d{2})?\s*[-–]\s*([^:]+?):\s?([\s\S]*)$/;
  const out: Message[] = [];
  let last: Message | null = null;
  let lastDate: string | null = null;
  const senders: Record<string, number> = {};

  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      if (/criptografia|lista de contatos|Saiba mais/i.test(line)) {
        last = null;
        continue;
      }
      const sender = m[3].trim();
      const date = m[1];
      const body = m[4];
      const side: Side = sender === (myName || "").trim() ? "me" : "them";
      if (side === "them") senders[sender] = (senders[sender] || 0) + 1;
      if (date !== lastDate) {
        out.push({ k: "div", text: fmtDate(date) });
        lastDate = date;
      }
      if (
        /\(arquivo anexado\)/i.test(body) ||
        /\.(opus|jpg|jpeg|png|pdf|mp4|webp)/i.test(body)
      ) {
        const nm = body.replace(/\(arquivo anexado\)/i, "").trim();
        if (/\.opus/i.test(body))
          // Áudio: vira mensagem 'audio' pendente. Se o arquivo for enviado no
          // import, transcrevemos via Whisper e preenchemos o transcript.
          out.push({
            k: "audio",
            from: side,
            transcript: "",
            file: nm || "audio.opus",
            t: m[2],
          });
        else if (/\.pdf/i.test(body))
          out.push({
            k: "doc",
            from: side,
            docName: nm || "Documento.pdf",
            docMeta: "PDF",
            t: m[2],
          });
        else
          out.push({
            k: "doc",
            from: side,
            docName: nm || "Imagem",
            docMeta: "Imagem",
            t: m[2],
          });
        last = null;
        continue;
      }
      if (!body.trim()) {
        last = null;
        continue;
      }
      const msg: Message = { k: side, text: body.trim(), t: m[2] };
      out.push(msg);
      last = msg;
    } else if (last && line.trim()) {
      last.text = (last.text || "") + "\n" + line.trim();
    }
  }

  const themName =
    Object.keys(senders).sort((a, b) => senders[b] - senders[a])[0] ||
    "Contato";
  return {
    messages: out,
    themName,
    count: out.filter((x) => x.k === "me" || x.k === "them").length,
  };
}
