"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AiResult,
  Analysis,
  Conversation,
  Message,
  Screen,
  StatusTone,
  Tone,
} from "@/lib/types";
import { parseWhatsApp } from "@/lib/parseWhatsApp";
import {
  buildSuggestions,
  callAnalyze,
  fallbackSuggestions,
  transcribeAudio,
} from "@/lib/ai";
import { CONV_ORDER, initialConvs, SAMPLE, TEMPLATES } from "@/lib/sample";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  fetchConversations,
  getCurrentEmail,
  saveConversation,
  signOut,
} from "@/lib/supabase/conversations";

const WAVE = [8, 14, 20, 11, 22, 9, 16, 24, 12, 18, 8, 15, 21, 10];

function badge(tone: StatusTone): { bg: string; color: string } {
  const map: Record<StatusTone, { bg: string; color: string }> = {
    cold: { bg: "#E8F0FB", color: "#3D7FCC" },
    warm: { bg: "#FBF0DD", color: "#B07A1E" },
    hot: { bg: "#FCE7E0", color: "#D63D1F" },
    new: { bg: "#ECECEF", color: "#6B6D77" },
  };
  return map[tone] || map.new;
}

export default function FechouApp() {
  const [screen, setScreen] = useState<Screen>("inbox");
  const [activeId, setActiveId] = useState("gabro");
  const [filter, setFilter] = useState<"todas" | "ativas" | "frias">("todas");
  const [tone, setTone] = useState<Tone>("amigavel");
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [typing, setTyping] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [importStep, setImportStep] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [myName, setMyName] = useState("Sanchai");
  const [importText, setImportText] = useState(SAMPLE);
  const [aiError, setAiError] = useState("");
  const [parsedCount, setParsedCount] = useState(0);
  const [mediaCount, setMediaCount] = useState(0);
  const [transcribeMsg, setTranscribeMsg] = useState("");
  const [convs, setConvs] = useState<Record<string, Conversation>>(initialConvs);
  const [dynamicIds, setDynamicIds] = useState<string[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const router = useRouter();
  const supaOn = isSupabaseConfigured();
  const msgRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Arquivos de mídia anexados no import (chave = nome do arquivo).
  const mediaRef = useRef<Map<string, File>>(new Map());

  const delay = (ms: number) =>
    new Promise<void>((r) => {
      timersRef.current.push(setTimeout(r, ms));
    });

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
    },
    [],
  );

  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      window.location.protocol.startsWith("http")
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Auth + conversas salvas (só quando o Supabase está configurado).
  useEffect(() => {
    if (!supaOn) return;
    let alive = true;
    (async () => {
      const email = await getCurrentEmail();
      if (alive) setUserEmail(email);
      const saved = await fetchConversations();
      if (alive && saved.length) {
        setConvs((prev) => {
          const merged = { ...prev };
          for (const c of saved) merged[c.id] = c;
          return merged;
        });
        setDynamicIds((prev) => {
          const ids = saved.map((c) => c.id);
          const rest = prev.filter((id) => !ids.includes(id));
          return [...ids, ...rest];
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [supaOn]);

  useEffect(() => {
    if (screen === "chat" && msgRef.current) {
      msgRef.current.scrollTop = msgRef.current.scrollHeight;
    }
  }, [screen, activeId, convs, typing, panelOpen, analysisOpen]);

  // ---- handlers ----
  const openChat = (id: string) => {
    setScreen("chat");
    setActiveId(id);
    setInput("");
    setPanelOpen(true);
    setShowTemplates(false);
    setRegenerating(false);
  };
  const back = () => {
    setScreen("inbox");
    setShowTemplates(false);
  };

  const handleAvatar = async () => {
    if (!supaOn) return;
    if (userEmail) {
      if (
        typeof window !== "undefined" &&
        window.confirm(`Sair de ${userEmail}?`)
      ) {
        await signOut();
        setUserEmail(null);
        window.location.reload();
      }
    } else {
      router.push("/login");
    }
  };

  const refresh = async () => {
    setRegenerating(true);
    const active = convs[activeId];
    let ai: AiResult | null = null;
    try {
      ai = await callAnalyze(active.messages, myName);
    } catch {
      ai = null;
    }
    await delay(400);
    const sug = buildSuggestions(ai);
    setRegenerating(false);
    if (sug) {
      setConvs((prev) => ({
        ...prev,
        [activeId]: { ...prev[activeId], suggestions: sug },
      }));
    }
  };

  const useTemplate = (text: string) => {
    setInput(text);
    setShowTemplates(false);
    setPanelOpen(false);
  };

  const openImport = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    mediaRef.current = new Map();
    setMediaCount(0);
    setTranscribeMsg("");
    setScreen("importing");
    setAiBusy(false);
    setAiError("");
    setImportStep(0);
  };

  // Upload dos arquivos da conversa: detecta o .txt e guarda as mídias (áudios/anexos).
  const onPickFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    let txtFile: File | null = null;
    Array.from(files).forEach((f) => {
      if (/\.txt$/i.test(f.name)) {
        if (!txtFile) txtFile = f;
      } else {
        mediaRef.current.set(f.name, f);
      }
    });
    setMediaCount(mediaRef.current.size);
    if (txtFile) {
      const reader = new FileReader();
      reader.onload = () => setImportText(String(reader.result || ""));
      reader.readAsText(txtFile);
    }
  };
  const skipImport = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setScreen("chat");
    setActiveId("gabro");
    setAiBusy(false);
    setPanelOpen(true);
    setAnalysisOpen(true);
  };

  const analyze = async () => {
    setAiBusy(true);
    setAiError("");
    setImportStep(1);
    const parsed = parseWhatsApp(importText, myName);
    if (!parsed.count) {
      setAiBusy(false);
      setAiError(
        "Não consegui ler mensagens nesse texto. Cole o conteúdo do arquivo .txt exportado do WhatsApp.",
      );
      return;
    }
    setParsedCount(parsed.count);
    await delay(450);
    setImportStep(2);
    // Transcreve os áudios cujos arquivos .opus foram enviados (Whisper).
    const pendingAudios = parsed.messages.filter(
      (m) => m.k === "audio" && m.file && mediaRef.current.has(m.file),
    );
    if (pendingAudios.length) {
      for (let i = 0; i < pendingAudios.length; i++) {
        const m = pendingAudios[i];
        setTranscribeMsg(
          `Transcrevendo áudios… ${i + 1}/${pendingAudios.length}`,
        );
        const f = m.file ? mediaRef.current.get(m.file) : undefined;
        if (f) {
          const text = await transcribeAudio(f);
          if (text) m.transcript = text;
        }
      }
      setTranscribeMsg("");
    }
    await delay(450);
    setImportStep(3);
    setImportStep(4);
    let ai: AiResult | null = null;
    try {
      ai = await callAnalyze(parsed.messages, myName);
    } catch {
      ai = null;
    }
    setImportStep(5);
    await delay(300);
    const sug = buildSuggestions(ai) || fallbackSuggestions();
    const analysis: Analysis = ai
      ? {
          oneLine: ai.oneLine || "negociação importada",
          chips: Array.isArray(ai.chips) ? ai.chips : [],
          summary: ai.summary || "",
          frictions: Array.isArray(ai.frictions) ? ai.frictions : [],
          rec: ai.rec || "",
          source: "Gerado por IA a partir do texto importado.",
        }
      : {
          oneLine: parsed.count + " mensagens organizadas",
          chips: [
            { label: "Mensagens", value: String(parsed.count) },
            { label: "Contato", value: parsed.themName },
          ],
          summary:
            "A linha do tempo foi montada a partir do texto. A análise por IA não está disponível neste ambiente (sem chave da OpenAI configurada).",
          frictions: ["Análise por IA indisponível"],
          rec: 'Configure OPENAI_API_KEY e use "Gerar outras" para tentar novamente.',
          source: "Modo demo.",
        };
    const ini =
      (parsed.themName || "IM")
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0] || "")
        .join("")
        .toUpperCase()
        .slice(0, 2) || "IM";
    const newId = "imp-" + Date.now();
    const conv: Conversation = {
      id: newId,
      name: parsed.themName,
      initials: ini,
      color: "#1FA99A",
      property: "Conversa importada",
      price: "WhatsApp",
      statusLabel: "Importada",
      statusTone: "new",
      group: "ativas",
      snippet: "Importada agora",
      time: "agora",
      hasSug: true,
      aiNote: ai ? "análise por IA" : "linha do tempo pronta",
      reply: "Obrigado pelo retorno! Vou avaliar com calma e já te falo. 👍",
      analysis,
      messages: parsed.messages,
      suggestions: sug,
    };
    setConvs((prev) => ({ ...prev, [newId]: conv }));
    setDynamicIds((prev) => [newId, ...prev]);
    void saveConversation(conv);
    setActiveId(newId);
    setScreen("chat");
    setAiBusy(false);
    setPanelOpen(true);
    setAnalysisOpen(true);
    setInput("");
  };

  const send = () => {
    const t = input.trim();
    if (!t) return;
    const id = activeId;
    setConvs((prev) => {
      const c = { ...prev[id] };
      c.messages = [...c.messages, { k: "me", text: t, t: "agora" }];
      return { ...prev, [id]: c };
    });
    setInput("");
    setPanelOpen(false);
    setTyping(true);
    timersRef.current.push(
      setTimeout(() => {
        setConvs((prev) => {
          const c = { ...prev[id] };
          c.messages = [...c.messages, { k: "them", text: c.reply, t: "agora" }];
          c.statusLabel = "Respondeu agora";
          c.statusTone = "hot";
          c.snippet = c.reply;
          c.time = "agora";
          return { ...prev, [id]: c };
        });
        setTyping(false);
      }, 2000),
    );
  };

  // ---- derived ----
  const order = [
    ...dynamicIds.filter((id) => convs[id]),
    ...CONV_ORDER.filter((id) => convs[id]),
  ];
  const allList = order.map((id) => convs[id]).filter(Boolean);
  const counts = {
    todas: allList.length,
    ativas: allList.filter((c) => c.group === "ativas").length,
    frias: allList.filter((c) => c.group === "frias").length,
  };
  const convList =
    filter === "todas" ? allList : allList.filter((c) => c.group === filter);

  const active = convs[activeId] ?? convs[CONV_ORDER[0]];
  const ab = badge(active.statusTone);
  const an = active.analysis;
  const importPct = Math.round((importStep / 5) * 100);
  const canSend = !!input.trim();

  // ---- message renderer ----
  function renderMessage(m: Message, idx: number) {
    if (m.k === "div") {
      return (
        <div key={idx} style={{ textAlign: "center", margin: "6px 0" }}>
          <span
            style={{
              fontSize: "11px",
              color: "#9A9BA3",
              background: "#EAE7DD",
              padding: "3px 12px",
              borderRadius: "999px",
              fontWeight: 600,
            }}
          >
            {m.text}
          </span>
        </div>
      );
    }
    const side = m.from || (m.k === "me" ? "me" : "them");
    const isMe = side === "me";
    const justify = isMe ? "flex-end" : "flex-start";
    const bubbleBg = isMe ? "#D8EEE0" : "#ffffff";
    const bubbleColor = isMe ? "#143B2A" : "#16171C";
    const bubbleBorder = isMe ? "1px solid #BFE3CD" : "1px solid #ECE9DF";
    const metaColor = isMe ? "#6E8C7C" : "#B0B1B8";
    const radius = isMe ? "16px 16px 5px 16px" : "16px 16px 16px 5px";
    const audioAccent = isMe ? "#0F7A4E" : "#1FA99A";
    const propAccent = isMe ? "#0F7A4E" : "#3D7FCC";
    const propBorder = isMe ? "#BFE3CD" : "#E4E1D6";

    if (m.k === "me" || m.k === "them") {
      return (
        <div key={idx} style={{ display: "flex", justifyContent: justify }}>
          <div
            style={{
              maxWidth: "80%",
              borderRadius: radius,
              padding: "9px 13px",
              background: bubbleBg,
              border: bubbleBorder,
            }}
          >
            <div
              style={{
                fontSize: "14px",
                lineHeight: 1.45,
                color: bubbleColor,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.text}
            </div>
            <div
              style={{
                fontSize: "10px",
                textAlign: "right",
                marginTop: "3px",
                color: metaColor,
              }}
            >
              {m.t}
            </div>
          </div>
        </div>
      );
    }

    if (m.k === "audio") {
      return (
        <div key={idx} style={{ display: "flex", justifyContent: justify }}>
          <div
            style={{
              maxWidth: "82%",
              borderRadius: radius,
              padding: "11px 13px",
              background: bubbleBg,
              border: bubbleBorder,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
              <div
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  background: audioAccent,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  flexShrink: 0,
                }}
              >
                ▶
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                  height: "22px",
                  flex: 1,
                }}
              >
                {WAVE.map((bh, i) => (
                  <span
                    key={i}
                    style={{
                      width: "2.5px",
                      borderRadius: "2px",
                      background: audioAccent,
                      opacity: 0.55,
                      height: `${bh}px`,
                    }}
                  />
                ))}
              </div>
              <span
                style={{ fontSize: "11px", color: metaColor, flexShrink: 0 }}
              >
                {m.dur}
              </span>
            </div>
            {m.transcript ? (
              <>
                <div
                  style={{
                    marginTop: "9px",
                    fontSize: "13.5px",
                    lineHeight: 1.5,
                    color: bubbleColor,
                    fontStyle: "italic",
                  }}
                >
                  “{m.transcript}”
                </div>
                <div
                  style={{
                    marginTop: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      color: audioAccent,
                    }}
                  >
                    🎙️ TRANSCRITO POR IA
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: "10px", color: metaColor }}>
                    {m.t}
                  </span>
                </div>
              </>
            ) : (
              <div
                style={{
                  marginTop: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: metaColor,
                    fontStyle: "italic",
                  }}
                >
                  Áudio — anexe o .opus para transcrever
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: "10px", color: metaColor }}>{m.t}</span>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (m.k === "proposal") {
      return (
        <div key={idx} style={{ display: "flex", justifyContent: justify }}>
          <div
            style={{
              maxWidth: "84%",
              width: "270px",
              background: "#fff",
              border: `1px solid ${propBorder}`,
              borderRadius: "16px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(22,23,28,0.05)",
            }}
          >
            <div
              style={{
                padding: "11px 14px 10px",
                borderBottom: "1px dashed #ECE9DF",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: propAccent,
                  }}
                >
                  {m.propTitle}
                </div>
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "21px",
                    color: "#16171C",
                    marginTop: "3px",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {m.propTotal}
                </div>
              </div>
              {m.best && (
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    background: "#128A5B",
                    color: "#fff",
                    padding: "3px 7px",
                    borderRadius: "6px",
                    whiteSpace: "nowrap",
                  }}
                >
                  MELHOR CENÁRIO
                </span>
              )}
            </div>
            <div
              style={{
                padding: "9px 14px 11px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {(m.propRows || []).map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ fontSize: "12.5px", color: "#7C7E88" }}>
                    {r.l}
                  </span>
                  <span
                    style={{ fontSize: "13px", fontWeight: 700, color: "#16171C" }}
                  >
                    {r.v}
                  </span>
                </div>
              ))}
            </div>
            {m.propNote && (
              <div
                style={{
                  padding: "9px 14px",
                  background: "#FBFAF5",
                  borderTop: "1px solid #F0EDE3",
                  fontSize: "12.5px",
                  color: "#5B5D67",
                }}
              >
                {m.propNote}
              </div>
            )}
            <div
              style={{
                padding: "5px 14px 9px",
                fontSize: "10px",
                textAlign: "right",
                color: "#B0B1B8",
              }}
            >
              {m.t}
            </div>
          </div>
        </div>
      );
    }

    if (m.k === "doc") {
      return (
        <div key={idx} style={{ display: "flex", justifyContent: justify }}>
          <div
            style={{
              maxWidth: "80%",
              background: bubbleBg,
              border: bubbleBorder,
              borderRadius: radius,
              padding: "11px 13px",
              display: "flex",
              alignItems: "center",
              gap: "11px",
            }}
          >
            <div
              style={{
                width: "36px",
                height: "42px",
                borderRadius: "7px",
                background: "#E9534233",
                border: "1px solid #E1543A55",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "16px",
                flexShrink: 0,
              }}
            >
              📄
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: bubbleColor,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.docName}
              </div>
              <div
                style={{ fontSize: "11px", color: metaColor, marginTop: "2px" }}
              >
                {m.docMeta} · {m.t}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (m.k === "image") {
      return (
        <div key={idx} style={{ display: "flex", justifyContent: justify }}>
          <div
            style={{
              maxWidth: "72%",
              background: bubbleBg,
              border: bubbleBorder,
              borderRadius: radius,
              padding: "5px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.src}
              alt="anexo"
              style={{
                width: "100%",
                borderRadius: "11px",
                display: "block",
                maxHeight: "200px",
                objectFit: "cover",
                objectPosition: "top",
              }}
            />
            <div
              style={{
                fontSize: "11.5px",
                color: bubbleColor,
                padding: "7px 6px 4px",
                lineHeight: 1.35,
              }}
            >
              {m.cap}
            </div>
            <div
              style={{
                fontSize: "10px",
                textAlign: "right",
                padding: "0 6px 3px",
                color: metaColor,
              }}
            >
              {m.t}
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div
      translate="no"
      lang="pt-BR"
      style={{
        width: "100%",
        minHeight: "100dvh",
        background: "#0F1117",
        display: "flex",
        justifyContent: "center",
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <div
        className="fechou-shell"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "460px",
          background: "#F2F6F2",
          display: "flex",
          flexDirection: "column",
          color: "#16171C",
          overflow: "hidden",
          boxShadow: "0 0 60px rgba(0,0,0,0.3)",
        }}
      >
        {/* ================= INBOX ================= */}
        {screen === "inbox" && (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              background: "#F2F6F2",
            }}
          >
            <div
              style={{
                background: "#fff",
                padding: "14px 18px 13px",
                borderBottom: "1px solid #EDEAE0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: "7px" }}>
                  <span
                    style={{
                      fontFamily: "'Bricolage Grotesque'",
                      fontWeight: 800,
                      fontSize: "23px",
                      letterSpacing: "-0.02em",
                      color: "#16171C",
                    }}
                  >
                    Fechou
                  </span>
                  <span
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      background: "#3FBE86",
                      display: "inline-block",
                      transform: "translateY(-3px)",
                    }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {supaOn && !userEmail && (
                    <button
                      onClick={() => router.push("/login")}
                      style={{
                        border: "1px solid #E7E4DA",
                        background: "#fff",
                        color: "#16171C",
                        fontWeight: 700,
                        fontSize: "12.5px",
                        padding: "7px 12px",
                        borderRadius: "10px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Entrar
                    </button>
                  )}
                  <div
                    onClick={handleAvatar}
                    title={userEmail || undefined}
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "12px",
                      background: "#16171C",
                      color: "#3FBE86",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "'Bricolage Grotesque'",
                      fontWeight: 700,
                      fontSize: "15px",
                      cursor: supaOn ? "pointer" : "default",
                    }}
                  >
                    {(userEmail
                      ? userEmail[0]
                      : myName.trim()[0] || "S"
                    ).toUpperCase()}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: "13px" }}>
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "21px",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Boa tarde, {myName.trim() || "corretor"}
                </div>
                <div
                  style={{ fontSize: "13px", color: "#8A8C96", marginTop: "1px" }}
                >
                  Construtora Senger · {counts.ativas} negociações ativas
                </div>
              </div>
            </div>

            <div
              onClick={openImport}
              style={{
                margin: "13px 14px 2px",
                cursor: "pointer",
                background: "#16171C",
                borderRadius: "18px",
                padding: "15px",
                display: "flex",
                alignItems: "center",
                gap: "13px",
                boxShadow: "0 10px 26px rgba(22,23,28,0.20)",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: "#128A5B",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: "20px",
                  color: "#fff",
                }}
              >
                ↥
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: "14.5px" }}>
                  Importar conversa do WhatsApp
                </div>
                <div
                  style={{ color: "#9DA2B3", fontSize: "12.5px", marginTop: "1px" }}
                >
                  Transcreve áudios e analisa tudo pra você
                </div>
              </div>
              <span style={{ color: "#3FBE86", fontSize: "20px" }}>→</span>
            </div>

            <div
              className="fechou-scroll"
              style={{
                display: "flex",
                gap: "8px",
                padding: "13px 14px 10px",
                overflowX: "auto",
              }}
            >
              {(
                [
                  ["todas", "Todas"],
                  ["ativas", "Ativas"],
                  ["frias", "Esfriaram"],
                ] as const
              ).map(([id, label]) => {
                const activeChip = filter === id;
                return (
                  <button
                    key={id}
                    onClick={() => setFilter(id)}
                    style={{
                      flex: "none",
                      border: activeChip
                        ? "1px solid #16171C"
                        : "1px solid #E7E4DA",
                      background: activeChip ? "#16171C" : "#fff",
                      color: activeChip ? "#fff" : "#5B5D67",
                      padding: "8px 13px",
                      borderRadius: "999px",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      whiteSpace: "nowrap",
                      fontFamily: "inherit",
                    }}
                  >
                    <span>{label}</span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: activeChip ? "#3FBE86" : "#A9AAB2",
                      }}
                    >
                      {counts[id]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              className="fechou-scroll"
              style={{ flex: 1, overflowY: "auto", padding: "2px 0 18px" }}
            >
              {convList.map((c) => {
                const b = badge(c.statusTone);
                return (
                  <div
                    key={c.id}
                    onClick={() => openChat(c.id)}
                    style={{
                      display: "flex",
                      gap: "13px",
                      alignItems: "center",
                      padding: "13px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid #EDEAE0",
                    }}
                  >
                    <div
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "15px",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "'Bricolage Grotesque'",
                        fontWeight: 700,
                        fontSize: "16px",
                        flexShrink: 0,
                        background: c.color,
                      }}
                    >
                      {c.initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: "15px",
                            color: "#16171C",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {c.name}
                        </span>
                        <span
                          style={{
                            fontSize: "12px",
                            color: "#A9AAB2",
                            flexShrink: 0,
                          }}
                        >
                          {c.time}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "#7C7E88",
                          marginTop: "2px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {c.snippet}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginTop: "7px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "3px 9px",
                            borderRadius: "999px",
                            background: b.bg,
                            color: b.color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.statusLabel}
                        </span>
                        {c.hasSug && (
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "#0F7A4E",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            ✨ {c.aiNote}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= IMPORTING ================= */}
        {screen === "importing" && (
          <div
            className="fechou-scroll"
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              background: "#16171C",
              padding: "22px 20px 20px",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: "7px" }}>
              <span
                style={{
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 800,
                  fontSize: "22px",
                  color: "#fff",
                  letterSpacing: "-0.02em",
                }}
              >
                Fechou
              </span>
              <span
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: "#3FBE86",
                  display: "inline-block",
                  transform: "translateY(-3px)",
                }}
              />
            </div>

            {!aiBusy && (
              <>
                <div
                  style={{
                    marginTop: "20px",
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "22px",
                    color: "#fff",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Importar conversa
                </div>
                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "13px",
                    color: "#9DA2B3",
                    lineHeight: 1.5,
                  }}
                >
                  Cole o texto exportado do WhatsApp. A IA lê tudo, monta a linha
                  do tempo e analisa a negociação.
                </div>

                <div
                  style={{
                    marginTop: "18px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    color: "#7E8290",
                    textTransform: "uppercase",
                  }}
                >
                  Seu nome na conversa
                </div>
                <input
                  value={myName}
                  onChange={(e) => setMyName(e.target.value)}
                  placeholder="Ex.: Sanchai"
                  style={{
                    marginTop: "6px",
                    width: "100%",
                    background: "#21232C",
                    border: "1px solid #2E3039",
                    borderRadius: "11px",
                    padding: "11px 13px",
                    color: "#fff",
                    fontSize: "14px",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />

                <div
                  style={{
                    marginTop: "16px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    color: "#7E8290",
                    textTransform: "uppercase",
                  }}
                >
                  Arquivos da conversa (.txt + áudios)
                </div>
                <label
                  style={{
                    marginTop: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    cursor: "pointer",
                    background: "#21232C",
                    border: "1px dashed #3A3D48",
                    borderRadius: "13px",
                    padding: "13px",
                  }}
                >
                  <input
                    type="file"
                    multiple
                    accept=".txt,.opus,.ogg,.m4a,.mp3,.wav,.jpg,.jpeg,.png,.pdf,audio/*,image/*"
                    onChange={(e) => onPickFiles(e.target.files)}
                    style={{ display: "none" }}
                  />
                  <span
                    style={{
                      width: "34px",
                      height: "34px",
                      borderRadius: "10px",
                      background: "#128A5B",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "17px",
                      flexShrink: 0,
                    }}
                  >
                    📎
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        color: "#E8E9EE",
                        fontSize: "13.5px",
                        fontWeight: 600,
                      }}
                    >
                      Selecionar arquivos exportados
                    </span>
                    <span
                      style={{
                        display: "block",
                        color: "#7E8290",
                        fontSize: "11.5px",
                        marginTop: "1px",
                      }}
                    >
                      {mediaCount
                        ? `${mediaCount} mídia(s) anexada(s) · áudios serão transcritos`
                        : "o .txt preenche abaixo; os áudios (.opus) viram transcrição"}
                    </span>
                  </span>
                </label>

                <div
                  style={{
                    marginTop: "14px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    color: "#7E8290",
                    textTransform: "uppercase",
                  }}
                >
                  …ou cole o texto aqui
                </div>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  style={{
                    marginTop: "6px",
                    width: "100%",
                    height: "180px",
                    resize: "none",
                    background: "#21232C",
                    border: "1px solid #2E3039",
                    borderRadius: "13px",
                    padding: "12px 13px",
                    color: "#D6D8E0",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    fontFamily: "'Hanken Grotesk', monospace",
                    outline: "none",
                  }}
                />

                <div
                  style={{
                    marginTop: "10px",
                    fontSize: "11px",
                    color: "#6F7280",
                    lineHeight: 1.5,
                  }}
                >
                  🎙️ Anexe os áudios <b style={{ color: "#9DA2B3" }}>.opus</b>{" "}
                  junto e eles são transcritos automaticamente (Whisper/OpenAI).
                  Se colar só o texto, os áudios ficam como{" "}
                  <b style={{ color: "#9DA2B3" }}>[áudio]</b>.
                </div>

                {aiError && (
                  <div
                    style={{
                      marginTop: "12px",
                      background: "rgba(232,84,47,0.14)",
                      border: "1px solid rgba(232,84,47,0.3)",
                      borderRadius: "11px",
                      padding: "10px 12px",
                      fontSize: "12.5px",
                      color: "#F0B5A6",
                    }}
                  >
                    {aiError}
                  </div>
                )}

                <button
                  onClick={analyze}
                  style={{
                    marginTop: "16px",
                    width: "100%",
                    border: "none",
                    cursor: "pointer",
                    background: "#128A5B",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: "14px",
                    fontFamily: "inherit",
                    padding: "13px 0",
                    borderRadius: "13px",
                  }}
                >
                  ✨ Analisar com IA
                </button>
                <button
                  onClick={skipImport}
                  style={{
                    marginTop: "10px",
                    width: "100%",
                    border: "1px solid #2E3039",
                    background: "transparent",
                    color: "#9DA2B3",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                    padding: "11px 0",
                    borderRadius: "11px",
                  }}
                >
                  Ver exemplo pronto (Gabro 604)
                </button>
              </>
            )}

            {aiBusy && (
              <>
                <div
                  style={{
                    marginTop: "20px",
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "22px",
                    color: "#fff",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Analisando conversa…
                </div>
                <div
                  style={{
                    marginTop: "14px",
                    background: "#21232C",
                    border: "1px solid #2E3039",
                    borderRadius: "13px",
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "11px",
                  }}
                >
                  <span style={{ fontSize: "20px" }}>💬</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ color: "#E8E9EE", fontSize: "13px", fontWeight: 600 }}
                    >
                      {parsedCount} mensagens lidas
                    </div>
                    <div style={{ color: "#7E8290", fontSize: "11.5px" }}>
                      organizando e interpretando o histórico
                    </div>
                  </div>
                </div>
                {transcribeMsg && (
                  <div
                    style={{
                      marginTop: "10px",
                      display: "flex",
                      alignItems: "center",
                      gap: "9px",
                      color: "#3FBE86",
                      fontSize: "12.5px",
                      fontWeight: 600,
                    }}
                  >
                    <span
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "50%",
                        border: "2px solid #2E3039",
                        borderTopColor: "#3FBE86",
                        animation: "fechouSpin .7s linear infinite",
                        flexShrink: 0,
                      }}
                    />
                    {transcribeMsg}
                  </div>
                )}
                <div
                  style={{
                    marginTop: "22px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    flex: 1,
                  }}
                >
                  {[
                    {
                      label: "Lendo o arquivo .txt",
                      detail: parsedCount ? parsedCount + " mensagens" : "mensagens",
                    },
                    {
                      label: "Identificando remetentes",
                      detail: "quem é você e o contato",
                    },
                    {
                      label: "Organizando a linha do tempo",
                      detail: "por data e remetente",
                    },
                    {
                      label: "Analisando com a IA",
                      detail: "propostas, objeções e sentimento",
                    },
                    {
                      label: "Gerando sugestões",
                      detail: "respostas no seu tom",
                    },
                  ].map((st, i) => {
                    const isDone = importStep > i;
                    const isActive = importStep === i;
                    return (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "13px",
                        }}
                      >
                        {isDone ? (
                          <div
                            style={{
                              width: "26px",
                              height: "26px",
                              borderRadius: "50%",
                              background: "#128A5B",
                              color: "#fff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "15px",
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            ✓
                          </div>
                        ) : isActive ? (
                          <div
                            style={{
                              width: "26px",
                              height: "26px",
                              borderRadius: "50%",
                              border: "2.5px solid #2E3039",
                              borderTopColor: "#3FBE86",
                              animation: "fechouSpin .7s linear infinite",
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "26px",
                              height: "26px",
                              borderRadius: "50%",
                              border: "2px solid #2A2C34",
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: "14px",
                              fontWeight: 600,
                              color: isDone
                                ? "#E8E9EE"
                                : isActive
                                  ? "#fff"
                                  : "#5E6170",
                            }}
                          >
                            {st.label}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#6F7280",
                              marginTop: "1px",
                            }}
                          >
                            {st.detail}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: "8px" }}>
                  <div
                    style={{
                      height: "6px",
                      borderRadius: "3px",
                      background: "#2A2C34",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        background: "#2EB37A",
                        transition: "width .4s ease",
                        width: `${importPct}%`,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: "11.5px",
                      color: "#6F7280",
                      marginTop: "12px",
                    }}
                  >
                    Analisado com a sua conta · nada sai sem você enviar
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ================= CHAT ================= */}
        {screen === "chat" && (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              background: "#F2F6F2",
            }}
          >
            <div
              style={{
                background: "#fff",
                borderBottom: "1px solid #EDEAE0",
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                gap: "11px",
              }}
            >
              <button
                onClick={back}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "26px",
                  color: "#16171C",
                  padding: "0 4px 3px 0",
                  lineHeight: 1,
                  fontFamily: "inherit",
                }}
              >
                ‹
              </button>
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "13px",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 700,
                  fontSize: "15px",
                  flexShrink: 0,
                  background: active.color,
                }}
              >
                {active.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "15px",
                    color: "#16171C",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {active.name}
                </div>
                <div
                  style={{
                    fontSize: "11.5px",
                    color: "#8A8C96",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {active.property} · {active.price}
                </div>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "4px 10px",
                  borderRadius: "999px",
                  flexShrink: 0,
                  background: ab.bg,
                  color: ab.color,
                }}
              >
                {active.statusLabel}
              </span>
            </div>

            {/* análise */}
            {analysisOpen ? (
              <div style={{ background: "#16171C", padding: "13px 15px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "14px" }}>✨</span>
                  <span
                    style={{
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "13.5px",
                      fontFamily: "'Bricolage Grotesque'",
                    }}
                  >
                    Análise da negociação
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={() => setAnalysisOpen(false)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#7E8290",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 600,
                      fontFamily: "inherit",
                    }}
                  >
                    ocultar ↑
                  </button>
                </div>
                <div
                  className="fechou-scroll"
                  style={{
                    display: "flex",
                    gap: "8px",
                    overflowX: "auto",
                    marginTop: "11px",
                  }}
                >
                  {an.chips.map((ch, i) => (
                    <div
                      key={i}
                      style={{
                        flex: "none",
                        background: "#21232C",
                        border: "1px solid #2E3039",
                        borderRadius: "11px",
                        padding: "8px 11px",
                        minWidth: "118px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          letterSpacing: "0.05em",
                          color: "#7E8290",
                          textTransform: "uppercase",
                        }}
                      >
                        {ch.label}
                      </div>
                      <div
                        style={{
                          fontSize: "12.5px",
                          fontWeight: 600,
                          color: "#E8E9EE",
                          marginTop: "3px",
                        }}
                      >
                        {ch.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    lineHeight: 1.55,
                    color: "#B8BAC4",
                    marginTop: "12px",
                  }}
                >
                  {an.summary}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    marginTop: "10px",
                  }}
                >
                  {an.frictions.map((fr, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#E8B4A0",
                        background: "rgba(232,84,47,0.14)",
                        padding: "3px 9px",
                        borderRadius: "999px",
                      }}
                    >
                      ⚠ {fr}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: "12px",
                    background: "rgba(47,179,122,0.13)",
                    border: "1px solid rgba(47,179,122,0.32)",
                    borderRadius: "11px",
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      color: "#3FBE86",
                      textTransform: "uppercase",
                    }}
                  >
                    Recomendação
                  </div>
                  <div
                    style={{
                      fontSize: "12.5px",
                      lineHeight: 1.5,
                      color: "#E8E9EE",
                      marginTop: "3px",
                    }}
                  >
                    {an.rec}
                  </div>
                </div>
                <div
                  style={{ fontSize: "10.5px", color: "#5E6170", marginTop: "10px" }}
                >
                  🎙️ {an.source}
                </div>
              </div>
            ) : (
              <div
                onClick={() => setAnalysisOpen(true)}
                style={{
                  background: "#16171C",
                  cursor: "pointer",
                  padding: "10px 15px",
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                }}
              >
                <span style={{ fontSize: "13px" }}>✨</span>
                <span
                  style={{
                    color: "#D6D8E0",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Análise: {an.oneLine}
                </span>
                <span
                  style={{
                    color: "#3FBE86",
                    fontSize: "12px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  ver ↓
                </span>
              </div>
            )}

            {/* timeline */}
            <div
              className="fechou-scroll"
              ref={msgRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 14px 10px",
                display: "flex",
                flexDirection: "column",
                gap: "9px",
              }}
            >
              {active.messages.map((m, i) => renderMessage(m, i))}
              {typing && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #ECE9DF",
                      borderRadius: "16px",
                      padding: "12px 15px",
                      display: "flex",
                      gap: "4px",
                      alignItems: "center",
                    }}
                  >
                    {[0, 0.15, 0.3].map((d, i) => (
                      <span
                        key={i}
                        style={{
                          width: "7px",
                          height: "7px",
                          borderRadius: "50%",
                          background: "#84B89B",
                          animation: `fechouDot 1s infinite ${d}s`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* painel de sugestões */}
            {panelOpen ? (
              <div
                style={{
                  background: "#16171C",
                  padding: "13px 0 11px",
                  boxShadow: "0 -10px 30px rgba(0,0,0,0.18)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "0 16px 11px",
                  }}
                >
                  <span style={{ fontSize: "15px" }}>✨</span>
                  <span
                    style={{
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "14px",
                      fontFamily: "'Bricolage Grotesque'",
                    }}
                  >
                    Sugestões da IA
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={() => setPanelOpen(false)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#7E8290",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 600,
                      fontFamily: "inherit",
                    }}
                  >
                    ocultar ↓
                  </button>
                </div>
                <div
                  style={{
                    margin: "0 16px 12px",
                    background: "#23252E",
                    borderRadius: "12px",
                    padding: "3px",
                    display: "flex",
                    gap: "2px",
                  }}
                >
                  {(
                    [
                      ["amigavel", "Amigável"],
                      ["direto", "Direto"],
                      ["formal", "Formal"],
                    ] as const
                  ).map(([id, label]) => {
                    const a = tone === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setTone(id)}
                        style={{
                          flex: 1,
                          border: "none",
                          cursor: "pointer",
                          padding: "7px 4px",
                          borderRadius: "9px",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          fontFamily: "inherit",
                          transition: "all .15s",
                          background: a ? "#128A5B" : "transparent",
                          color: a ? "#fff" : "#9A9BA3",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {regenerating ? (
                  <div
                    className="fechou-scroll"
                    style={{
                      display: "flex",
                      gap: "11px",
                      overflowX: "auto",
                      padding: "0 16px 12px",
                    }}
                  >
                    {[1, 2, 3].map((k) => (
                      <div
                        key={k}
                        style={{
                          flex: "none",
                          width: "255px",
                          height: "170px",
                          borderRadius: "18px",
                          backgroundImage:
                            "linear-gradient(100deg,#20222A 30%,#2E313D 50%,#20222A 70%)",
                          backgroundSize: "320px 100%",
                          animation: "fechouShimmer 1s infinite linear",
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className="fechou-scroll"
                    style={{
                      display: "flex",
                      gap: "11px",
                      overflowX: "auto",
                      padding: "0 16px 12px",
                      scrollSnapType: "x mandatory",
                    }}
                  >
                    {active.suggestions.map((sg, i) => (
                      <div
                        key={i}
                        style={{
                          flex: "none",
                          width: "258px",
                          background: "#21232C",
                          border: "1px solid #2E3039",
                          borderRadius: "18px",
                          padding: "14px",
                          display: "flex",
                          flexDirection: "column",
                          scrollSnapAlign: "start",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            marginBottom: "9px",
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: sg.accent,
                            }}
                          />
                          <span
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 700,
                              letterSpacing: "0.08em",
                              color: sg.accent,
                            }}
                          >
                            {sg.cat}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "13.5px",
                            lineHeight: 1.5,
                            color: "#E8E9EE",
                            flex: 1,
                          }}
                        >
                          {sg.t[tone]}
                        </div>
                        <button
                          onClick={() => setInput(sg.t[tone])}
                          style={{
                            marginTop: "13px",
                            border: "none",
                            cursor: "pointer",
                            background: "#128A5B",
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: "13px",
                            fontFamily: "inherit",
                            padding: "9px 0",
                            borderRadius: "11px",
                            width: "100%",
                          }}
                        >
                          Usar resposta
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: "10px", padding: "0 16px" }}>
                  <button
                    onClick={refresh}
                    style={{
                      flex: 1,
                      border: "1px solid #34363F",
                      background: "transparent",
                      color: "#C9CBD3",
                      cursor: "pointer",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      fontFamily: "inherit",
                      padding: "9px 0",
                      borderRadius: "10px",
                    }}
                  >
                    ↻ Gerar outras
                  </button>
                  <button
                    onClick={() => setShowTemplates(true)}
                    style={{
                      flex: 1,
                      border: "1px solid #34363F",
                      background: "transparent",
                      color: "#C9CBD3",
                      cursor: "pointer",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      fontFamily: "inherit",
                      padding: "9px 0",
                      borderRadius: "10px",
                    }}
                  >
                    📋 Modelos
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setPanelOpen(true)}
                style={{
                  background: "#16171C",
                  cursor: "pointer",
                  padding: "13px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <span style={{ fontSize: "16px" }}>✨</span>
                <span
                  style={{ color: "#fff", fontWeight: 600, fontSize: "13.5px", flex: 1 }}
                >
                  3 sugestões da IA prontas
                </span>
                <span style={{ color: "#3FBE86", fontSize: "13px", fontWeight: 700 }}>
                  ver ↑
                </span>
              </div>
            )}

            {/* input */}
            <div
              style={{
                background: "#fff",
                borderTop: "1px solid #EDEAE0",
                padding: "9px 12px",
                display: "flex",
                alignItems: "flex-end",
                gap: "9px",
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Escreva ou escolha uma sugestão acima…"
                style={{
                  flex: 1,
                  resize: "none",
                  border: "1px solid #E2DFD4",
                  background: "#EEF3EF",
                  borderRadius: "18px",
                  padding: "11px 14px",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  color: "#16171C",
                  maxHeight: "90px",
                  lineHeight: 1.4,
                  outline: "none",
                }}
              />
              <button
                onClick={send}
                style={{
                  width: "46px",
                  height: "46px",
                  borderRadius: "14px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "background .15s",
                  background: canSend ? "#128A5B" : "#E7E4DA",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3.5 12L20 4L13 20L11 13L3.5 12Z"
                    fill={canSend ? "#fff" : "#A9AAB2"}
                    stroke={canSend ? "#fff" : "#A9AAB2"}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ================= TEMPLATES (bottom sheet) ================= */}
        {showTemplates && (
          <div
            onClick={() => setShowTemplates(false)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(16,17,23,0.45)",
              zIndex: 40,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                borderRadius: "24px 24px 0 0",
                maxHeight: "78%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ padding: "14px 18px 6px" }}>
                <div
                  style={{
                    width: "38px",
                    height: "4px",
                    borderRadius: "2px",
                    background: "#E2DFD4",
                    margin: "0 auto 12px",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Bricolage Grotesque'",
                      fontWeight: 700,
                      fontSize: "18px",
                    }}
                  >
                    Modelos rápidos
                  </span>
                  <button
                    onClick={() => setShowTemplates(false)}
                    style={{
                      border: "none",
                      background: "#F1EFE7",
                      cursor: "pointer",
                      width: "30px",
                      height: "30px",
                      borderRadius: "9px",
                      fontSize: "14px",
                      color: "#7C7E88",
                      fontFamily: "inherit",
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ fontSize: "12.5px", color: "#8A8C96", marginTop: "2px" }}>
                  Toque para inserir no campo de mensagem
                </div>
              </div>
              <div
                className="fechou-scroll"
                style={{
                  overflowY: "auto",
                  padding: "8px 14px 22px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "9px",
                }}
              >
                {TEMPLATES.map((tp, i) => (
                  <div
                    key={i}
                    onClick={() => useTemplate(tp.text)}
                    style={{
                      cursor: "pointer",
                      border: "1px solid #EAE7DD",
                      borderRadius: "15px",
                      padding: "12px 14px",
                      background: "#FCFBF7",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: tp.accent,
                        }}
                      />
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          letterSpacing: "0.07em",
                          color: "#6B6D77",
                        }}
                      >
                        {tp.cat}
                      </span>
                    </div>
                    <div style={{ fontSize: "13.5px", lineHeight: 1.5, color: "#3A3C44" }}>
                      {tp.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
