import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { ChannelView } from "./components/channel-view";
import type { Channel, MessageWithProfile } from "@/lib/supabase/types";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ workspace: string; channel: string }>;
}) {
  const { workspace: workspaceSlug, channel: channelSlug } = await params;
  const supabase = await createClient();
  const user = await getAuthUser();

  if (!user) redirect("/login");

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
    />
  );
}
