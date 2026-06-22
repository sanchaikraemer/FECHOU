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

export interface ParsedConversation {
  messages: Message[];
  participants: string[];
  themName: string;
  count: number;
  firstSentAt?: string;
  lastSentAt?: string;
}

interface ParsedLine {
  date: string;
  time: string;
  sender: string;
  body: string;
  sentAt?: string;
}

const STRIP_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const SYSTEM_TEXT_RE =
  /(?:mensagens e (?:as )?ligações|messages and calls).*(?:criptografia|encrypted)|código de segurança|security code|adicionou|added|saiu do grupo|left|removeu|removed|mudou o assunto|changed the subject|mudou o ícone|changed this group|criou (?:este|o) grupo|created group|esta mensagem foi apagada|this message was deleted|você apagou esta mensagem/i;
const OMITTED_RE =
  /^<?\s*(?:[áa]udio|imagem|figurinha|sticker|v[íi]deo|gif|foto|documento|m[íi]dia)?\s*(?:oculta|oculto|ocultad[oa]|omitid[oa]|omitted)\s*>?$|^<m[íi]dia[^>]*>$|^<arquivo de m[íi]dia[^>]*>$/i;
const ATTACH_TAG_RE = /<(?:anexad[oa]|attached):\s*([^>]+?)>/i;
const ATTACH_WORD_RE = /\((?:arquivo anexado|file attached)\)/i;
const ANY_FILE_RE =
  /([^\s<>:"|*?]+\.(?:opus|ogg|m4a|mp3|wav|aac|amr|jpe?g|png|webp|gif|bmp|heic|pdf|mp4|3gp|mov|webm|mkv|docx?|xlsx?|pptx?|vcf|zip))/i;
const AUDIO_RE = /\.(opus|ogg|m4a|mp3|wav|aac|amr)$/i;
const DATE_PART = "\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}";
const TIME_PART = "\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[AaPp]\\.?[Mm]\\.?)?";

const IOS_MESSAGE_RE = new RegExp(
  `^\\[(${DATE_PART}),?\\s+(${TIME_PART})\\]\\s*([^:]+?):\\s?([\\s\\S]*)$`,
);
const ANDROID_MESSAGE_RE = new RegExp(
  `^(${DATE_PART}),?\\s+(${TIME_PART})\\s*[-–—]\\s*([^:]+?):\\s?([\\s\\S]*)$`,
);
const IOS_SYSTEM_RE = new RegExp(`^\\[(${DATE_PART}),?\\s+(${TIME_PART})\\]\\s*(.+)$`);
const ANDROID_SYSTEM_RE = new RegExp(
  `^(${DATE_PART}),?\\s+(${TIME_PART})\\s*[-–—]\\s*(.+)$`,
);

function cleanLine(value: string): string {
  return String(value || "")
    .replace(STRIP_RE, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .trimEnd();
}

function normalizePerson(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

export function sameParticipant(a: string, b: string): boolean {
  return Boolean(a && b && normalizePerson(a) === normalizePerson(b));
}

function normalizeDateTime(dateRaw: string, timeRaw: string): {
  date: string;
  time: string;
  sentAt?: string;
} {
  const dateParts = dateRaw.split(/[\/.-]/).map((p) => Number.parseInt(p, 10));
  if (dateParts.length !== 3 || dateParts.some((p) => !Number.isFinite(p))) {
    return { date: dateRaw, time: timeRaw };
  }

  let [day, month, year] = dateParts;
  if (year < 100) year += year >= 70 ? 1900 : 2000;

  const tm = timeRaw
    .replace(/\./g, "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (!tm) return { date: dateRaw, time: timeRaw };

  let hour = Number.parseInt(tm[1], 10);
  const minute = Number.parseInt(tm[2], 10);
  const second = Number.parseInt(tm[3] || "0", 10);
  const ampm = tm[4]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  if (
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return { date: dateRaw, time: timeRaw };
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${pad(day)}/${pad(month)}/${year}`,
    time: `${pad(hour)}:${pad(minute)}`,
    sentAt: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`,
  };
}

function parseMessageLine(raw: string): ParsedLine | null {
  const line = cleanLine(raw);
  const match = line.match(IOS_MESSAGE_RE) || line.match(ANDROID_MESSAGE_RE);
  if (!match) return null;
  const normalized = normalizeDateTime(match[1], match[2]);
  return {
    date: normalized.date,
    time: normalized.time,
    sentAt: normalized.sentAt,
    sender: match[3].trim(),
    body: match[4] || "",
  };
}

function isStandaloneSystemLine(raw: string): boolean {
  const line = cleanLine(raw).trim();
  if (!line) return false;
  const match = line.match(IOS_SYSTEM_RE) || line.match(ANDROID_SYSTEM_RE);
  if (!match) return SYSTEM_TEXT_RE.test(line);
  return SYSTEM_TEXT_RE.test(match[3] || line) || !String(match[3] || "").includes(":");
}

export function fmtDate(date: string): string {
  const parts = String(date).split(/[\/.-]/);
  const monthIndex = Number.parseInt(parts[1], 10) - 1;
  return `${parts[0]} ${MESES[monthIndex] || parts[1] || ""}`.trim();
}

export function extractWhatsAppParticipants(text: string): string[] {
  const counts = new Map<string, number>();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const parsed = parseMessageLine(raw);
    if (!parsed) continue;
    counts.set(parsed.sender, (counts.get(parsed.sender) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([name]) => name);
}

function detectFileName(body: string): string | null {
  const tag = body.match(ATTACH_TAG_RE);
  if (tag) return tag[1].trim();

  if (ATTACH_WORD_RE.test(body)) {
    const file = body.match(ANY_FILE_RE);
    return file ? file[1].trim() : null;
  }

  const file = body.match(ANY_FILE_RE);
  if (file && body.trim().length - file[1].length <= 3) return file[1].trim();
  return null;
}

/**
 * Converte exportações do WhatsApp (Android e iPhone) em uma linha do tempo.
 * Textos e áudios são preservados; outras mídias são ignoradas de propósito.
 */
export function parseWhatsApp(text: string, myName: string): ParsedConversation {
  const out: Message[] = [];
  const senderCounts = new Map<string, number>();
  let last: Message | null = null;
  let lastDate: string | null = null;
  let firstSentAt: string | undefined;
  let lastSentAt: string | undefined;

  const ensureDivider = (date: string) => {
    if (date !== lastDate) {
      out.push({ k: "div", text: fmtDate(date), date });
      lastDate = date;
    }
  };

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = cleanLine(raw);
    const parsed = parseMessageLine(line);

    if (!parsed) {
      if (!line.trim()) continue;
      if (isStandaloneSystemLine(line)) {
        last = null;
        continue;
      }
      if (last && last.k !== "audio") {
        last.text = `${last.text || ""}\n${line.trim()}`.trim();
      }
      continue;
    }

    senderCounts.set(parsed.sender, (senderCounts.get(parsed.sender) || 0) + 1);
    if (parsed.sentAt) {
      firstSentAt ||= parsed.sentAt;
      lastSentAt = parsed.sentAt;
    }

    const side: Side = sameParticipant(parsed.sender, myName) ? "me" : "them";
    const body = parsed.body.trim();

    if (OMITTED_RE.test(body)) {
      last = null;
      continue;
    }

    const fileName = detectFileName(body);
    if (fileName) {
      if (AUDIO_RE.test(fileName)) {
        ensureDivider(parsed.date);
        const audio: Message = {
          k: "audio",
          from: side,
          sender: parsed.sender,
          transcript: "",
          file: fileName,
          t: parsed.time,
          date: parsed.date,
          sentAt: parsed.sentAt,
        };
        out.push(audio);
      }
      last = null;
      continue;
    }

    if (!body) {
      last = null;
      continue;
    }

    ensureDivider(parsed.date);
    const message: Message = {
      k: side,
      from: side,
      sender: parsed.sender,
      text: body,
      t: parsed.time,
      date: parsed.date,
      sentAt: parsed.sentAt,
    };
    out.push(message);
    last = message;
  }

  const participants = [...senderCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([name]) => name);
  const otherParticipants = participants.filter((name) => !sameParticipant(name, myName));
  const themName = otherParticipants[0] || participants[0] || "Contato";
  const count = out.filter((item) => ["me", "them", "audio"].includes(item.k)).length;

  return {
    messages: out,
    participants,
    themName,
    count,
    firstSentAt,
    lastSentAt,
  };
}
