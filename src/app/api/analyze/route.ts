import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  checkRateLimit,
  contentLengthWithin,
  isSameSiteRequest,
  sanitizeAnalyzeBody,
} from "@/lib/apiSecurity";
import { parseRadarJson, serializeConversation, systemPrompt } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 45;

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
  if (!contentLengthWithin(request, 180 * 1024)) {
    return json({ ok: false, reason: "too_large" }, { status: 413 });
  }

  const rate = checkRateLimit(request, "analyze", 12, 60 * 60 * 1_000);
  if (!rate.allowed) {
    return json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, reason: "unsupported_media_type" }, { status: 415 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ ok: false, reason: "no_key" }, { status: 503 });

  let rawBody: unknown;
  try {
    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > 180 * 1024) {
      return json({ ok: false, reason: "too_large" }, { status: 413 });
    }
    rawBody = JSON.parse(rawText);
  } catch {
    return json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  const body = sanitizeAnalyzeBody(rawBody);
  if (!body) return json({ ok: false, reason: "invalid_conversation" }, { status: 400 });

  const conversation = serializeConversation(body.messages, body.myName);
  if (!conversation.trim()) return json({ ok: false, reason: "empty" }, { status: 400 });

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4o";
    const completion = await withRetries(() =>
      client.chat.completions.create({
        model,
        temperature: 0.3,
        max_completion_tokens: 1_800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(body.myName || "Corretor") },
          { role: "user", content: conversation },
        ],
      }),
    );

    const raw = completion.choices[0]?.message?.content || "";
    const result = parseRadarJson(raw);
    if (!result) return json({ ok: false, reason: "parse" }, { status: 502 });
    return json({ ok: true, result });
  } catch (error) {
    console.error("[/api/analyze] erro:", error);
    const status = error instanceof OpenAI.APIError ? error.status || 502 : 502;
    return json({ ok: false, reason: "provider_error" }, { status: Math.min(599, Math.max(400, status)) });
  }
}
