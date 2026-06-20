import type { Message, RadarResult } from "./types";

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

export async function callAnalyze(
  messages: Message[],
  myName: string,
): Promise<RadarResult | null> {
  try {
    const r = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, myName }),
    });
    const data = await r.json();
    if (data && data.ok && data.result) return data.result as RadarResult;
    return null;
  } catch {
    return null;
  }
}
