-- ═══════════════════════════════════════════════
-- Slack風チャットアプリ: 初期スキーマ
-- ═══════════════════════════════════════════════

-- 拡張機能
create extension if not exists "pg_trgm";

-- ═══════════════════════════════════════════════
-- テーブル定義
-- ═══════════════════════════════════════════════

-- プロフィール（auth.usersと連動）
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  status text,
  last_seen_at timestamptz
);

-- ワークスペース
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- ワークスペースメンバー
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- チャンネル
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  is_private boolean not null default false,
  is_dm boolean not null default false,
  topic text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

-- チャンネルメンバー
create table public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted boolean not null default false,
  primary key (channel_id, user_id)
);

-- メッセージ（統一テーブル: チャンネル・DM・スレッド）
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  parent_id uuid references public.messages(id) on delete cascade,
  content text not null,
  content_tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  edited_at timestamptz,
  deleted_at timestamptz,
  reply_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- リアクション
create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

-- メンション
create table public.mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  mention_type text not null default 'user' check (mention_type in ('user', 'channel', 'here'))
);

-- ファイル
create table public.files (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

-- 通知
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  channel_id uuid references public.channels(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════
-- インデックス
-- ═══════════════════════════════════════════════

create index idx_messages_channel_created on public.messages(channel_id, created_at desc);
create index idx_messages_parent on public.messages(parent_id) where parent_id is not null;
create index idx_messages_tsv on public.messages using gin(content_tsv);
create index idx_channel_members_user on public.channel_members(user_id);
create index idx_notifications_user_unread on public.notifications(user_id, is_read) where not is_read;
create index idx_channels_workspace on public.channels(workspace_id);
create index idx_workspace_members_user on public.workspace_members(user_id);

-- ═══════════════════════════════════════════════
-- トリガー: ユーザー登録時にプロフィール自動作成
-- ═══════════════════════════════════════════════

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════
-- トリガー: スレッド返信時にreply_count更新
-- ═══════════════════════════════════════════════

create or replace function public.update_reply_count()
returns trigger as $$
begin
  if new.parent_id is not null then
    update public.messages
    set reply_count = reply_count + 1
    where id = new.parent_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_thread_reply
  after insert on public.messages
  for each row execute function public.update_reply_count();

-- ═══════════════════════════════════════════════
-- RLS（Row Level Security）
-- ═══════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;
alter table public.mentions enable row level security;
alter table public.files enable row level security;
alter table public.notifications enable row level security;

-- プロフィール: 同じワークスペースのメンバーが閲覧可能、自分だけ編集可能
create policy "profiles_select" on public.profiles
  for select using (true);

create policy "profiles_update" on public.profiles
  for update using (auth.uid() = id);

-- ワークスペース: メンバーのみ閲覧
create policy "workspaces_select" on public.workspaces
  for select using (
    exists (
      select 1 from public.workspace_members
      where workspace_id = id and user_id = auth.uid()
    )
  );

create policy "workspaces_insert" on public.workspaces
  for insert with check (true);

-- ワークスペースメンバー: 同ワークスペースのメンバーが閲覧
create policy "workspace_members_select" on public.workspace_members
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_id and wm.user_id = auth.uid()
    )
  );

create policy "workspace_members_insert" on public.workspace_members
  for insert with check (true);

-- チャンネル: ワークスペースメンバーがパブリックチャンネルを閲覧、プライベートはメンバーのみ
create policy "channels_select" on public.channels
  for select using (
    exists (
      select 1 from public.workspace_members
      where workspace_id = channels.workspace_id and user_id = auth.uid()
    )
    and (
      not is_private
      or exists (
        select 1 from public.channel_members
        where channel_id = id and user_id = auth.uid()
      )
    )
  );

create policy "channels_insert" on public.channels
  for insert with check (
    exists (
      select 1 from public.workspace_members
      where workspace_id = channels.workspace_id and user_id = auth.uid()
    )
  );

-- チャンネルメンバー: チャンネルメンバーが閲覧
create policy "channel_members_select" on public.channel_members
  for select using (
    exists (
      select 1 from public.channel_members cm
      where cm.channel_id = channel_id and cm.user_id = auth.uid()
    )
  );

create policy "channel_members_insert" on public.channel_members
  for insert with check (true);

create policy "channel_members_update" on public.channel_members
  for update using (user_id = auth.uid());

-- メッセージ: チャンネルメンバーが閲覧・投稿
create policy "messages_select" on public.messages
  for select using (
    exists (
      select 1 from public.channel_members
      where channel_id = messages.channel_id and user_id = auth.uid()
    )
  );

create policy "messages_insert" on public.messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.channel_members
      where channel_id = messages.channel_id and user_id = auth.uid()
    )
  );

create policy "messages_update" on public.messages
  for update using (auth.uid() = user_id);

create policy "messages_delete" on public.messages
  for delete using (auth.uid() = user_id);

-- リアクション
create policy "reactions_select" on public.reactions
  for select using (
    exists (
      select 1 from public.messages m
      join public.channel_members cm on cm.channel_id = m.channel_id
      where m.id = message_id and cm.user_id = auth.uid()
    )
  );

create policy "reactions_insert" on public.reactions
  for insert with check (auth.uid() = user_id);

create policy "reactions_delete" on public.reactions
  for delete using (auth.uid() = user_id);

-- メンション: メッセージが見えるなら見える
create policy "mentions_select" on public.mentions
  for select using (
    exists (
      select 1 from public.messages m
      join public.channel_members cm on cm.channel_id = m.channel_id
      where m.id = message_id and cm.user_id = auth.uid()
    )
  );

create policy "mentions_insert" on public.mentions
  for insert with check (true);

-- ファイル
create policy "files_select" on public.files
  for select using (
    exists (
      select 1 from public.messages m
      join public.channel_members cm on cm.channel_id = m.channel_id
      where m.id = message_id and cm.user_id = auth.uid()
    )
  );

create policy "files_insert" on public.files
  for insert with check (auth.uid() = user_id);

-- 通知: 自分の通知のみ
create policy "notifications_select" on public.notifications
  for select using (auth.uid() = user_id);

create policy "notifications_update" on public.notifications
  for update using (auth.uid() = user_id);

create policy "notifications_insert" on public.notifications
  for insert with check (true);

-- ═══════════════════════════════════════════════
-- Realtime有効化
-- ═══════════════════════════════════════════════

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.channel_members;
alter publication supabase_realtime add table public.notifications;
