import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

async function withRetries<T>(fn: () => Promise<T>, tries = 3, baseDelayMs = 600): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof OpenAI.APIError ? err.status ?? 0 : 0;
      const isRetryable =
        status === 429 ||
        status >= 500 ||
        (err instanceof Error && /network|ECONNRESET|ETIMEDOUT/i.test(err.message));
      if (!isRetryable || i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, reason: "no_key" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, reason: "no_file" });
  }

  try {
    const client = new OpenAI({ apiKey: key });
    const buf = Buffer.from(await file.arrayBuffer());
    const upload = await toFile(buf, file.name || "audio.opus");
    const tr = await withRetries(() =>
      client.audio.transcriptions.create({
        file: upload,
        model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe",
        language: "pt",
      })
    );
    return NextResponse.json({ ok: true, text: tr.text || "" });
  } catch (err) {
    console.error("[/api/transcribe] erro:", err);
    return NextResponse.json({ ok: false, reason: "error" });
  }
}
