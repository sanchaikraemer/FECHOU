"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const DARK = "#16171C";
const FIELD = "#21232C";
const BORDER = "#2E3039";

export default function LoginPage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async () => {
    setError("");
    setInfo("");
    if (!email || !password) {
      setError("Preencha e-mail e senha.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push("/");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo(
          "Conta criada! Se a confirmação por e-mail estiver ativa, confirme pelo link. Caso contrário, já pode entrar.",
        );
        setMode("in");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível autenticar.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#0F1117",
        display: "flex",
        justifyContent: "center",
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          background: DARK,
          padding: "26px 22px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "7px" }}>
          <span
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: "26px",
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            Fechou
          </span>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#3FBE86",
              display: "inline-block",
              transform: "translateY(-4px)",
            }}
          />
        </div>

        {!configured ? (
          <div style={{ marginTop: "26px" }}>
            <div
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "20px",
                color: "#fff",
              }}
            >
              Login indisponível
            </div>
            <div
              style={{
                marginTop: "8px",
                fontSize: "13.5px",
                color: "#9DA2B3",
                lineHeight: 1.5,
              }}
            >
              O Supabase ainda não está configurado neste ambiente. Defina{" "}
              <b style={{ color: "#C9CBD3" }}>NEXT_PUBLIC_SUPABASE_URL</b> e{" "}
              <b style={{ color: "#C9CBD3" }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</b>{" "}
              (veja o README). Enquanto isso, o app funciona sem login.
            </div>
            <a
              href="/"
              style={{
                marginTop: "20px",
                display: "inline-block",
                background: "#128A5B",
                color: "#fff",
                fontWeight: 700,
                fontSize: "14px",
                padding: "12px 20px",
                borderRadius: "12px",
                textDecoration: "none",
              }}
            >
              ← Voltar ao app
            </a>
          </div>
        ) : (
          <>
            <div
              style={{
                marginTop: "26px",
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "22px",
                color: "#fff",
              }}
            >
              {mode === "in" ? "Entrar" : "Criar conta"}
            </div>
            <div
              style={{
                marginTop: "6px",
                fontSize: "13px",
                color: "#9DA2B3",
                lineHeight: 1.5,
              }}
            >
              Suas conversas ficam salvas na sua conta.
            </div>

            <div
              style={{
                marginTop: "20px",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "#7E8290",
                textTransform: "uppercase",
              }}
            >
              E-mail
            </div>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
              style={inputStyle}
            />

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
              Senha
            </div>
            <input
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="••••••••"
              style={inputStyle}
            />

            {error && (
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
                {error}
              </div>
            )}
            {info && (
              <div
                style={{
                  marginTop: "12px",
                  background: "rgba(47,179,122,0.13)",
                  border: "1px solid rgba(47,179,122,0.32)",
                  borderRadius: "11px",
                  padding: "10px 12px",
                  fontSize: "12.5px",
                  color: "#9BE8C2",
                }}
              >
                {info}
              </div>
            )}

            <button
              onClick={submit}
              disabled={busy}
              style={{
                marginTop: "18px",
                width: "100%",
                border: "none",
                cursor: busy ? "default" : "pointer",
                background: busy ? "#0E5E3F" : "#128A5B",
                color: "#fff",
                fontWeight: 700,
                fontSize: "14px",
                fontFamily: "inherit",
                padding: "13px 0",
                borderRadius: "13px",
              }}
            >
              {busy
                ? "Aguarde…"
                : mode === "in"
                  ? "Entrar"
                  : "Criar conta"}
            </button>

            <button
              onClick={() => {
                setMode(mode === "in" ? "up" : "in");
                setError("");
                setInfo("");
              }}
              style={{
                marginTop: "12px",
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
              {mode === "in"
                ? "Não tem conta? Criar uma"
                : "Já tem conta? Entrar"}
            </button>

            <a
              href="/"
              style={{
                marginTop: "16px",
                textAlign: "center",
                color: "#7E8290",
                fontSize: "13px",
                textDecoration: "none",
              }}
            >
              Continuar sem login →
            </a>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  marginTop: "6px",
  width: "100%",
  background: FIELD,
  border: `1px solid ${BORDER}`,
  borderRadius: "11px",
  padding: "12px 13px",
  color: "#fff",
  fontSize: "14px",
  fontFamily: "inherit",
  outline: "none",
};
