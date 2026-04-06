import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ChannelView } from "./components/channel-view";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ workspace: string; channel: string }>;
}) {
  const { workspace: workspaceSlug, channel: channelSlug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // ワークスペース取得
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .single();

  if (!workspace) redirect("/");

  // チャンネル取得
  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("slug", channelSlug)
    .single();

  if (!channel) redirect(`/${workspaceSlug}/general`);

  // メッセージ取得とメンバーシップ確認を並列実行
  const [{ data: messages }, { data: membership }] = await Promise.all([
    supabase
      .from("messages")
      .select("*, profiles(*)")
      .eq("channel_id", channel.id)
      .is("parent_id", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channel.id)
      .eq("user_id", user.id)
      .single(),
  ]);

  if (!membership && !channel.is_private) {
    await supabase.from("channel_members").insert({
      channel_id: channel.id,
      user_id: user.id,
    });
  }

  // last_read_at更新（バックグラウンドで実行、待たない）
  supabase
    .from("channel_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("channel_id", channel.id)
    .eq("user_id", user.id)
    .then(() => {});

  return (
    <ChannelView
      channel={channel}
      initialMessages={(messages || []).reverse()}
      currentUserId={user.id}
    />
  );
}
