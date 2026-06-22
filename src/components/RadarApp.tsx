"use client";

import { useEffect, useRef, useState } from "react";
import { unzipSync } from "fflate";
import { callAnalyze, transcribeAudio } from "@/lib/ai";
import {
  extractWhatsAppParticipants,
  parseWhatsApp,
  sameParticipant,
} from "@/lib/parseWhatsApp";
import type { RadarResult } from "@/lib/types";

const C = {
  bg: "#0C1D24",
  card: "#132A33",
  coral: "#FF6B5C",
  coralDim: "rgba(255,107,92,0.12)",
  coralBorder: "rgba(255,107,92,0.25)",
  text: "#E6EEF0",
  muted: "#8FA9B0",
  border: "#21424E",
};
const SORA = "'Sora', system-ui, sans-serif";
const INTER = "'Inter', system-ui, sans-serif";

type Screen = "home" | "identify" | "processing" | "result";

const AUDIO_EXT_RE = /\.(opus|ogg|m4a|mp3|wav|aac|amr)$/i;
const SUPPORTED_ZIP_FILE_RE = /\.(txt|opus|ogg|m4a|mp3|wav|aac|amr)$/i;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TXT_BYTES = 5 * 1024 * 1024;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function fileKey(name: string): string {
  return String(name || "")
    .split(/[\\/]/)
    .pop()!
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function guessType(name: string): string {
  const value = name.toLowerCase();
  if (value.endsWith(".opus")) return "audio/opus";
  if (value.endsWith(".ogg")) return "audio/ogg";
  if (value.endsWith(".m4a")) return "audio/mp4";
  if (value.endsWith(".mp3")) return "audio/mpeg";
  if (value.endsWith(".wav")) return "audio/wav";
  if (value.endsWith(".aac")) return "audio/aac";
  if (value.endsWith(".amr")) return "audio/amr";
  if (value.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

async function expandFiles(input: File[]): Promise<File[]> {
  const output: File[] = [];

  for (const file of input) {
    const isZip =
      /\.zip$/i.test(file.name) ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";

    if (!isZip) {
      output.push(file);
      continue;
    }

    if (file.size > MAX_ZIP_BYTES) {
      throw new Error("O arquivo ZIP é maior que 100 MB. Exporte a conversa com menos mídias.");
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    let totalExtracted = 0;
    let acceptedEntries = 0;
    let entries: Record<string, Uint8Array>;

    try {
      entries = unzipSync(buffer, {
        filter(info) {
          const base = info.name.split("/").pop() || info.name;
          if (!SUPPORTED_ZIP_FILE_RE.test(base)) return false;
          if (info.originalSize > MAX_ENTRY_BYTES) return false;
          totalExtracted += info.originalSize;
          acceptedEntries += 1;
          if (totalExtracted > MAX_EXTRACTED_BYTES || acceptedEntries > 250) {
            throw new Error("ZIP muito grande ou com arquivos demais.");
          }
          return true;
        },
      });
    } catch (error) {
      if (error instanceof Error && /muito grande|arquivos demais/i.test(error.message)) throw error;
      throw new Error("Não consegui abrir o ZIP. Gere uma nova exportação do WhatsApp.");
    }

    const paths = Object.keys(entries).filter((path) => !path.endsWith("/"));
    const textPaths = paths
      .filter((path) => /\.txt$/i.test(path))
      .sort((a, b) => entries[b].length - entries[a].length);
    const audioPaths = paths.filter((path) => AUDIO_EXT_RE.test(path));

    for (const path of [...textPaths, ...audioPaths]) {
      const base = path.split("/").pop() || path;
      output.push(new File([Uint8Array.from(entries[path])], base, { type: guessType(base) }));
    }
  }

  return output;
}

function priorityColor(priority: number): string {
  if (priority >= 70) return "#4ADE80";
  if (priority >= 40) return "#FBBF24";
  return C.coral;
}

function priorityLabel(priority: number): string {
  if (priority >= 80) return "ALTA";
  if (priority >= 50) return "MÉDIA";
  return "BAIXA";
}

function analysisError(reason?: string): string {
  switch (reason) {
    case "no_key":
      return "A chave OPENAI_API_KEY não está configurada no Vercel.";
    case "rate_limited":
      return "O limite de análises foi atingido. Aguarde um pouco e tente novamente.";
    case "too_large":
    case "invalid_conversation":
      return "A conversa é grande demais ou está em um formato inválido.";
    case "forbidden":
      return "A solicitação foi bloqueada por segurança. Abra o Radar pelo endereço oficial.";
    case "network":
      return "Falha de conexão. Verifique a internet e tente novamente.";
    default:
      return "Não foi possível concluir a análise. Tente novamente em alguns instantes.";
  }
}

function LogoSymbol({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={C.card} />
      <circle cx="10" cy="22" r="2" fill={C.muted} />
      <path d="M10 22 Q16 16 22 14" stroke={C.muted} strokeWidth="2" strokeLinecap="round" opacity=".5" />
      <path d="M10 22 Q18 12 26 9" stroke={C.text} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="26" cy="9" r="3" fill={C.coral} />
    </svg>
  );
}

function LogoRow({ size = 28 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <LogoSymbol size={size + 4} />
      <div>
        <div
          style={{
            fontFamily: SORA,
            fontWeight: 800,
            fontSize: `${size}px`,
            letterSpacing: "-0.03em",
            color: C.text,
            lineHeight: 1,
          }}
        >
          Radar<span style={{ color: C.coral }}>.</span>
        </div>
        <div
          style={{
            fontFamily: INTER,
            fontWeight: 600,
            fontSize: "10px",
            letterSpacing: "0.12em",
            color: C.muted,
            textTransform: "uppercase",
            marginTop: "1px",
          }}
        >
          de vendas
        </div>
      </div>
    </div>
  );
}

export default function RadarApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [myName, setMyName] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [pendingText, setPendingText] = useState("");
  const [step, setStep] = useState(0);
  const [stepDetail, setStepDetail] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [result, setResult] = useState<RadarResult | null>(null);
  const [contactName, setContactName] = useState("");
  const [copied, setCopied] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  const mediaRef = useRef<Map<string, File>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedName = window.localStorage.getItem("radar:myName");
    if (savedName) setMyName(savedName);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
    if (standalone) return;

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
    setIsIOS(ios);
    setShowInstall(true);

    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("caches" in window)) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("shared") !== "1") return;

    void (async () => {
      const files: File[] = [];
      let sharedText = "";
      try {
        const cache = await caches.open("radar-share");
        const indexResponse = await cache.match("/__shared__/index.json");
        if (indexResponse) {
          const index = (await indexResponse.json()) as {
            files?: { key: string; name: string; type?: string }[];
            text?: string;
          };
          sharedText = index.text || "";
          for (const meta of index.files || []) {
            const response = await cache.match(meta.key);
            if (!response) continue;
            const blob = await response.blob();
            files.push(new File([blob], meta.name, { type: meta.type || blob.type }));
          }
        }
        for (const key of await cache.keys()) await cache.delete(key);
      } catch {
        // O fluxo manual continua disponível se o cache de compartilhamento falhar.
      }

      window.history.replaceState({}, "", "/");
      try {
        const text = (await ingestFiles(files)) || sharedText;
        if (text.trim()) await prepareConversation(text);
        else setError("Recebi o compartilhamento, mas não encontrei a conversa exportada.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Não consegui abrir o compartilhamento.");
      }
    })();
    // O processamento deve rodar apenas uma vez na abertura pelo Share Target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setShowInstall(false);
  };

  const saveMyName = (name: string) => {
    const clean = name.trim();
    setMyName(clean);
    if (typeof window !== "undefined") {
      if (clean) window.localStorage.setItem("radar:myName", clean);
      else window.localStorage.removeItem("radar:myName");
    }
  };

  const ingestFiles = async (files: File[]): Promise<string> => {
    const flat = await expandFiles(files);
    const textFiles = flat
      .filter((file) => /\.txt$/i.test(file.name))
      .sort((a, b) => b.size - a.size);

    if (textFiles[0]?.size && textFiles[0].size > MAX_TXT_BYTES) {
      throw new Error("O arquivo de texto é maior que 5 MB. Exporte uma conversa menor.");
    }

    for (const file of flat) {
      if (AUDIO_EXT_RE.test(file.name) || file.type.startsWith("audio/")) {
        mediaRef.current.set(fileKey(file.name), file);
      }
    }

    return textFiles[0] ? await textFiles[0].text() : "";
  };

  const prepareConversation = async (text: string) => {
    setError("");
    setWarning("");
    const foundParticipants = extractWhatsAppParticipants(text);
    if (!foundParticipants.length) {
      setScreen("home");
      setError("Não encontrei mensagens nesse arquivo. Use o .zip ou .txt exportado diretamente pelo WhatsApp.");
      return;
    }

    const matchedName = foundParticipants.find((participant) => sameParticipant(participant, myName));
    if (matchedName) {
      await runAnalysis(text, matchedName);
      return;
    }

    setPendingText(text);
    setParticipants(foundParticipants);
    setScreen("identify");
  };

  const confirmParticipant = async (name: string) => {
    saveMyName(name);
    const text = pendingText;
    setPendingText("");
    await runAnalysis(text, name);
  };

  const runAnalysis = async (text: string, selectedName: string) => {
    setScreen("processing");
    setError("");
    setWarning("");
    setStep(1);
    setStepDetail("");

    const parsed = parseWhatsApp(text, selectedName);
    if (!parsed.count) {
      setScreen("home");
      setError("Não encontrei mensagens válidas nesse arquivo.");
      return;
    }

    setContactName(parsed.themName);
    setStepDetail(`${parsed.count} mensagens`);

    setStep(2);
    const pendingAudios = parsed.messages.filter(
      (message) => message.k === "audio" && message.file && mediaRef.current.has(fileKey(message.file)),
    );
    let processed = 0;
    let failed = 0;
    const batchSize = 3;

    if (!pendingAudios.length) setStepDetail("Nenhum áudio anexado");

    for (let index = 0; index < pendingAudios.length; index += batchSize) {
      const batch = pendingAudios.slice(index, index + batchSize);
      await Promise.all(
        batch.map(async (message) => {
          const file = message.file ? mediaRef.current.get(fileKey(message.file)) : undefined;
          if (file) {
            const transcription = await transcribeAudio(file);
            if (transcription.data?.trim()) message.transcript = transcription.data.trim();
            else {
              message.transcriptionFailed = true;
              failed += 1;
            }
          }
          processed += 1;
          setStepDetail(`Áudio ${processed}/${pendingAudios.length}`);
        }),
      );
    }

    if (failed) {
      setWarning(
        `${failed} áudio${failed > 1 ? "s" : ""} não ${failed > 1 ? "puderam" : "pôde"} ser transcrito. A análise considerou o restante da conversa.`,
      );
    }

    setStep(3);
    setStepDetail("Cruzando histórico, pendências e sinais de compra");
    const analysis = await callAnalyze(parsed.messages, selectedName);

    if (!analysis.data) {
      setScreen("home");
      setError(analysisError(analysis.reason));
      return;
    }

    setResult(analysis.data);
    setStep(4);
    setStepDetail("");
    window.setTimeout(() => setScreen("result"), 350);
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    mediaRef.current = new Map();
    try {
      const text = await ingestFiles(Array.from(files));
      if (!text.trim()) {
        setError("Nenhum .txt foi encontrado. Selecione o ZIP exportado do WhatsApp ou o arquivo de texto da conversa.");
        return;
      }
      await prepareConversation(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não consegui abrir o arquivo.");
    }
  };

  const copyMessage = async () => {
    if (!result?.mensagem) return;
    try {
      await navigator.clipboard.writeText(result.mensagem);
    } catch {
      const area = document.createElement("textarea");
      area.value = result.mensagem;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  const reset = () => {
    setScreen("home");
    setResult(null);
    setError("");
    setWarning("");
    setStep(0);
    setStepDetail("");
    setCopied(false);
    setParticipants([]);
    setPendingText("");
    setContactName("");
    mediaRef.current = new Map();
  };

  const priorityTone = priorityColor(result?.prioridade ?? 0);
  const steps = [
    { label: "Lendo conversa", detail: stepDetail || "mensagens" },
    { label: "Transcrevendo áudios", detail: stepDetail || "arquivos anexados" },
    { label: "Analisando negociação", detail: stepDetail || "histórico comercial" },
    { label: "Resultado pronto", detail: "" },
  ];

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100dvh",
        background: C.bg,
        display: "flex",
        justifyContent: "center",
        fontFamily: INTER,
      }}
    >
      <main
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "480px",
          minHeight: "100dvh",
          background: C.bg,
          display: "flex",
          flexDirection: "column",
          color: C.text,
          overflowX: "hidden",
        }}
      >
        {screen === "home" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingBottom: "32px" }}>
            <div style={{ padding: "52px 24px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <LogoRow size={26} />
                <span style={{ fontSize: "11px", fontWeight: 700, color: C.muted, letterSpacing: "0.06em" }}>v004</span>
              </div>
              <h1
                style={{
                  fontFamily: SORA,
                  fontWeight: 800,
                  fontSize: "28px",
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                  color: C.text,
                  margin: "28px 0 0",
                }}
              >
                Importe uma conversa e descubra o que fazer.
              </h1>
              <p style={{ fontSize: "14px", color: C.muted, margin: "10px 0 0", lineHeight: 1.6 }}>
                O Radar identifica o estágio da negociação, o ponto que travou e a melhor próxima mensagem.
              </p>
            </div>

            <div style={{ margin: "28px 20px 0", background: C.card, border: `1px solid ${C.border}`, borderRadius: "20px", padding: "20px" }}>
              <div style={eyebrowStyle(C.coral)}>COMO COMPARTILHAR</div>
              {[
                "Abra a conversa no WhatsApp",
                "Toque no menu e escolha Exportar conversa",
                "Escolha Compartilhar e selecione Radar",
              ].map((text, index) => (
                <div key={text} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: index < 2 ? "12px" : 0 }}>
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "9px",
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "13px",
                      fontWeight: 800,
                      color: C.coral,
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </div>
                  <span style={{ fontSize: "14px", color: C.text }}>{text}</span>
                </div>
              ))}
            </div>

            <div style={{ margin: "20px 20px 0" }}>
              <label htmlFor="radar-name" style={eyebrowStyle(C.muted)}>
                SEU NOME NA CONVERSA
              </label>
              <input
                id="radar-name"
                value={myName}
                onChange={(event) => setMyName(event.target.value)}
                onBlur={(event) => saveMyName(event.target.value)}
                placeholder="Ex.: Sanchai"
                autoComplete="name"
                style={inputStyle}
              />
              <div style={{ color: C.muted, fontSize: "11px", marginTop: "6px", lineHeight: 1.4 }}>
                Na primeira importação, o Radar confirma quem é você e salva essa escolha neste aparelho.
              </div>
            </div>

            <div style={{ margin: "16px 20px 0" }}>
              <div style={eyebrowStyle(C.muted)}>OU SELECIONE O ARQUIVO</div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  background: C.card,
                  border: `1px dashed ${C.border}`,
                  borderRadius: "14px",
                  padding: "14px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="file"
                  multiple
                  accept=".txt,.zip,.opus,.ogg,.m4a,.mp3,.wav,.aac,.amr,audio/*,application/zip,text/plain"
                  onChange={(event) => void onPickFiles(event.target.files)}
                  style={{ display: "none" }}
                />
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    background: C.coral,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  ↑
                </div>
                <div>
                  <div style={{ color: C.text, fontSize: "14px", fontWeight: 600 }}>Selecionar ZIP ou TXT exportado</div>
                  <div style={{ color: C.muted, fontSize: "12px", marginTop: "2px" }}>Áudios anexados também são transcritos</div>
                </div>
              </label>
            </div>

            {error && <Alert text={error} />}
            <div style={{ flex: 1 }} />

            {showInstall && (
              <div style={{ margin: "20px 20px 0", background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                  <LogoSymbol size={24} />
                  <div style={{ flex: 1, fontSize: "13px", fontWeight: 700, color: C.text }}>Instale o Radar no celular</div>
                  <button type="button" onClick={() => setShowInstall(false)} aria-label="Fechar" style={closeButtonStyle}>×</button>
                </div>
                {isIOS ? (
                  <div style={{ fontSize: "13px", color: C.muted, lineHeight: 1.6 }}>
                    No Safari: Compartilhar → Adicionar à Tela de Início.
                  </div>
                ) : installPrompt ? (
                  <button type="button" onClick={() => void handleInstall()} style={primaryButtonStyle}>Instalar agora</button>
                ) : (
                  <div style={{ fontSize: "13px", color: C.muted, lineHeight: 1.6 }}>
                    No Chrome: menu → Adicionar à tela inicial.
                  </div>
                )}
              </div>
            )}

            <div style={{ padding: "0 20px", marginTop: "24px", fontSize: "11px", color: C.muted, textAlign: "center", lineHeight: 1.5 }}>
              As conversas não são salvas pelo Radar. O conteúdo é enviado à OpenAI somente para transcrição e análise.
            </div>
          </div>
        )}

        {screen === "identify" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "52px 20px 32px" }}>
            <LogoRow size={22} />
            <h1 style={{ fontFamily: SORA, fontSize: "24px", lineHeight: 1.25, margin: "34px 0 8px" }}>
              Quem é você nesta conversa?
            </h1>
            <p style={{ color: C.muted, fontSize: "14px", lineHeight: 1.6, margin: 0 }}>
              Essa confirmação evita que o Radar troque as mensagens do corretor pelas mensagens do cliente.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "24px" }}>
              {participants.slice(0, 12).map((participant) => (
                <button
                  type="button"
                  key={participant}
                  onClick={() => void confirmParticipant(participant)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: "14px",
                    padding: "15px 16px",
                    color: C.text,
                    fontFamily: INTER,
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {participant}
                </button>
              ))}
            </div>

            {participants.length > 2 && (
              <div style={{ color: C.muted, fontSize: "12px", lineHeight: 1.5, marginTop: "14px" }}>
                Foram encontrados vários participantes. O Radar funciona melhor com conversas individuais.
              </div>
            )}

            <div style={{ flex: 1 }} />
            <button type="button" onClick={reset} style={secondaryButtonStyle}>Cancelar e voltar</button>
          </div>
        )}

        {screen === "processing" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "52px 24px 32px" }}>
            <LogoRow size={22} />
            <h1 style={{ fontFamily: SORA, fontWeight: 800, fontSize: "22px", color: C.text, margin: "36px 0 8px" }}>
              Analisando conversa…
            </h1>
            {contactName && <div style={{ fontSize: "13px", color: C.muted, marginBottom: "32px" }}>Cliente: {contactName}</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {steps.map((item, index) => {
                const done = step > index + 1;
                const active = step === index + 1;
                return (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    {done ? (
                      <div style={doneStepStyle}>✓</div>
                    ) : active ? (
                      <div style={activeStepStyle} />
                    ) : (
                      <div style={pendingStepStyle} />
                    )}
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: done ? C.muted : active ? C.text : C.border }}>
                        {item.label}
                      </div>
                      {active && item.detail && <div style={{ fontSize: "12px", color: C.coral, marginTop: "2px", lineHeight: 1.4 }}>{item.detail}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {screen === "result" && result && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", paddingBottom: "40px" }}>
            <div style={{ padding: "52px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <LogoRow size={18} />
              <button type="button" onClick={reset} style={pillButtonStyle}>← Nova conversa</button>
            </div>
            {contactName && <div style={{ padding: "8px 20px 0", fontSize: "13px", color: C.muted }}>{contactName}</div>}
            {warning && <Alert text={warning} muted />}

            <div style={{ margin: "20px 20px 0", background: C.card, border: `1px solid ${C.border}`, borderRadius: "20px", padding: "20px", display: "flex", alignItems: "center", gap: "20px" }}>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{ fontFamily: SORA, fontWeight: 800, fontSize: "52px", lineHeight: 1, color: priorityTone, letterSpacing: "-0.03em" }}>
                  {result.prioridade}
                </div>
                <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>/100 · {priorityLabel(result.prioridade)}</div>
              </div>
              <div style={{ width: "1px", background: C.border, alignSelf: "stretch" }} />
              <div style={{ flex: 1 }}>
                <div style={eyebrowStyle(C.muted)}>VALE RETOMAR?</div>
                <div style={{ fontFamily: SORA, fontWeight: 800, fontSize: "28px", color: result.valeRetomar ? "#4ADE80" : C.coral }}>
                  {result.valeRetomar ? "SIM" : "NÃO"}
                </div>
                {result.motivoPrioridade && <div style={{ fontSize: "12px", color: C.muted, marginTop: "6px", lineHeight: 1.4 }}>{result.motivoPrioridade}</div>}
              </div>
            </div>

            <Section title="Diagnóstico comercial">
              <DiagnosticRow label="Etapa" value={result.etapaNegociacao} />
              <DiagnosticRow label="Interesse" value={result.nivelInteresse} />
              <DiagnosticRow label="Tempo parado" value={result.tempoSemResposta} />
              <DiagnosticRow label="Última pessoa a falar" value={result.ultimaPessoaFalar} />
              <DiagnosticRow label="Produto principal" value={result.produtoPrincipal} />
              {result.produtosParalelos.length > 0 && <DiagnosticRow label="Alternativas citadas" value={result.produtosParalelos.join(", ")} />}
              <DiagnosticRow label="Compromisso do cliente" value={result.ultimoCompromissoCliente} />
              <DiagnosticRow label="Informação prometida" value={result.ultimaInformacaoPrometida} />
              <DiagnosticRow label="Objeção relevante" value={result.objecaoRelevante} />
              <DiagnosticRow label="Pendência financeira" value={result.pendenciaFinanceira} />
              <DiagnosticRow label="Próximo passo é de" value={result.quemDeveProximoPasso} last />
            </Section>

            <Section title="O que aconteceu">
              <p style={paragraphStyle}>{result.oQueAconteceu}</p>
            </Section>

            <Section title="Onde travou">
              <p style={paragraphStyle}>{result.ondeTravou}</p>
            </Section>

            {result.faltouDescobrir.length > 0 && (
              <Section title="O que falta descobrir">
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {result.faltouDescobrir.map((item) => (
                    <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.coral, flexShrink: 0, marginTop: "7px" }} />
                      <span style={{ fontSize: "14px", color: C.muted, lineHeight: 1.5 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div style={{ margin: "12px 20px 0" }}>
              <div style={{ background: C.coralDim, border: `1px solid ${C.coralBorder}`, borderRadius: "16px", padding: "16px" }}>
                <div style={eyebrowStyle(C.coral)}>PRÓXIMA AÇÃO</div>
                <p style={{ ...paragraphStyle, color: C.text, fontWeight: 500 }}>{result.proximaAcao}</p>
              </div>
            </div>

            <div style={{ margin: "12px 20px 0" }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "16px" }}>
                <div style={eyebrowStyle(C.muted)}>MENSAGEM SUGERIDA</div>
                <p style={{ ...paragraphStyle, marginBottom: "14px", whiteSpace: "pre-wrap" }}>{result.mensagem}</p>
                <button type="button" onClick={() => void copyMessage()} style={{ ...primaryButtonStyle, background: copied ? "#D95A4A" : C.coral }}>
                  {copied ? "COPIADO" : "COPIAR MENSAGEM"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function eyebrowStyle(color: string): React.CSSProperties {
  return {
    display: "block",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.07em",
    color,
    textTransform: "uppercase",
    marginBottom: "8px",
  };
}

function Alert({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div
      style={{
        margin: "14px 20px 0",
        background: muted ? "rgba(143,169,176,0.08)" : C.coralDim,
        border: `1px solid ${muted ? C.border : C.coralBorder}`,
        borderRadius: "12px",
        padding: "12px 14px",
        fontSize: "13px",
        color: muted ? C.muted : "#FCA5A5",
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ margin: "12px 20px 0" }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "16px" }}>
        <div style={eyebrowStyle(C.muted)}>{title}</div>
        {children}
      </div>
    </section>
  );
}

function DiagnosticRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ padding: "9px 0", borderBottom: last ? "none" : `1px solid ${C.border}` }}>
      <div style={{ color: C.muted, fontSize: "11px", marginBottom: "3px" }}>{label}</div>
      <div style={{ color: C.text, fontSize: "13px", lineHeight: 1.45, textTransform: label === "Etapa" || label === "Interesse" ? "capitalize" : undefined }}>
        {value || "Não identificado"}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: "12px",
  padding: "11px 14px",
  color: C.text,
  fontSize: "14px",
  fontFamily: INTER,
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  border: "none",
  cursor: "pointer",
  background: C.coral,
  color: "#fff",
  fontWeight: 700,
  fontSize: "14px",
  fontFamily: INTER,
  padding: "13px 0",
  borderRadius: "12px",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: C.card,
  border: `1px solid ${C.border}`,
  color: C.muted,
};

const pillButtonStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  color: C.muted,
  padding: "6px 14px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: INTER,
};

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: C.muted,
  fontSize: "20px",
  cursor: "pointer",
  padding: 0,
  lineHeight: 1,
};

const doneStepStyle: React.CSSProperties = {
  width: "28px",
  height: "28px",
  borderRadius: "50%",
  background: C.coral,
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "14px",
  fontWeight: 700,
  flexShrink: 0,
};

const activeStepStyle: React.CSSProperties = {
  width: "28px",
  height: "28px",
  borderRadius: "50%",
  border: `2.5px solid ${C.border}`,
  borderTopColor: C.coral,
  animation: "radarSpin .7s linear infinite",
  flexShrink: 0,
};

const pendingStepStyle: React.CSSProperties = {
  width: "28px",
  height: "28px",
  borderRadius: "50%",
  border: `2px solid ${C.border}`,
  flexShrink: 0,
};

const paragraphStyle: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.6,
  color: C.muted,
  margin: 0,
};
