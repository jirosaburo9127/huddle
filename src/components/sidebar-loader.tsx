import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";

type WorkspaceShellProps = {
  workspaceSlug: string;
  children: React.ReactNode;
};

/**
 * ワークスペースのデータを非同期で取得し、サイドバー + メインコンテンツを描画するサーバーコンポーネント。
 * Suspense境界の内側に配置することで、データ取得中にフォールバックUIを表示し、
 * 準備ができ次第ストリーミングで描画する。
 */
export async function WorkspaceShell({ workspaceSlug, children }: WorkspaceShellProps) {
  const supabase = await createClient();
  const user = await getAuthUser();

  if (!user) redirect("/login");

  // RPC1回で全データ取得（5クエリ→1クエリに集約）
  const { data, error } = await supabase.rpc("get_workspace_data", {
    p_workspace_slug: workspaceSlug,
    p_user_id: user.id,
  });

  if (error || !data) redirect("/");

  const result = data as {
    workspace: { id: string; name: string; slug: string; created_at: string };
    channels: Array<{
      id: string;
      workspace_id: string;
      name: string;
      slug: string;
      is_private: boolean;
      is_dm: boolean;
      topic: string | null;
      created_by: string;
      created_at: string;
    }>;
    dm_channels: Array<{
      id: string;
      workspace_id: string;
      name: string;
      slug: string;
      is_private: boolean;
      is_dm: boolean;
      topic: string | null;
      created_by: string;
      created_at: string;
      channel_members: Array<{
        user_id: string;
        profiles: {
          display_name: string;
          avatar_url: string | null;
          status: string | null;
          last_seen_at: string | null;
        };
      }> | null;
    }>;
    members: Array<{
      user_id: string;
      profiles: {
        id: string;
        display_name: string;
        avatar_url: string | null;
        status: string | null;
      };
    }>;
    unread_counts: Array<{ channel_id: string; unread_count: number }>;
    all_workspaces: Array<{ id: string; name: string; slug: string }>;
  };

  if (!result.workspace) redirect("/");

  // 未読数をRecord形式に変換
  const unreadCounts: Record<string, number> = {};
  for (const row of result.unread_counts || []) {
    unreadCounts[row.channel_id] = row.unread_count;
  }

  return (
    <>
      <Sidebar
        workspace={result.workspace}
        channels={result.channels || []}
        dmChannels={result.dm_channels || []}
        members={result.members || []}
        currentUserId={user.id}
        workspaceSlug={workspaceSlug}
        unreadCounts={unreadCounts}
        allWorkspaces={result.all_workspaces || []}
      />
      <KeyboardShortcuts workspaceId={result.workspace.id} workspaceSlug={workspaceSlug}>
        <main className="flex-1 flex flex-col min-w-0">
          {children}
        </main>
      </KeyboardShortcuts>
    </>
  );
}
