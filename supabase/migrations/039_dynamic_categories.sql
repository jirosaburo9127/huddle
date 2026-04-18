-- カテゴリをハードコードから動的管理に移行
-- ワークスペースごとにカテゴリを追加・削除できるようにする

-- ==========================================
-- 1. カテゴリマスタテーブル
-- ==========================================
create table if not exists public.workspace_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique(workspace_id, slug)
);

create index if not exists idx_workspace_categories_ws
  on public.workspace_categories (workspace_id, sort_order);

-- ==========================================
-- 2. RLS
-- ==========================================
alter table public.workspace_categories enable row level security;

-- SELECT: ワークスペースメンバーのみ
create policy "workspace_categories_select" on public.workspace_categories
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_categories.workspace_id
        and wm.user_id = auth.uid()
    )
  );

-- INSERT: ワークスペースメンバーのみ
create policy "workspace_categories_insert" on public.workspace_categories
  for insert with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_categories.workspace_id
        and wm.user_id = auth.uid()
    )
  );

-- UPDATE: ワークスペースメンバーのみ
create policy "workspace_categories_update" on public.workspace_categories
  for update using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_categories.workspace_id
        and wm.user_id = auth.uid()
    )
  );

-- DELETE: ワークスペースメンバーのみ
create policy "workspace_categories_delete" on public.workspace_categories
  for delete using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_categories.workspace_id
        and wm.user_id = auth.uid()
    )
  );

-- ==========================================
-- 3. channels.category の CHECK 制約を削除
-- ==========================================
alter table public.channels drop constraint if exists channels_category_check;

-- ==========================================
-- 4. 既存5カテゴリを全ワークスペースに初期挿入
-- ==========================================
insert into public.workspace_categories (workspace_id, slug, label, sort_order)
select w.id, v.slug, v.label, v.sort_order
from public.workspaces w
cross join (values
  ('idea',        'アイデアメモ',    1),
  ('todo',        '未着手',         2),
  ('in_progress', '進行中',         3),
  ('review',      'メンバー確認願',  4),
  ('archived',    '完了',           5)
) as v(slug, label, sort_order)
on conflict (workspace_id, slug) do nothing;

-- ==========================================
-- 5. update_channel_category RPC を動的検証に変更
-- ==========================================
create or replace function public.update_channel_category(
  p_channel_id uuid,
  p_category text
) returns public.channels
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_channel public.channels;
  v_workspace_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- チャンネルのワークスペースIDを取得
  select workspace_id into v_workspace_id
    from public.channels where id = p_channel_id;

  -- カテゴリ値の検証 (NULL はカテゴリ解除として許可)
  if p_category is not null then
    if not exists (
      select 1 from public.workspace_categories
      where workspace_id = v_workspace_id and slug = p_category
    ) then
      raise exception 'invalid category: %', p_category;
    end if;
  end if;

  -- 呼び出し元がチャンネルメンバーであることを確認
  if not exists (
    select 1 from public.channel_members
    where channel_id = p_channel_id and user_id = v_user_id
  ) then
    raise exception 'forbidden: not a channel member';
  end if;

  update public.channels
    set category = p_category
    where id = p_channel_id
    returning * into v_channel;

  return v_channel;
end;
$$;

-- ==========================================
-- 6. カテゴリ追加 RPC
-- ==========================================
create or replace function public.add_workspace_category(
  p_workspace_id uuid,
  p_label text
) returns public.workspace_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_slug text;
  v_max_order int;
  v_result public.workspace_categories;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ワークスペースメンバーか確認
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_user_id
  ) then
    raise exception 'forbidden';
  end if;

  -- slug自動生成: ラベルをローマ字変換は難しいのでタイムスタンプベース
  v_slug := 'cat-' || extract(epoch from now())::bigint::text;

  -- 現在の最大sort_order
  select coalesce(max(sort_order), 0) into v_max_order
    from public.workspace_categories
    where workspace_id = p_workspace_id;

  insert into public.workspace_categories (workspace_id, slug, label, sort_order)
    values (p_workspace_id, v_slug, btrim(p_label), v_max_order + 1)
    returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.add_workspace_category(uuid, text) to authenticated;

-- ==========================================
-- 7. カテゴリ削除 RPC (該当チャンネルは未分類に戻す)
-- ==========================================
create or replace function public.delete_workspace_category(
  p_workspace_id uuid,
  p_slug text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_user_id
  ) then
    raise exception 'forbidden';
  end if;

  -- 該当カテゴリのチャンネルを未分類に戻す
  update public.channels
    set category = null
    where workspace_id = p_workspace_id and category = p_slug;

  -- カテゴリ削除
  delete from public.workspace_categories
    where workspace_id = p_workspace_id and slug = p_slug;
end;
$$;

grant execute on function public.delete_workspace_category(uuid, text) to authenticated;
