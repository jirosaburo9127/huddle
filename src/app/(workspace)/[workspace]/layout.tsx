import { createClient } from "@/lib/supabase/server";
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
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // ワークスペース取得
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .single();

  if (!workspace) redirect("/");

  // チャンネル一覧取得
  const { data: channels } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("is_dm", false)
    .order("created_at", { ascending: true });

  // DM一覧取得
  const { data: dmChannels } = await supabase
    .from("channels")
    .select("*, channel_members(user_id, profiles(display_name, avatar_url, status, last_seen_at))")
    .eq("workspace_id", workspace.id)
    .eq("is_dm", true);

  // ワークスペースメンバー取得
  const { data: membersRaw } = await supabase
    .from("workspace_members")
    .select("user_id, profiles(id, display_name, avatar_url, status)")
    .eq("workspace_id", workspace.id);

  // Supabaseのjoin型をSidebarのProps型に合わせてキャスト
  const members = (membersRaw || []) as unknown as Array<{
    user_id: string;
    profiles: {
      id: string;
      display_name: string;
      avatar_url: string | null;
      status: string | null;
    };
  }>;

  // 各チャンネルの未読メッセージ数を取得
  const { data: memberships } = await supabase
    .from("channel_members")
    .select("channel_id, last_read_at")
    .eq("user_id", user.id);

  const unreadCounts: Record<string, number> = {};
  if (memberships) {
    const results = await Promise.all(
      memberships.map(async (m) => {
        if (!m.last_read_at) return { channel_id: m.channel_id, count: 0 };
        const { count } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("channel_id", m.channel_id)
          .gt("created_at", m.last_read_at)
          .is("parent_id", null)
          .is("deleted_at", null);
        return { channel_id: m.channel_id, count: count || 0 };
      })
    );
    for (const r of results) {
      if (r.count > 0) unreadCounts[r.channel_id] = r.count;
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
      />
      <KeyboardShortcuts workspaceId={workspace.id} workspaceSlug={workspaceSlug}>
        <main className="flex-1 flex flex-col min-w-0">
          {children}
        </main>
      </KeyboardShortcuts>
    </div>
  );
}
