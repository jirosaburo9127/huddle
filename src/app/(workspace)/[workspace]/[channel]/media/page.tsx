import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { ChannelMediaView } from "./channel-media-view";

// チャンネル内のメディア（画像・動画）一覧ページ。
// チャンネルヘッダーの「メディア」アイコンから遷移する。
export default async function ChannelMediaPage({
  params,
}: {
  params: Promise<{ workspace: string; channel: string }>;
}) {
  const { workspace: workspaceSlug, channel: channelSlug } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // チャンネル ID + 名前を取得（権限はチャンネルメンバーであることが前提、RLS でブロックされる）
  const { data: ch } = await supabase
    .from("channels")
    .select("id, name, slug, workspace_id, workspaces(slug)")
    .eq("slug", channelSlug)
    .maybeSingle();

  if (!ch) redirect(`/${workspaceSlug}`);

  const wsSlug = Array.isArray(ch.workspaces)
    ? ch.workspaces[0]?.slug
    : (ch.workspaces as { slug: string } | null)?.slug;
  if (wsSlug !== workspaceSlug) redirect(`/${workspaceSlug}`);

  // メディア取得
  const { data: rows } = await supabase.rpc("get_channel_media", {
    p_channel_id: ch.id,
    p_limit: 200,
  });

  return (
    <ChannelMediaView
      workspaceSlug={workspaceSlug}
      channelSlug={channelSlug}
      channelName={ch.name}
      rawRows={(rows as Array<{
        message_id: string;
        content: string;
        created_at: string;
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
      }>) || []}
    />
  );
}
