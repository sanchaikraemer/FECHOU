import type { Message, RadarResult } from "./types";

export interface ApiResult<T> {
  data: T | null;
  reason?: string;
}

export async function transcribeAudio(file: File): Promise<ApiResult<string>> {
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/transcribe", { method: "POST", body: form });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      text?: string;
      reason?: string;
    };
    if (response.ok && payload.ok && typeof payload.text === "string") {
      return { data: payload.text };
    }
    return { data: null, reason: payload.reason || `http_${response.status}` };
  } catch {
    return { data: null, reason: "network" };
  }
}

export async function callAnalyze(
  messages: Message[],
  myName: string,
): Promise<ApiResult<RadarResult>> {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, myName }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: RadarResult;
      reason?: string;
    };
    if (response.ok && payload.ok && payload.result) return { data: payload.result };
    return { data: null, reason: payload.reason || `http_${response.status}` };
  } catch {
    return { data: null, reason: "network" };
  }
}
