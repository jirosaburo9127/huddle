-- アクティビティの種類別 (reactions / mentions / replies) 未読有無を 1RPC で返す
-- モーダルを開いた時に「どのタブに新着があるか」をドット表示するために使う

CREATE OR REPLACE FUNCTION public.get_activity_unread_breakdown(
  p_user_id UUID,
  p_workspace_id UUID
)
RETURNS TABLE(
  has_reactions BOOLEAN,
  has_mentions BOOLEAN,
  has_replies BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.reactions r
      JOIN public.messages m ON m.id = r.message_id
      JOIN public.channels c ON c.id = m.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE m.user_id = p_user_id
        AND r.user_id <> p_user_id
        AND m.deleted_at IS NULL
        AND c.workspace_id = p_workspace_id
        AND r.created_at > COALESCE(p.activity_seen_at, '1970-01-01'::timestamptz)
    ) AS has_reactions,
    EXISTS (
      SELECT 1
      FROM public.mentions mn
      JOIN public.messages m ON m.id = mn.message_id
      JOIN public.channels c ON c.id = m.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE mn.mentioned_user_id = p_user_id
        AND m.user_id <> p_user_id
        AND m.deleted_at IS NULL
        AND c.workspace_id = p_workspace_id
        AND m.created_at > COALESCE(p.mention_seen_at, '1970-01-01'::timestamptz)
    ) AS has_mentions,
    EXISTS (
      SELECT 1
      FROM public.messages r
      JOIN public.messages parent ON parent.id = r.parent_id
      JOIN public.channels c ON c.id = r.channel_id
      JOIN public.profiles p ON p.id = p_user_id
      WHERE parent.user_id = p_user_id
        AND r.user_id <> p_user_id
        AND r.deleted_at IS NULL
        AND parent.deleted_at IS NULL
        AND c.workspace_id = p_workspace_id
        AND r.created_at > COALESCE(p.reply_seen_at, '1970-01-01'::timestamptz)
    ) AS has_replies;
$$;

GRANT EXECUTE ON FUNCTION public.get_activity_unread_breakdown(UUID, UUID) TO authenticated;
