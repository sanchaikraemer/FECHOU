"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, RadarResult } from "@/lib/types";
import { parseWhatsApp } from "@/lib/parseWhatsApp";
import { unzipSync } from "fflate";
import { callAnalyze, transcribeAudio } from "@/lib/ai";

type Screen = "home" | "processing" | "result";

const AUDIO_EXT_RE = /\.(opus|ogg|m4a|mp3|wav|aac|amr)$/i;

function guessType(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".opus")) return "audio/opus";
  if (n.endsWith(".ogg")) return "audio/ogg";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".aac")) return "audio/aac";
  if (n.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

async function expandFiles(input: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of input) {
    const isZip =
      /\.zip$/i.test(f.name) ||
      f.type === "application/zip" ||
      f.type === "application/x-zip-compressed";
    if (isZip) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const entries = unzipSync(buf);
        // sort paths so the largest .txt comes first (main conversation over readme/logs)
        const paths = Object.keys(entries).filter((p) => !p.endsWith("/"));
        const txtPaths = paths.filter((p) => /\.txt$/i.test(p.split("/").pop() || p));
        const otherPaths = paths.filter((p) => !/\.txt$/i.test(p.split("/").pop() || p));
        txtPaths.sort((a, b) => entries[b].length - entries[a].length);
        for (const path of [...txtPaths, ...otherPaths]) {
          const base = path.split("/").pop() || path;
          out.push(new File([entries[path]], base, { type: guessType(base) }));
        }
      } catch {
        // zip ilegível
      }
    } else {
      out.push(f);
    }
  }
  return out;
}

function priorityColor(p: number): string {
  if (p >= 70) return "#22C55E";
  if (p >= 40) return "#F59E0B";
  return "#EF4444";
}

function priorityLabel(p: number): string {
  if (p >= 80) return "ALTA";
  if (p >= 50) return "MÉDIA";
  return "BAIXA";
}

export default function RadarApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [myName, setMyName] = useState("Corretor");
  const [step, setStep] = useState(0);
  const [stepDetail, setStepDetail] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<RadarResult | null>(null);
  const [contactName, setContactName] = useState("");
  const [copied, setCopied] = useState(false);

  const mediaRef = useRef<Map<string, File>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Recebe via Share Target
  useEffect(() => {
    if (typeof window === "undefined" || !("caches" in window)) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("shared") !== "1") return;

    (async () => {
      const files: File[] = [];
      let sharedText = "";
      try {
        const cache = await caches.open("radar-share");
        const idxRes = await cache.match("/__shared__/index.json");
        if (idxRes) {
          const idx = (await idxRes.json()) as {
            files?: { key: string; name: string; type?: string }[];
            text?: string;
          };
          sharedText = idx.text || "";
          for (const meta of idx.files || []) {
            const r = await cache.match(meta.key);
            if (r) {
              const blob = await r.blob();
              files.push(new File([blob], meta.name, { type: meta.type || blob.type }));
            }
          }
        }
        for (const k of await cache.keys()) await cache.delete(k);
      } catch {
        /* sem cache */
      }
      window.history.replaceState({}, "", "/");
      const txt = await ingestFiles(files);
      const finalText = txt || sharedText;
      if (finalText.trim()) {
        await runAnalysis(finalText);
      } else {
        setScreen("home");
        setError("Recebi o compartilhamento mas não encontrei a conversa. No WhatsApp: Exportar conversa → Compartilhar → Radar.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingestFiles = async (files: File[]): Promise<string> => {
    const flat = await expandFiles(files);
    let txt = "";
    for (const f of flat) {
      if (/\.txt$/i.test(f.name)) {
        if (!txt) txt = await f.text();
      } else if (AUDIO_EXT_RE.test(f.name) || (f.type || "").startsWith("audio/")) {
        mediaRef.current.set(f.name, f);
      }
    }
    return txt;
  };

  const runAnalysis = async (text: string) => {
    setScreen("processing");
    setError("");
    setStep(1);
    setStepDetail("");

    const parsed = parseWhatsApp(text, myName);
    if (!parsed.count) {
      setScreen("home");
      setError("Não encontrei mensagens nesse arquivo. Exporte a conversa do WhatsApp como .txt ou .zip e tente novamente.");
      return;
    }
    setContactName(parsed.themName);
    setStepDetail(`${parsed.count} mensagens`);

    setStep(2);
    const pendingAudios = parsed.messages.filter(
      (m) => m.k === "audio" && m.file && mediaRef.current.has(m.file),
    );
    let transcribed = 0;
    const BATCH = 5;
    for (let i = 0; i < pendingAudios.length; i += BATCH) {
      const batch = pendingAudios.slice(i, i + BATCH);
      await Promise.all(batch.map(async (m) => {
        const f = m.file ? mediaRef.current.get(m.file) : undefined;
        if (f) {
          const t = await transcribeAudio(f);
          if (t) m.transcript = t;
        }
        transcribed++;
        setStepDetail(`Áudio ${transcribed}/${pendingAudios.length}`);
      }));
    }

    setStep(3);
    setStepDetail("");
    const ai = await callAnalyze(parsed.messages, myName);

    if (!ai) {
      setScreen("home");
      setError("Não foi possível analisar a conversa. Verifique a chave OPENAI_API_KEY e tente novamente.");
      return;
    }

    setResult(ai);
    setStep(4);
    setTimeout(() => setScreen("result"), 400);
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    mediaRef.current = new Map();
    const txt = await ingestFiles(Array.from(files));
    if (txt.trim()) {
      await runAnalysis(txt);
    } else {
      setError("Nenhum arquivo .txt encontrado. Selecione o arquivo exportado do WhatsApp (.zip com conversa ou .txt direto).");
    }
  };

  const copyMessage = () => {
    if (!result?.mensagem) return;
    navigator.clipboard.writeText(result.mensagem).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const reset = () => {
    setScreen("home");
    setResult(null);
    setError("");
    setStep(0);
    setStepDetail("");
    setCopied(false);
    mediaRef.current = new Map();
  };

  const pc = priorityColor(result?.prioridade ?? 0);

  const STEPS = [
    { label: "Lendo conversa", detail: stepDetail || "mensagens" },
    { label: "Transcrevendo áudios", detail: stepDetail || "via OpenAI" },
    { label: "Analisando com IA", detail: "GPT-4o" },
    { label: "Resultado pronto", detail: "" },
  ];

  return (
    <div
      lang="pt-BR"
      translate="no"
      style={{
        width: "100%",
        minHeight: "100dvh",
        background: "#0B0D12",
        display: "flex",
        justifyContent: "center",
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "480px",
          minHeight: "100dvh",
          background: "#0F1117",
          display: "flex",
          flexDirection: "column",
          color: "#E8E9EE",
          overflowX: "hidden",
        }}
      >

        {/* ══════════════ HOME ══════════════ */}
        {screen === "home" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 0 32px" }}>

            {/* header */}
            <div style={{ padding: "52px 24px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "10px",
                  background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "18px",
                }}>
                  📡
                </div>
                <span style={{
                  fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                  fontWeight: 800, fontSize: "24px", letterSpacing: "-0.03em",
                  color: "#fff",
                }}>
                  Radar
                </span>
              </div>
              <div style={{
                fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                fontWeight: 700, fontSize: "28px", lineHeight: 1.2,
                letterSpacing: "-0.02em", color: "#fff", marginTop: "28px",
              }}>
                Importe uma conversa e descubra o que fazer.
              </div>
              <div style={{ fontSize: "14px", color: "#6B7280", marginTop: "10px", lineHeight: 1.6 }}>
                O Radar analisa sua conversa do WhatsApp e entrega uma decisão: vale retomar, o que travou e o que enviar.
              </div>
            </div>

            {/* share flow card */}
            <div style={{ margin: "28px 20px 0", background: "#161920", border: "1px solid #1F2330", borderRadius: "20px", padding: "20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "#10B981", textTransform: "uppercase", marginBottom: "14px" }}>
                COMO COMPARTILHAR
              </div>
              {[
                { icon: "💬", text: "Abra a conversa no WhatsApp" },
                { icon: "⋮", text: "Menu → Exportar conversa" },
                { icon: "📤", text: "Compartilhar → Radar" },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: i < 2 ? "12px" : 0 }}>
                  <div style={{
                    width: "32px", height: "32px", borderRadius: "9px",
                    background: "#1E2230", display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: "15px", flexShrink: 0,
                  }}>
                    {s.icon}
                  </div>
                  <span style={{ fontSize: "14px", color: "#C9CBD3" }}>{s.text}</span>
                </div>
              ))}
            </div>

            {/* name input */}
            <div style={{ margin: "20px 20px 0" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: "#6B7280", textTransform: "uppercase", marginBottom: "6px" }}>
                Seu nome na conversa
              </div>
              <input
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                placeholder="Ex.: João"
                style={{
                  width: "100%", background: "#161920", border: "1px solid #1F2330",
                  borderRadius: "12px", padding: "11px 14px", color: "#E8E9EE",
                  fontSize: "14px", fontFamily: "inherit", outline: "none",
                }}
              />
            </div>

            {/* fallback file picker */}
            <div style={{ margin: "16px 20px 0" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: "#6B7280", textTransform: "uppercase", marginBottom: "6px" }}>
                Ou selecione o arquivo
              </div>
              <label style={{
                display: "flex", alignItems: "center", gap: "12px",
                background: "#161920", border: "1px dashed #2A2F3E",
                borderRadius: "14px", padding: "14px", cursor: "pointer",
              }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.zip,.opus,.ogg,.m4a,.mp3,.wav,.aac,audio/*,application/zip,text/plain"
                  onChange={(e) => onPickFiles(e.target.files)}
                  style={{ display: "none" }}
                />
                <div style={{
                  width: "36px", height: "36px", borderRadius: "10px",
                  background: "#10B981", display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: "16px", flexShrink: 0,
                }}>
                  📎
                </div>
                <div>
                  <div style={{ color: "#E8E9EE", fontSize: "14px", fontWeight: 600 }}>
                    Selecionar .zip ou .txt exportado
                  </div>
                  <div style={{ color: "#6B7280", fontSize: "12px", marginTop: "2px" }}>
                    Áudios .opus também são transcritos
                  </div>
                </div>
              </label>
            </div>

            {error && (
              <div style={{
                margin: "14px 20px 0",
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: "12px", padding: "12px 14px",
                fontSize: "13px", color: "#FCA5A5", lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}

            <div style={{ flex: 1 }} />
            <div style={{ padding: "0 20px", marginTop: "24px", fontSize: "11px", color: "#374151", textAlign: "center", lineHeight: 1.5 }}>
              Conversas processadas com OpenAI · nenhum dado é armazenado
            </div>
          </div>
        )}

        {/* ══════════════ PROCESSING ══════════════ */}
        {screen === "processing" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "52px 24px 32px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "36px" }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "10px",
                background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px",
              }}>
                📡
              </div>
              <span style={{
                fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                fontWeight: 800, fontSize: "22px", color: "#fff", letterSpacing: "-0.03em",
              }}>
                Radar
              </span>
            </div>

            <div style={{
              fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
              fontWeight: 700, fontSize: "22px", color: "#fff", marginBottom: "8px",
            }}>
              Analisando conversa…
            </div>
            {contactName && (
              <div style={{ fontSize: "13px", color: "#6B7280", marginBottom: "32px" }}>
                Cliente: {contactName}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {STEPS.map((s, i) => {
                const done = step > i + 1;
                const active = step === i + 1;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    {done ? (
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        background: "#10B981", color: "#fff", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        fontSize: "14px", fontWeight: 700, flexShrink: 0,
                      }}>✓</div>
                    ) : active ? (
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        border: "2.5px solid #1F2330", borderTopColor: "#10B981",
                        animation: "radarSpin .7s linear infinite", flexShrink: 0,
                      }} />
                    ) : (
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        border: "2px solid #1F2330", flexShrink: 0,
                      }} />
                    )}
                    <div>
                      <div style={{
                        fontSize: "14px", fontWeight: 600,
                        color: done ? "#9CA3AF" : active ? "#fff" : "#374151",
                      }}>
                        {s.label}
                      </div>
                      {(active && s.detail) && (
                        <div style={{ fontSize: "12px", color: "#10B981", marginTop: "1px" }}>
                          {s.detail}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══════════════ RESULT ══════════════ */}
        {screen === "result" && result && (
          <div
            style={{
              flex: 1, display: "flex", flexDirection: "column",
              overflowY: "auto", padding: "0 0 40px",
            }}
          >
            {/* top bar */}
            <div style={{
              padding: "52px 20px 0",
              background: "#0F1117",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "16px" }}>📡</span>
                <span style={{
                  fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                  fontWeight: 800, fontSize: "18px", color: "#fff", letterSpacing: "-0.02em",
                }}>
                  Radar
                </span>
              </div>
              <button
                onClick={reset}
                style={{
                  background: "#161920", border: "1px solid #1F2330",
                  color: "#9CA3AF", padding: "6px 14px", borderRadius: "999px",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                ← Nova conversa
              </button>
            </div>

            {contactName && (
              <div style={{ padding: "8px 20px 0", fontSize: "13px", color: "#6B7280" }}>
                {contactName}
              </div>
            )}

            {/* prioridade + vale retomar */}
            <div style={{
              margin: "20px 20px 0",
              background: "#161920", border: "1px solid #1F2330",
              borderRadius: "20px", padding: "20px",
              display: "flex", alignItems: "center", gap: "20px",
            }}>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{
                  fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                  fontWeight: 800, fontSize: "52px", lineHeight: 1,
                  color: pc, letterSpacing: "-0.03em",
                }}>
                  {result.prioridade}
                </div>
                <div style={{ fontSize: "11px", color: "#6B7280", marginTop: "2px" }}>
                  /100 · {priorityLabel(result.prioridade)}
                </div>
              </div>
              <div style={{ width: "1px", background: "#1F2330", alignSelf: "stretch" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: "#6B7280", textTransform: "uppercase", marginBottom: "6px" }}>
                  Vale retomar?
                </div>
                <div style={{
                  fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                  fontWeight: 800, fontSize: "28px", letterSpacing: "-0.02em",
                  color: result.valeRetomar ? "#10B981" : "#EF4444",
                }}>
                  {result.valeRetomar ? "SIM" : "NÃO"}
                </div>
                {result.motivoPrioridade && (
                  <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "6px", lineHeight: 1.4 }}>
                    {result.motivoPrioridade}
                  </div>
                )}
              </div>
            </div>

            {/* o que aconteceu */}
            <Section title="O que aconteceu">
              <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#C9CBD3", margin: 0 }}>
                {result.oQueAconteceu}
              </p>
            </Section>

            {/* onde travou */}
            <Section title="Onde travou">
              <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#C9CBD3", margin: 0 }}>
                {result.ondeTravou}
              </p>
            </Section>

            {/* o que falta descobrir */}
            {result.faltouDescobrir.length > 0 && (
              <Section title="O que falta descobrir">
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {result.faltouDescobrir.map((item, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                      <div style={{
                        width: "6px", height: "6px", borderRadius: "50%",
                        background: "#F59E0B", flexShrink: 0, marginTop: "7px",
                      }} />
                      <span style={{ fontSize: "14px", color: "#C9CBD3", lineHeight: 1.5 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* próxima ação */}
            <div style={{ margin: "12px 20px 0" }}>
              <div style={{
                background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
                borderRadius: "16px", padding: "16px",
              }}>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: "#10B981", textTransform: "uppercase", marginBottom: "8px" }}>
                  Próxima ação
                </div>
                <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#E8E9EE", margin: 0, fontWeight: 500 }}>
                  {result.proximaAcao}
                </p>
              </div>
            </div>

            {/* mensagem sugerida */}
            <div style={{ margin: "12px 20px 0" }}>
              <div style={{
                background: "#161920", border: "1px solid #1F2330",
                borderRadius: "16px", padding: "16px",
              }}>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: "#6B7280", textTransform: "uppercase", marginBottom: "10px" }}>
                  Mensagem sugerida
                </div>
                <p style={{ fontSize: "14px", lineHeight: 1.65, color: "#C9CBD3", margin: "0 0 14px", whiteSpace: "pre-wrap" }}>
                  {result.mensagem}
                </p>
                <button
                  onClick={copyMessage}
                  style={{
                    width: "100%", border: "none", cursor: "pointer",
                    background: copied ? "#059669" : "#10B981",
                    color: "#fff", fontWeight: 700, fontSize: "14px",
                    fontFamily: "inherit", padding: "13px 0", borderRadius: "12px",
                    transition: "background .2s",
                  }}
                >
                  {copied ? "✓ COPIADO" : "COPIAR"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: "12px 20px 0" }}>
      <div style={{
        background: "#161920", border: "1px solid #1F2330",
        borderRadius: "16px", padding: "16px",
      }}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: "#6B7280", textTransform: "uppercase", marginBottom: "8px" }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
