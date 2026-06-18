-- Fechou — esquema inicial (v1)
-- Conversas persistidas como JSONB por usuário, com RLS isolando por dono.
-- Rode no SQL Editor do Supabase (ou via `supabase db push`).

create table if not exists public.conversations (
  id          text primary key,                 -- "<user_id>:<id-da-conversa-no-app>"
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text,
  payload     jsonb not null,                    -- a Conversation inteira (timeline, análise, sugestões)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists conversations_user_id_idx
  on public.conversations (user_id, updated_at desc);

alter table public.conversations enable row level security;

-- Cada usuário só enxerga/edita as próprias conversas.
drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = user_id);

drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "conversations_delete_own" on public.conversations;
create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = user_id);
