import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { Message } from "@/lib/types";
import { parseRadarJson, serializeConversation, systemPrompt } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 30;

interface AnalyzeBody {
  messages: Message[];
  myName: string;
}

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

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  const myName = (body.myName || "").trim();
  const convo = serializeConversation(body.messages || [], myName);
  if (!convo.trim()) return NextResponse.json({ ok: false, reason: "empty" });

  try {
    const client = new OpenAI({ apiKey: key });
    const model = process.env.OPENAI_MODEL || "gpt-4o";
    const completion = await withRetries(() =>
      client.chat.completions.create({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(myName || "Corretor") },
          { role: "user", content: convo },
        ],
      })
    );
    const raw = completion.choices[0]?.message?.content || "";
    const result = parseRadarJson(raw);
    if (!result) return NextResponse.json({ ok: false, reason: "parse" });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[/api/analyze] erro:", err);
    return NextResponse.json({ ok: false, reason: "error" });
  }
}
