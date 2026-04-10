import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { DashboardView } from "./dashboard-view";

type Decision = {
  id: string;
  content: string;
  created_at: string;
  channel_id: string;
  channel_name: string;
  channel_slug: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
};

type ShareToken = {
  id: string;
  token: string;
  label: string;
  expires_at: string;
  is_active: boolean;
  created_at: string;
  last_accessed_at: string | null;
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // ワークスペース確認 + メンバーシップチェック
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (!workspace) redirect("/");

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) redirect("/");

  const isAdmin =
    membership.role === "owner" || membership.role === "admin";

  // 決定事項を全チャンネル横断で取得
  const { data: decisionsRaw } = await supabase
    .from("messages")
    .select(
      "id, content, created_at, channel_id, user_id, channels!inner(name, slug, workspace_id, is_dm), profiles!inner(id, display_name, avatar_url)"
    )
    .eq("is_decision", true)
    .is("deleted_at", null)
    .eq("channels.workspace_id", workspace.id)
    .eq("channels.is_dm", false)
    .order("created_at", { ascending: false })
    .limit(100);

  const decisions: Decision[] = (decisionsRaw || []).map(
    (row: {
      id: string;
      content: string;
      created_at: string;
      channel_id: string;
      user_id: string;
      channels: unknown;
      profiles: unknown;
    }) => {
      const ch = Array.isArray(row.channels)
        ? row.channels[0]
        : (row.channels as { name: string; slug: string });
      const p = Array.isArray(row.profiles)
        ? row.profiles[0]
        : (row.profiles as {
            id: string;
            display_name: string;
            avatar_url: string | null;
          });
      return {
        id: row.id,
        content: row.content,
        created_at: row.created_at,
        channel_id: row.channel_id,
        channel_name: ch?.name || "",
        channel_slug: ch?.slug || "",
        sender_id: row.user_id,
        sender_name: p?.display_name || "メンバー",
        sender_avatar: p?.avatar_url || null,
      };
    }
  );

  // 集計値
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const stats = {
    decisions_total: decisions.length,
    decisions_this_week: decisions.filter(
      (d) => new Date(d.created_at).getTime() >= weekAgo
    ).length,
  };

  // 共有トークン一覧（管理者のみ）
  let shareTokens: ShareToken[] = [];
  if (isAdmin) {
    const { data: tokensRaw } = await supabase
      .from("share_tokens")
      .select("id, token, label, expires_at, is_active, created_at, last_accessed_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });
    shareTokens = tokensRaw || [];
  }

  return (
    <DashboardView
      workspace={workspace}
      workspaceSlug={workspaceSlug}
      decisions={decisions}
      stats={stats}
      shareTokens={shareTokens}
      isAdmin={isAdmin}
    />
  );
}
