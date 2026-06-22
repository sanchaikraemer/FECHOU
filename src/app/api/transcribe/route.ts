import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import {
  checkRateLimit,
  contentLengthWithin,
  isAllowedAudioFile,
  isSameSiteRequest,
} from "@/lib/apiSecurity";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

async function withRetries<T>(fn: () => Promise<T>, tries = 3, baseDelayMs = 700): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error instanceof OpenAI.APIError ? error.status ?? 0 : 0;
      const retryable =
        status === 429 ||
        status >= 500 ||
        (error instanceof Error && /network|ECONNRESET|ETIMEDOUT|fetch failed/i.test(error.message));
      if (!retryable || attempt === tries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) {
    return json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  if (!contentLengthWithin(request, 21 * 1024 * 1024)) {
    return json({ ok: false, reason: "too_large" }, { status: 413 });
  }

  const rate = checkRateLimit(request, "transcribe", 30, 60 * 60 * 1_000);
  if (!rate.allowed) {
    return json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json({ ok: false, reason: "unsupported_media_type" }, { status: 415 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ ok: false, reason: "no_key" }, { status: 503 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ ok: false, reason: "no_file" }, { status: 400 });
  }
  if (!isAllowedAudioFile(file)) {
    return json({ ok: false, reason: "invalid_audio" }, { status: 415 });
  }

  try {
    const client = new OpenAI({ apiKey });
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = (file.name || "audio.opus").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
    const upload = await toFile(buffer, safeName, { type: file.type || "application/octet-stream" });
    const transcription = await withRetries(() =>
      client.audio.transcriptions.create({
        file: upload,
        model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe",
        language: "pt",
      }),
    );
    return json({ ok: true, text: transcription.text?.trim() || "" });
  } catch (error) {
    console.error("[/api/transcribe] erro:", error);
    const status = error instanceof OpenAI.APIError ? error.status || 502 : 502;
    return json({ ok: false, reason: "provider_error" }, { status: Math.min(599, Math.max(400, status)) });
  }
}
