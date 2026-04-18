-- チャンネルごとのミュート機能を再追加
-- ミュート中はバナー通知を抑制しバッジのみにする

-- channel_members に muted カラムを追加
alter table public.channel_members
  add column if not exists muted boolean not null default false;

-- ミュートトグル用 RPC
create or replace function public.toggle_channel_mute(
  p_channel_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_new_muted boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  update public.channel_members
    set muted = not muted
    where channel_id = p_channel_id and user_id = v_user_id
    returning muted into v_new_muted;

  return v_new_muted;
end;
$$;

grant execute on function public.toggle_channel_mute(uuid) to authenticated;
