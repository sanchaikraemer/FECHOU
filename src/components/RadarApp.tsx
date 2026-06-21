"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, RadarResult } from "@/lib/types";
import { parseWhatsApp } from "@/lib/parseWhatsApp";
import { unzipSync } from "fflate";
import { callAnalyze, transcribeAudio } from "@/lib/ai";

// ── brand tokens ────────────────────────────────────────────────
const C = {
  bg:        "#0C1D24",
  card:      "#132A33",
  coral:     "#FF6B5C",
  coralDim:  "rgba(255,107,92,0.12)",
  coralBorder:"rgba(255,107,92,0.25)",
  text:      "#E6EEF0",
  muted:     "#8FA9B0",
  border:    "#21424E",
};
const SORA  = "'Sora', system-ui, sans-serif";
const INTER = "'Inter', system-ui, sans-serif";
// ────────────────────────────────────────────────────────────────

type Screen = "home" | "processing" | "result";
const AUDIO_EXT_RE = /\.(opus|ogg|m4a|mp3|wav|aac|amr)$/i;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function guessType(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".opus")) return "audio/opus";
  if (n.endsWith(".ogg"))  return "audio/ogg";
  if (n.endsWith(".m4a"))  return "audio/mp4";
  if (n.endsWith(".mp3"))  return "audio/mpeg";
  if (n.endsWith(".wav"))  return "audio/wav";
  if (n.endsWith(".aac"))  return "audio/aac";
  if (n.endsWith(".txt"))  return "text/plain";
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
        const buf     = new Uint8Array(await f.arrayBuffer());
        const entries = unzipSync(buf);
        const paths   = Object.keys(entries).filter((p) => !p.endsWith("/"));
        const txtPaths   = paths.filter((p) => /\.txt$/i.test(p.split("/").pop() || p));
        const otherPaths = paths.filter((p) => !/\.txt$/i.test(p.split("/").pop() || p));
        txtPaths.sort((a, b) => entries[b].length - entries[a].length);
        for (const path of [...txtPaths, ...otherPaths]) {
          const base = path.split("/").pop() || path;
          out.push(new File([entries[path]], base, { type: guessType(base) }));
        }
      } catch { /* zip ilegível */ }
    } else {
      out.push(f);
    }
  }
  return out;
}

function priorityColor(p: number): string {
  if (p >= 70) return "#4ADE80";
  if (p >= 40) return "#FBBF24";
  return C.coral;
}
function priorityLabel(p: number): string {
  if (p >= 80) return "ALTA";
  if (p >= 50) return "MÉDIA";
  return "BAIXA";
}

// ── Logo SVG (ondas + ponto coral) ──────────────────────────────
function LogoSymbol({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill={C.card} />
      <circle cx="10" cy="22" r="2" fill={C.muted} />
      <path d="M10 22 Q16 16 22 14" stroke={C.muted} strokeWidth="2" strokeLinecap="round" fill="none" opacity=".5" />
      <path d="M10 22 Q18 12 26 9"  stroke={C.text}  strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="26" cy="9" r="3" fill={C.coral} />
    </svg>
  );
}

function LogoRow({ size = 28 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <LogoSymbol size={size + 4} />
      <div>
        <div style={{
          fontFamily: SORA, fontWeight: 800, fontSize: `${size}px`,
          letterSpacing: "-0.03em", color: C.text, lineHeight: 1,
        }}>
          Radar<span style={{ color: C.coral }}>.</span>
        </div>
        <div style={{
          fontFamily: INTER, fontWeight: 600, fontSize: "10px",
          letterSpacing: "0.12em", color: C.muted, textTransform: "uppercase",
          marginTop: "1px",
        }}>
          de vendas
        </div>
      </div>
    </div>
  );
}
// ────────────────────────────────────────────────────────────────

export default function RadarApp() {
  const [screen, setScreen]           = useState<Screen>("home");
  const [myName, setMyName]           = useState("Corretor");
  const [step, setStep]               = useState(0);
  const [stepDetail, setStepDetail]   = useState("");
  const [error, setError]             = useState("");
  const [result, setResult]           = useState<RadarResult | null>(null);
  const [contactName, setContactName] = useState("");
  const [copied, setCopied]           = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall]     = useState(false);
  const [isIOS, setIsIOS]                 = useState(false);

  const mediaRef    = useRef<Map<string, File>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
    if (isStandalone) return;

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
    setIsIOS(ios);
    setShowInstall(true);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") setShowInstall(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || !("caches" in window)) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("shared") !== "1") return;

    (async () => {
      const files: File[] = [];
      let sharedText = "";
      try {
        const cache  = await caches.open("radar-share");
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
      } catch { /* sem cache */ }
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
    { label: "Lendo conversa",     detail: stepDetail || "mensagens" },
    { label: "Transcrevendo áudios", detail: stepDetail || "via OpenAI" },
    { label: "Analisando com IA",  detail: "GPT-4o" },
    { label: "Resultado pronto",   detail: "" },
  ];

  return (
    <div style={{
      width: "100%", minHeight: "100dvh", background: C.bg,
      display: "flex", justifyContent: "center", fontFamily: INTER,
    }}>
      <div style={{
        position: "relative", width: "100%", maxWidth: "480px",
        minHeight: "100dvh", background: C.bg,
        display: "flex", flexDirection: "column",
        color: C.text, overflowX: "hidden",
      }}>

        {/* ══════════════ HOME ══════════════ */}
        {screen === "home" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 0 32px" }}>

            <div style={{ padding: "52px 24px 0" }}>
              <LogoRow size={26} />
              <div style={{
                fontFamily: SORA, fontWeight: 800, fontSize: "28px",
                lineHeight: 1.2, letterSpacing: "-0.02em", color: C.text, marginTop: "28px",
              }}>
                Importe uma conversa e descubra o que fazer.
              </div>
              <div style={{ fontSize: "14px", color: C.muted, marginTop: "10px", lineHeight: 1.6 }}>
                O Radar analisa sua conversa do WhatsApp e entrega uma decisão: vale retomar, o que travou e o que enviar.
              </div>
            </div>

            {/* share flow */}
            <div style={{ margin: "28px 20px 0", background: C.card, border: `1px solid ${C.border}`, borderRadius: "20px", padding: "20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: C.coral, textTransform: "uppercase", marginBottom: "14px" }}>
                COMO COMPARTILHAR
              </div>
              {[
                { icon: "💬", text: "Abra a conversa no WhatsApp" },
                { icon: "⋮",  text: "Menu → Exportar conversa" },
                { icon: "📤", text: "Compartilhar → Radar" },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: i < 2 ? "12px" : 0 }}>
                  <div style={{
                    width: "32px", height: "32px", borderRadius: "9px",
                    background: C.bg, border: `1px solid ${C.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "15px", flexShrink: 0,
                  }}>
                    {s.icon}
                  </div>
                  <span style={{ fontSize: "14px", color: C.text }}>{s.text}</span>
                </div>
              ))}
            </div>

            {/* name input */}
            <div style={{ margin: "20px 20px 0" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: C.muted, textTransform: "uppercase", marginBottom: "6px" }}>
                Seu nome na conversa
              </div>
              <input
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                placeholder="Ex.: João"
                style={{
                  width: "100%", background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: "12px", padding: "11px 14px", color: C.text,
                  fontSize: "14px", fontFamily: INTER, outline: "none",
                }}
              />
            </div>

            {/* file picker */}
            <div style={{ margin: "16px 20px 0" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: C.muted, textTransform: "uppercase", marginBottom: "6px" }}>
                Ou selecione o arquivo
              </div>
              <label style={{
                display: "flex", alignItems: "center", gap: "12px",
                background: C.card, border: `1px dashed ${C.border}`,
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
                  background: C.coral, display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: "16px", flexShrink: 0,
                }}>
                  📎
                </div>
                <div>
                  <div style={{ color: C.text, fontSize: "14px", fontWeight: 600 }}>
                    Selecionar .zip ou .txt exportado
                  </div>
                  <div style={{ color: C.muted, fontSize: "12px", marginTop: "2px" }}>
                    Áudios .opus também são transcritos
                  </div>
                </div>
              </label>
            </div>

            {error && (
              <div style={{
                margin: "14px 20px 0",
                background: C.coralDim, border: `1px solid ${C.coralBorder}`,
                borderRadius: "12px", padding: "12px 14px",
                fontSize: "13px", color: "#FCA5A5", lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* install banner */}
            {showInstall && (
              <div style={{
                margin: "20px 20px 0",
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: "16px", padding: "16px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                  <LogoSymbol size={24} />
                  <div style={{ flex: 1, fontSize: "13px", fontWeight: 700, color: C.text }}>
                    Instale o Radar no celular
                  </div>
                  <button
                    onClick={() => setShowInstall(false)}
                    style={{
                      background: "none", border: "none", color: C.muted,
                      fontSize: "20px", cursor: "pointer", padding: "0",
                      lineHeight: 1, flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
                {isIOS ? (
                  <div style={{ fontSize: "13px", color: C.muted, lineHeight: 1.6 }}>
                    No Safari: toque em <strong style={{ color: C.text }}>Compartilhar</strong> → <strong style={{ color: C.text }}>Adicionar à tela de início</strong>
                  </div>
                ) : installPrompt ? (
                  <button
                    onClick={handleInstall}
                    style={{
                      width: "100%", background: C.coral, border: "none", color: "#fff",
                      fontWeight: 700, fontSize: "13px", fontFamily: INTER,
                      padding: "11px 0", borderRadius: "10px", cursor: "pointer",
                    }}
                  >
                    Instalar agora
                  </button>
                ) : (
                  <div style={{ fontSize: "13px", color: C.muted, lineHeight: 1.6 }}>
                    No Chrome: toque nos <strong style={{ color: C.text }}>3 pontos</strong> → <strong style={{ color: C.text }}>Adicionar à tela inicial</strong>
                  </div>
                )}
              </div>
            )}

            <div style={{ padding: "0 20px", marginTop: "24px", fontSize: "11px", color: C.border, textAlign: "center", lineHeight: 1.5 }}>
              Conversas processadas com OpenAI · nenhum dado é armazenado
            </div>
          </div>
        )}

        {/* ══════════════ PROCESSING ══════════════ */}
        {screen === "processing" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "52px 24px 32px" }}>
            <div style={{ marginBottom: "36px" }}>
              <LogoRow size={22} />
            </div>

            <div style={{ fontFamily: SORA, fontWeight: 800, fontSize: "22px", color: C.text, marginBottom: "8px" }}>
              Analisando conversa…
            </div>
            {contactName && (
              <div style={{ fontSize: "13px", color: C.muted, marginBottom: "32px" }}>
                Cliente: {contactName}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {STEPS.map((s, i) => {
                const done   = step > i + 1;
                const active = step === i + 1;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    {done ? (
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        background: C.coral, color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "14px", fontWeight: 700, flexShrink: 0,
                      }}>✓</div>
                    ) : active ? (
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        border: `2.5px solid ${C.border}`, borderTopColor: C.coral,
                        animation: "radarSpin .7s linear infinite", flexShrink: 0,
                      }} />
                    ) : (
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        border: `2px solid ${C.border}`, flexShrink: 0,
                      }} />
                    )}
                    <div>
                      <div style={{
                        fontSize: "14px", fontWeight: 600,
                        color: done ? C.muted : active ? C.text : C.border,
                      }}>
                        {s.label}
                      </div>
                      {(active && s.detail) && (
                        <div style={{ fontSize: "12px", color: C.coral, marginTop: "1px" }}>
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
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", padding: "0 0 40px" }}>

            {/* top bar */}
            <div style={{
              padding: "52px 20px 0", background: C.bg,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <LogoRow size={18} />
              <button
                onClick={reset}
                style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  color: C.muted, padding: "6px 14px", borderRadius: "999px",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: INTER,
                }}
              >
                ← Nova conversa
              </button>
            </div>

            {contactName && (
              <div style={{ padding: "8px 20px 0", fontSize: "13px", color: C.muted }}>
                {contactName}
              </div>
            )}

            {/* prioridade + vale retomar */}
            <div style={{
              margin: "20px 20px 0", background: C.card, border: `1px solid ${C.border}`,
              borderRadius: "20px", padding: "20px",
              display: "flex", alignItems: "center", gap: "20px",
            }}>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{
                  fontFamily: SORA, fontWeight: 800, fontSize: "52px",
                  lineHeight: 1, color: pc, letterSpacing: "-0.03em",
                }}>
                  {result.prioridade}
                </div>
                <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
                  /100 · {priorityLabel(result.prioridade)}
                </div>
              </div>
              <div style={{ width: "1px", background: C.border, alignSelf: "stretch" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: C.muted, textTransform: "uppercase", marginBottom: "6px" }}>
                  Vale retomar?
                </div>
                <div style={{
                  fontFamily: SORA, fontWeight: 800, fontSize: "28px",
                  letterSpacing: "-0.02em",
                  color: result.valeRetomar ? "#4ADE80" : C.coral,
                }}>
                  {result.valeRetomar ? "SIM" : "NÃO"}
                </div>
                {result.motivoPrioridade && (
                  <div style={{ fontSize: "12px", color: C.muted, marginTop: "6px", lineHeight: 1.4 }}>
                    {result.motivoPrioridade}
                  </div>
                )}
              </div>
            </div>

            <Section title="O que aconteceu">
              <p style={{ fontSize: "14px", lineHeight: 1.6, color: C.muted, margin: 0 }}>
                {result.oQueAconteceu}
              </p>
            </Section>

            <Section title="Onde travou">
              <p style={{ fontSize: "14px", lineHeight: 1.6, color: C.muted, margin: 0 }}>
                {result.ondeTravou}
              </p>
            </Section>

            {result.faltouDescobrir.length > 0 && (
              <Section title="O que falta descobrir">
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {result.faltouDescobrir.map((item, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                      <div style={{
                        width: "6px", height: "6px", borderRadius: "50%",
                        background: C.coral, flexShrink: 0, marginTop: "7px",
                      }} />
                      <span style={{ fontSize: "14px", color: C.muted, lineHeight: 1.5 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* próxima ação */}
            <div style={{ margin: "12px 20px 0" }}>
              <div style={{
                background: C.coralDim, border: `1px solid ${C.coralBorder}`,
                borderRadius: "16px", padding: "16px",
              }}>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: C.coral, textTransform: "uppercase", marginBottom: "8px" }}>
                  Próxima ação
                </div>
                <p style={{ fontSize: "14px", lineHeight: 1.6, color: C.text, margin: 0, fontWeight: 500 }}>
                  {result.proximaAcao}
                </p>
              </div>
            </div>

            {/* mensagem sugerida */}
            <div style={{ margin: "12px 20px 0" }}>
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: "16px", padding: "16px",
              }}>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: C.muted, textTransform: "uppercase", marginBottom: "10px" }}>
                  Mensagem sugerida
                </div>
                <p style={{ fontSize: "14px", lineHeight: 1.65, color: C.muted, margin: "0 0 14px", whiteSpace: "pre-wrap" }}>
                  {result.mensagem}
                </p>
                <button
                  onClick={copyMessage}
                  style={{
                    width: "100%", border: "none", cursor: "pointer",
                    background: copied ? "#D95A4A" : C.coral,
                    color: "#fff", fontWeight: 700, fontSize: "14px",
                    fontFamily: INTER, padding: "13px 0", borderRadius: "12px",
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
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: "16px", padding: "16px",
      }}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", color: C.muted, textTransform: "uppercase", marginBottom: "8px" }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
