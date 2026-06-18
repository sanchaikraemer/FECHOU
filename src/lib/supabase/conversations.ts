import type { Conversation } from "@/lib/types";
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";

/**
 * Persistência das conversas no Supabase (tabela `conversations`).
 * v1: guardamos a conversa inteira como JSONB (`payload`) — simples e suficiente
 * para começar. O esquema normalizado (clients/messages/analyses…) fica para a
 * fase de RAG/histórico.
 * Tudo é guardado por usuário (RLS isola por `user_id`). Sem Supabase
 * configurado ou sem login, as funções viram no-op e o app roda local.
 */

export async function getCurrentEmail(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export async function fetchConversations(): Promise<Conversation[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("conversations")
      .select("payload")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    return data
      .map((r) => (r as { payload: Conversation }).payload)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveConversation(conv: Conversation): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("conversations").upsert({
      // PK composta evita colisão entre usuários (RLS já isola, mas o id do app se repete).
      id: `${user.id}:${conv.id}`,
      user_id: user.id,
      name: conv.name,
      payload: conv,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // best-effort: persistência não pode quebrar a UX.
  }
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await createClient().auth.signOut();
  } catch {
    /* no-op */
  }
}
