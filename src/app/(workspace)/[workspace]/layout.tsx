import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

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
    .select("*, channel_members(user_id, profiles(display_name, avatar_url, status))")
    .eq("workspace_id", workspace.id)
    .eq("is_dm", true);

  // ワークスペースメンバー取得
  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id, profiles(id, display_name, avatar_url, status)")
    .eq("workspace_id", workspace.id);

  return (
    <div className="flex h-full">
      <Sidebar
        workspace={workspace}
        channels={channels || []}
        dmChannels={dmChannels || []}
        members={members || []}
        currentUserId={user.id}
        workspaceSlug={workspaceSlug}
      />
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
