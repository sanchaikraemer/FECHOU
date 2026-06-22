import type { Message } from "./types";

type Bucket = { count: number; resetAt: number };

const globalStore = globalThis as typeof globalThis & {
  __radarRateLimits?: Map<string, Bucket>;
};

const buckets = globalStore.__radarRateLimits || new Map<string, Bucket>();
globalStore.__radarRateLimits = buckets;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    forwarded ||
    "unknown"
  );
}

export function checkRateLimit(
  request: Request,
  namespace: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  if (buckets.size > 5_000) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const key = `${namespace}:${getClientIp(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1_000),
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  current.count += 1;
  buckets.set(key, current);
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
  };
}

export function isSameSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const expectedOrigin = process.env.RADAR_ALLOWED_ORIGIN?.trim();
    if (expectedOrigin) return originUrl.origin === new URL(expectedOrigin).origin;
    return originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}

export function contentLengthWithin(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return true;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= maxBytes;
}

export interface SanitizedAnalyzeBody {
  myName: string;
  messages: Message[];
  totalCharacters: number;
}

export function sanitizeAnalyzeBody(value: unknown): SanitizedAnalyzeBody | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { myName?: unknown; messages?: unknown };
  if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > 300) {
    return null;
  }

  const myName = typeof raw.myName === "string" ? raw.myName.trim().slice(0, 100) : "";
  const messages: Message[] = [];
  let totalCharacters = 0;

  for (const item of raw.messages) {
    if (!item || typeof item !== "object") continue;
    const source = item as Partial<Message>;
    if (!["me", "them", "audio", "div"].includes(String(source.k))) continue;

    const text = typeof source.text === "string" ? source.text.slice(0, 5_000) : undefined;
    const transcript =
      typeof source.transcript === "string" ? source.transcript.slice(0, 8_000) : undefined;
    totalCharacters += (text?.length || 0) + (transcript?.length || 0);
    if (totalCharacters > 90_000) return null;

    messages.push({
      k: source.k as Message["k"],
      from: source.from === "me" || source.from === "them" ? source.from : undefined,
      sender: typeof source.sender === "string" ? source.sender.slice(0, 120) : undefined,
      text,
      transcript,
      t: typeof source.t === "string" ? source.t.slice(0, 20) : undefined,
      date: typeof source.date === "string" ? source.date.slice(0, 20) : undefined,
      sentAt: typeof source.sentAt === "string" ? source.sentAt.slice(0, 40) : undefined,
      file: typeof source.file === "string" ? source.file.slice(0, 250) : undefined,
      transcriptionFailed: Boolean(source.transcriptionFailed),
    });
  }

  if (!messages.some((message) => message.text?.trim() || message.transcript?.trim())) return null;
  return { myName, messages, totalCharacters };
}

const AUDIO_EXTENSIONS = /\.(opus|ogg|m4a|mp3|wav|aac|amr|mp4|mpeg|webm)$/i;
const AUDIO_MIME_TYPES = new Set([
  "audio/opus",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/amr",
  "audio/webm",
  "application/ogg",
  "application/octet-stream",
]);

export function isAllowedAudioFile(file: File, maxBytes = 20 * 1024 * 1024): boolean {
  if (file.size <= 0 || file.size > maxBytes) return false;
  const nameOk = AUDIO_EXTENSIONS.test(file.name || "");
  const type = (file.type || "application/octet-stream").toLowerCase();
  return nameOk && AUDIO_MIME_TYPES.has(type);
}
