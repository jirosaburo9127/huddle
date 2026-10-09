import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { HomeView, type HomeChannel, type HomeMessage } from "./home-view";

// 未読の状況は開くたびに最新を出したいので静的キャッシュを無効化
export const dynamic = "force-dynamic";

// 1チャンネルあたりに取得する未読メッセージの上限（表示は HomeView 側で3件に絞る）。
// 毎回ゼロから取り直して描画するだけで、クライアント state に蓄積マージはしない。
const UNREAD_FETCH_LIMIT = 50;

type ChannelRow = {
  id: string;
  name: string;
  slug: string;
  is_dm: boolean;
  is_hitorigoto: boolean;
  is_archived: boolean;
  icon_url: string | null;
  workspace_id: string;
};

type ProfileRow = { display_name: string; avatar_url: string | null };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (!workspace) redirect("/");

  const [membershipsRes, unreadRes, profileRes] = await Promise.all([
    supabase
      .from("channel_members")
      .select(
        "channel_id, last_read_at, joined_at, channels!inner(id, name, slug, is_dm, is_hitorigoto, is_archived, icon_url, workspace_id)"
      )
      .eq("user_id", user.id)
      .eq("channels.workspace_id", workspace.id),
    supabase.rpc("get_unread_counts", { p_user_id: user.id }),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);

  if (membershipsRes.error) {
    throw new Error(`ホームの読み込みに失敗しました: ${membershipsRes.error.message}`);
  }
  if (unreadRes.error) {
    throw new Error(`未読数の取得に失敗しました: ${unreadRes.error.message}`);
  }

  const unreadMap = new Map<string, number>();
  for (const row of (unreadRes.data || []) as Array<{ channel_id: string; unread_count: number }>) {
    unreadMap.set(row.channel_id, Number(row.unread_count));
  }

  const memberships = ((membershipsRes.data || []) as Array<{
    channel_id: string;
    last_read_at: string | null;
    joined_at: string;
    channels: ChannelRow | ChannelRow[];
  }>)
    .map((m) => ({ ...m, channel: one(m.channels) }))
    .filter(
      (m): m is typeof m & { channel: ChannelRow } =>
        !!m.channel && !m.channel.is_hitorigoto && !m.channel.is_archived
    );

  // DM は相手の名前をチャンネル名として出す
  const dmIds = memberships.filter((m) => m.channel.is_dm).map((m) => m.channel_id);
  const dmNames = new Map<string, ProfileRow>();
  if (dmIds.length > 0) {
    const { data: dmMembers } = await supabase
      .from("channel_members")
      .select("channel_id, user_id, profiles(display_name, avatar_url)")
      .in("channel_id", dmIds)
      .neq("user_id", user.id);
    for (const row of (dmMembers || []) as Array<{
      channel_id: string;
      profiles: ProfileRow | ProfileRow[] | null;
    }>) {
      const p = one(row.profiles);
      if (p && !dmNames.has(row.channel_id)) dmNames.set(row.channel_id, p);
    }
  }

  // 未読のあるチャンネルだけ、最終既読より後のメッセージを取得（get_unread_counts と同じ条件）
  const channels: HomeChannel[] = await Promise.all(
    memberships.map(async (m) => {
      const unreadCount = unreadMap.get(m.channel_id) || 0;
      const dm = dmNames.get(m.channel_id);
      const base: HomeChannel = {
        id: m.channel.id,
        name: m.channel.is_dm ? dm?.display_name || "DM" : m.channel.name,
        slug: m.channel.slug,
        isDm: m.channel.is_dm,
        iconUrl: m.channel.is_dm ? dm?.avatar_url || null : m.channel.icon_url,
        unreadCount,
        hasMention: false,
        latestAt: null,
        messages: [],
      };
      if (unreadCount === 0) return base;

      const since = m.last_read_at || m.joined_at;
      const { data: rows, error } = await supabase
        .from("messages")
        .select("id, content, created_at, user_id, profiles(display_name, avatar_url)")
        .eq("channel_id", m.channel_id)
        .gt("created_at", since)
        .is("deleted_at", null)
        .is("system_event", null)
        .neq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(UNREAD_FETCH_LIMIT);
      if (error || !rows || rows.length === 0) return base;

      const typed = rows as Array<{
        id: string;
        content: string;
        created_at: string;
        user_id: string;
        profiles: ProfileRow | ProfileRow[] | null;
      }>;

      // @自分 / @channel / @here の付いたメッセージを判定
      const { data: mentionRows } = await supabase
        .from("mentions")
        .select("message_id, mentioned_user_id, mention_type")
        .in(
          "message_id",
          typed.map((r) => r.id)
        );
      const mentionedIds = new Set<string>();
      for (const mn of (mentionRows || []) as Array<{
        message_id: string;
        mentioned_user_id: string;
        mention_type: string;
      }>) {
        if (mn.mentioned_user_id === user.id || mn.mention_type !== "user") {
          mentionedIds.add(mn.message_id);
        }
      }

      const messages: HomeMessage[] = typed.map((r) => ({
        id: r.id,
        content: r.content,
        createdAt: r.created_at,
        senderName: one(r.profiles)?.display_name || "メンバー",
        isMention: mentionedIds.has(r.id),
      }));

      return {
        ...base,
        hasMention: mentionedIds.size > 0,
        latestAt: typed[0].created_at,
        messages,
      };
    })
  );

  return (
    <HomeView
      workspaceId={workspace.id}
      workspaceSlug={workspaceSlug}
      currentUserId={user.id}
      displayName={profileRes.data?.display_name || ""}
      channels={channels}
    />
  );
}
