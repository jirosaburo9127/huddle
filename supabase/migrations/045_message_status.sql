-- メッセージにステータス（進行中）を追加
-- 決定事項(is_decision)と併存する独立した機能

alter table public.messages
  add column if not exists status text
  check (status is null or status in ('in_progress', 'done'));

-- ステータストグル RPC（チャンネルメンバーなら誰でも操作可能）
create or replace function public.toggle_message_status(
  p_message_id uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_current text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not authenticated'; end if;

  if p_status is not null and p_status not in ('in_progress', 'done') then
    raise exception 'invalid status: %', p_status;
  end if;

  select status into v_current from public.messages where id = p_message_id;

  -- 同じステータスならnullに戻す（トグル）
  if v_current = p_status then
    update public.messages set status = null where id = p_message_id;
  else
    update public.messages set status = p_status where id = p_message_id;
  end if;
end;
$$;

grant execute on function public.toggle_message_status(uuid, text) to authenticated;
