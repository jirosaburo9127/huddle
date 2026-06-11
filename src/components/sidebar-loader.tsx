import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import { MainPane } from "@/components/main-pane";
import { MobileDetailTransition } from "@/components/mobile-detail-transition";

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
      is_hitorigoto: boolean;
      topic: string | null;
      category: string | null;
      icon_url: string | null;
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
      is_hitorigoto: boolean;
      topic: string | null;
      category: string | null;
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
    hitorigoto_channel: { id: string; slug: string; name: string } | null;
  };

  if (!result.workspace) redirect("/");

  // 未読数をRecord形式に変換
  const unreadCounts: Record<string, number> = {};
  for (const row of result.unread_counts || []) {
    unreadCounts[row.channel_id] = row.unread_count;
  }

  // ワークスペースのカテゴリ一覧を取得
  const { data: categoriesData } = await supabase
    .from("workspace_categories")
    .select("slug, label, sort_order, color")
    .eq("workspace_id", result.workspace.id)
    .order("sort_order", { ascending: true });
  const categories = (categoriesData || []) as Array<{ slug: string; label: string; sort_order: number; color: string | null }>;

  // is_master 判定 (/master リンクの表示制御に使う)
  const { data: ownProfile } = await supabase
    .from("profiles")
    .select("is_master")
    .eq("id", user.id)
    .maybeSingle();
  const isMaster = !!ownProfile?.is_master;

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
        categories={categories}
        hitorigotoChannel={result.hitorigoto_channel ?? null}
        isMaster={isMaster}
      />
      <KeyboardShortcuts workspaceId={result.workspace.id} workspaceSlug={workspaceSlug}>
        <MainPane>{children}</MainPane>
      </KeyboardShortcuts>
      <MobileDetailTransition />
      <BottomTabBar
        workspaceSlug={workspaceSlug}
        workspaceId={result.workspace.id}
        currentUserId={user.id}
        members={result.members || []}
        channels={result.channels || []}
        hitorigotoChannel={result.hitorigoto_channel ?? null}
      />
    </>
  );
}
