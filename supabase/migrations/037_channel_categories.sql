-- チャンネルにカテゴリ分類を追加
-- Chatwork風のタスク管理ステータスでチャンネルをサイドバーにグループ表示する

-- 既存値との衝突を避けるため、まずは nullable + チェック制約で追加
alter table public.channels
  add column if not exists category text
  check (
    category is null
    or category in ('idea','todo','in_progress','review','archived')
  );

comment on column public.channels.category is
  'チャンネルのタスクステータス: idea=アイデアメモ / todo=未着手 / in_progress=進行中 / review=メンバー確認願 / archived=完了';

-- カテゴリで絞り込むクエリに備えて軽量なインデックス
create index if not exists idx_channels_workspace_category
  on public.channels (workspace_id, category);

-- チャンネルのカテゴリを更新する RPC
-- RLS 対応で channels テーブルの update ポリシーを介して書き込みを許可する。
-- 呼び出し元はそのチャンネルのメンバーである必要がある (既存 RLS に準拠)。
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
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- カテゴリ値の検証 (NULL はカテゴリ解除として許可)
  if p_category is not null
     and p_category not in ('idea','todo','in_progress','review','archived') then
    raise exception 'invalid category: %', p_category;
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

grant execute on function public.update_channel_category(uuid, text) to authenticated;
