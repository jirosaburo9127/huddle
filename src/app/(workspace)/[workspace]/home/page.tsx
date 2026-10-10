import { stripSystemEmoji } from "@/lib/system-post-icons";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import {
  HomeView,
  type HomeMessage,
  type HomePerson,
  type HomeRailItem,
  type HomeTaskEvent,
  type HomeWaitingTask,
} from "./home-view";

// タイムラインは開くたびに最新を出したいので静的キャッシュを無効化
export const dynamic = "force-dynamic";

// タイムラインに出す投稿数。ホームは「いまの動き」を見る場所なので最新側だけでよい
// （古い投稿は各チャンネルで読む）。毎回ゼロから取り直し、クライアント state に蓄積マージはしない。
const FEED_LIMIT = 60;
// 完了タスク・決定事項を「最近の動き」として拾う日数
const RECENT_DAYS = 3;
// 「あなた待ち」として拾う、自分宛てメンションの遡り日数
const WAITING_DAYS = 7;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type ChannelRow = {
  id: string;
  name: string;
  slug: string;
  is_dm: boolean;
  is_hitorigoto: boolean;
  is_archived: boolean;
  workspace_id: string;
};

type ProfileRow = { display_name: string; avatar_url: string | null };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toPerson(profile: ProfileRow | null | undefined): HomePerson {
  return { name: profile?.display_name || "メンバー", avatarUrl: profile?.avatar_url || null };
}

// 今日（日本時間）の範囲と「最近」の起点
function getTimeWindow() {
  const nowMs = Date.now();
  const todayJst = new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);
  const dayStart = new Date(`${todayJst}T00:00:00+09:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const recentSince = new Date(nowMs - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const waitingSince = new Date(nowMs - WAITING_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { todayJst, dayStart, dayEnd, recentSince, waitingSince };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const userId = user.id;
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (!workspace) redirect("/");

  const [membershipsRes, profileRes] = await Promise.all([
    supabase
      .from("channel_members")
      .select(
        "channel_id, last_read_at, joined_at, channels!inner(id, name, slug, is_dm, is_hitorigoto, is_archived, workspace_id)"
      )
      .eq("user_id", user.id)
      .eq("channels.workspace_id", workspace.id),
    supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle(),
  ]);

  if (membershipsRes.error) {
    throw new Error(`ホームの読み込みに失敗しました: ${membershipsRes.error.message}`);
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

  const me = toPerson(profileRes.data as ProfileRow | null);
  const channelIds = memberships.map((m) => m.channel_id);

  if (channelIds.length === 0) {
    return (
      <HomeView
        workspaceId={workspace.id}
        workspaceSlug={workspaceSlug}
        currentUserId={user.id}
        me={me}
        messages={[]}
        taskEvents={[]}
        railItems={[]}
        waitingMessages={[]}
        waitingTasks={[]}
      />
    );
  }

  const { todayJst, dayStart, dayEnd, recentSince, waitingSince } = getTimeWindow();

  const dmIds = memberships.filter((m) => m.channel.is_dm).map((m) => m.channel_id);

  const messageSelect =
    "id, content, created_at, user_id, channel_id, parent_id, is_decision, reply_count, profiles(display_name, avatar_url), reactions(id, emoji, user_id)";

  const [feedRes, dmRes, eventsRes, doneTasksRes, dueTasksRes, waitingRes, myPostsRes] = await Promise.all([
    supabase
      .from("messages")
      .select(messageSelect)
      .in("channel_id", channelIds)
      .is("deleted_at", null)
      .is("system_event", null)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    dmIds.length > 0
      ? supabase
          .from("channel_members")
          .select("channel_id, profiles(display_name, avatar_url)")
          .in("channel_id", dmIds)
          .neq("user_id", user.id)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("events")
      .select("id, title, start_at, location, channel_id, created_by")
      .in("channel_id", channelIds)
      .gte("start_at", dayStart.toISOString())
      .lt("start_at", dayEnd.toISOString())
      .order("start_at", { ascending: true }),
    supabase
      .from("tasks")
      .select(
        "id, title, updated_at, channel_id, created_by, task_assignees(user_id, profiles(display_name, avatar_url))"
      )
      .in("channel_id", channelIds)
      .eq("status", "done")
      .gte("updated_at", recentSince)
      .order("updated_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, due_date, channel_id, task_assignees!inner(user_id)")
      .in("channel_id", channelIds)
      .neq("status", "done")
      .lte("due_date", todayJst)
      .eq("task_assignees.user_id", user.id)
      .order("due_date", { ascending: true }),
    // あなた待ち: 直近の「自分を名指ししたメンション」
    supabase
      .from("mentions")
      .select(`message_id, messages!inner(${messageSelect}, deleted_at)`)
      .eq("mentioned_user_id", user.id)
      .eq("mention_type", "user")
      .in("messages.channel_id", channelIds)
      .is("messages.deleted_at", null)
      .neq("messages.user_id", user.id)
      .gte("messages.created_at", waitingSince),
    // 同じ期間の自分の投稿（そのチャンネルで後から発言していれば「返した」とみなす）
    supabase
      .from("messages")
      .select("channel_id, created_at")
      .eq("user_id", user.id)
      .in("channel_id", channelIds)
      .is("deleted_at", null)
      .gte("created_at", waitingSince)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (feedRes.error) {
    throw new Error(`タイムラインの取得に失敗しました: ${feedRes.error.message}`);
  }
  // 補助情報の取得失敗はタイムライン自体を止めず、ログに残す
  for (const [label, res] of [
    ["events", eventsRes],
    ["done tasks", doneTasksRes],
    ["due tasks", dueTasksRes],
    ["waiting", waitingRes],
    ["my posts", myPostsRes],
  ] as const) {
    if (res.error) console.error(`[home] ${label} fetch failed:`, res.error.message);
  }

  // DM は相手の名前をチャンネル名として出す
  const dmNames = new Map<string, string>();
  for (const row of (dmRes.data || []) as Array<{
    channel_id: string;
    profiles: ProfileRow | ProfileRow[] | null;
  }>) {
    const p = one(row.profiles);
    if (p && !dmNames.has(row.channel_id)) dmNames.set(row.channel_id, p.display_name);
  }

  const channelInfo = new Map(
    memberships.map((m) => [
      m.channel_id,
      {
        name: m.channel.is_dm ? dmNames.get(m.channel_id) || "DM" : m.channel.name,
        slug: m.channel.slug,
        isDm: m.channel.is_dm,
        since: m.last_read_at || m.joined_at,
      },
    ])
  );

  type MessageRow = {
    id: string;
    content: string;
    created_at: string;
    user_id: string;
    channel_id: string;
    parent_id: string | null;
    is_decision: boolean;
    reply_count: number;
    profiles: ProfileRow | ProfileRow[] | null;
    reactions: Array<{ id: string; emoji: string; user_id: string }> | null;
  };
  const feedRows = (feedRes.data || []) as MessageRow[];

  // @自分 / @channel / @here の付いた投稿を判定
  const mentionedIds = new Set<string>();
  if (feedRows.length > 0) {
    const { data: mentionRows } = await supabase
      .from("mentions")
      .select("message_id, mentioned_user_id, mention_type")
      .in(
        "message_id",
        feedRows.map((r) => r.id)
      );
    for (const mn of (mentionRows || []) as Array<{
      message_id: string;
      mentioned_user_id: string;
      mention_type: string;
    }>) {
      if (mn.mentioned_user_id === user.id || mn.mention_type !== "user") {
        mentionedIds.add(mn.message_id);
      }
    }
  }

  function toHomeMessage(r: MessageRow, forceMention = false): HomeMessage[] {
    const ch = channelInfo.get(r.channel_id);
    if (!ch) return [];
    const isMine = r.user_id === userId;
    return [
      {
        id: r.id,
        content: r.content,
        createdAt: r.created_at,
        channelId: r.channel_id,
        channelName: ch.name,
        channelSlug: ch.slug,
        isDm: ch.isDm,
        parentId: r.parent_id,
        sender: toPerson(one(r.profiles)),
        isMine,
        isDecision: r.is_decision,
        replyCount: r.reply_count || 0,
        isMention: !isMine && (forceMention || mentionedIds.has(r.id)),
        isUnread: !isMine && r.created_at > ch.since,
        reactions: (r.reactions || []).map((x) => ({ id: x.id, emoji: x.emoji, userId: x.user_id })),
      },
    ];
  }

  const messages: HomeMessage[] = feedRows.flatMap((r) => toHomeMessage(r));

  // あなた待ち: 名指しされたのに、リアクションも、その後の発言もしていないもの
  const myLatestPost = new Map<string, string>();
  for (const row of (myPostsRes.data || []) as Array<{ channel_id: string; created_at: string }>) {
    if (!myLatestPost.has(row.channel_id)) myLatestPost.set(row.channel_id, row.created_at);
  }
  const waitingMessages: HomeMessage[] = ((waitingRes.data || []) as unknown as Array<{
    messages: MessageRow | MessageRow[];
  }>)
    .flatMap((row) => {
      const m = one(row.messages);
      if (!m) return [];
      const reacted = (m.reactions || []).some((x) => x.user_id === user.id);
      const repliedAfter = (myLatestPost.get(m.channel_id) || "") > m.created_at;
      return reacted || repliedAfter ? [] : toHomeMessage(m, true);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const waitingTasks: HomeWaitingTask[] = ((dueTasksRes.data || []) as Array<{
    id: string;
    title: string;
    due_date: string;
    channel_id: string;
  }>).map((t) => ({
    id: t.id,
    title: t.title,
    isOverdue: t.due_date < todayJst,
    channelName: channelInfo.get(t.channel_id)?.name || "",
  }));

  // 完了タスク・予定の作成者プロフィールをまとめて取得
  const doneTasks = (doneTasksRes.data || []) as Array<{
    id: string;
    title: string;
    updated_at: string;
    channel_id: string;
    created_by: string;
    task_assignees: Array<{ user_id: string; profiles: ProfileRow | ProfileRow[] | null }> | null;
  }>;
  const events = (eventsRes.data || []) as Array<{
    id: string;
    title: string;
    start_at: string;
    location: string | null;
    channel_id: string;
    created_by: string;
  }>;
  const creatorIds = [...new Set([...doneTasks.map((t) => t.created_by), ...events.map((e) => e.created_by)])];
  const creators = new Map<string, HomePerson>();
  if (creatorIds.length > 0) {
    const { data: creatorRows } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", creatorIds);
    for (const row of (creatorRows || []) as Array<{ id: string } & ProfileRow>) {
      creators.set(row.id, toPerson(row));
    }
  }

  const taskEvents: HomeTaskEvent[] = doneTasks.flatMap((t) => {
    const ch = channelInfo.get(t.channel_id);
    if (!ch) return [];
    return [
      {
        id: t.id,
        title: t.title,
        doneAt: t.updated_at,
        channelName: ch.name,
        channelSlug: ch.slug,
        assignees: (t.task_assignees || []).map((a) => toPerson(one(a.profiles))),
        creator: creators.get(t.created_by) || toPerson(null),
      },
    ];
  });

  // 「今日の動き」: 今日の予定 → 最近の決定事項（自分の締切は「あなた待ち」に出す）
  const railItems: HomeRailItem[] = [];
  for (const e of events) {
    const ch = channelInfo.get(e.channel_id);
    const time = new Date(new Date(e.start_at).getTime() + JST_OFFSET_MS).toISOString().slice(11, 16);
    railItems.push({
      key: `event-${e.id}`,
      label: `予定・${time.replace(/^0/, "")}`,
      title: e.title,
      sub: e.location || (ch ? `# ${ch.name}` : ""),
      person: creators.get(e.created_by) || null,
      href: `/${workspaceSlug}/calendar`,
    });
  }
  for (const m of messages.filter((x) => x.isDecision && x.createdAt >= recentSince).slice(0, 5)) {
    railItems.push({
      key: `decision-${m.id}`,
      label: "決定事項",
      title: stripSystemEmoji(m.content).replace(/\s+/g, " ").trim(),
      sub: m.isDm ? m.channelName : `# ${m.channelName}`,
      person: m.sender,
      href: `/${workspaceSlug}/${m.channelSlug}`,
    });
  }

  return (
    <HomeView
      workspaceId={workspace.id}
      workspaceSlug={workspaceSlug}
      currentUserId={user.id}
      me={me}
      messages={messages}
      taskEvents={taskEvents}
      railItems={railItems}
      waitingMessages={waitingMessages}
      waitingTasks={waitingTasks}
    />
  );
}
