import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { ChannelView } from "./components/channel-view";
import type { Channel, MessageWithProfile } from "@/lib/supabase/types";

// チャンネル切替を高速化するため Next.js の Router Cache を活用する。
// initialMessages が古くなるケースは ChannelView 側の syncMissedMessages (マウント時/復帰時/15秒ポーリング)
// が最新 50 件をマージして即座に補正するため問題ない。

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ workspace: string; channel: string }>;
}) {
  const { workspace: workspaceSlug, channel: channelSlug } = await params;
  const supabase = await createClient();
  const user = await getAuthUser();

  if (!user) redirect("/login");

  // 未読区切り線のために RPC が last_read_at を NOW に更新する前の値を先取りしておく。
  // （RPC 更新後だと「未読」が常に空になり、区切り線が出ない＋自動スクロールが効かない）
  const { data: preMembership } = await supabase
    .from("channel_members")
    .select("last_read_at, channels!inner(slug, workspaces!inner(slug))")
    .eq("user_id", user.id)
    .eq("channels.slug", channelSlug)
    .eq("channels.workspaces.slug", workspaceSlug)
    .maybeSingle();
  const previousLastReadAt = (preMembership as { last_read_at: string | null } | null)?.last_read_at ?? null;

  // RPC1回でチャンネル取得+メッセージ取得+メンバーシップ確認+last_read_at更新を実行
  const { data, error } = await supabase.rpc("get_channel_with_messages", {
    p_workspace_slug: workspaceSlug,
    p_channel_slug: channelSlug,
    p_user_id: user.id,
  });

  if (error || !data) redirect(`/`);

  const result = data as { channel: Channel; messages: MessageWithProfile[] };

  if (!result.channel) redirect(`/${workspaceSlug}/general`);

  return (
    <ChannelView
      key={result.channel.id}
      channel={result.channel}
      initialMessages={result.messages || []}
      currentUserId={user.id}
      initialLastReadAt={previousLastReadAt}
    />
  );
}
