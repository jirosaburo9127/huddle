import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;
  const supabase = await createClient();
  const user = await getAuthUser();

  if (!user) redirect("/login");

  // ワークスペース取得
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .single();

  if (!workspace) redirect("/");

  // チャンネル・DM・メンバー・未読数・全WS所属を並列取得
  const [
    { data: channels },
    { data: dmChannels },
    { data: membersRaw },
    { data: unreadData },
    { data: allWorkspacesRaw },
  ] = await Promise.all([
    supabase
      .from("channels")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("is_dm", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("channels")
      .select("*, channel_members(user_id, profiles(display_name, avatar_url, status, last_seen_at))")
      .eq("workspace_id", workspace.id)
      .eq("is_dm", true),
    supabase
      .from("workspace_members")
      .select("user_id, profiles(id, display_name, avatar_url, status)")
      .eq("workspace_id", workspace.id),
    supabase.rpc("get_unread_counts", { p_user_id: user.id }),
    supabase
      .from("workspace_members")
      .select("workspace_id, workspaces(id, name, slug)")
      .eq("user_id", user.id),
  ]);

  // 全ワークスペース一覧を整形
  const allWorkspaces = (allWorkspacesRaw || [])
    .map((row) => {
      const ws = row.workspaces as unknown as { id: string; name: string; slug: string } | null;
      return ws ? { id: ws.id, name: ws.name, slug: ws.slug } : null;
    })
    .filter((ws): ws is { id: string; name: string; slug: string } => ws !== null);

  const members = (membersRaw || []) as unknown as Array<{
    user_id: string;
    profiles: {
      id: string;
      display_name: string;
      avatar_url: string | null;
      status: string | null;
    };
  }>;

  // 未読数をRecord形式に変換
  const unreadCounts: Record<string, number> = {};
  if (unreadData) {
    for (const row of unreadData as Array<{ channel_id: string; unread_count: number }>) {
      unreadCounts[row.channel_id] = row.unread_count;
    }
  }

  return (
    <div className="flex h-full">
      <Sidebar
        workspace={workspace}
        channels={channels || []}
        dmChannels={dmChannels || []}
        members={members || []}
        currentUserId={user.id}
        workspaceSlug={workspaceSlug}
        unreadCounts={unreadCounts}
        allWorkspaces={allWorkspaces}
      />
      <KeyboardShortcuts workspaceId={workspace.id} workspaceSlug={workspaceSlug}>
        <main className="flex-1 flex flex-col min-w-0">
          {children}
        </main>
      </KeyboardShortcuts>
    </div>
  );
}
