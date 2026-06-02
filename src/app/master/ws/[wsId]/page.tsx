import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

type Channel = {
  id: string;
  name: string;
  slug: string;
  is_dm: boolean;
  is_private: boolean;
  is_hitorigoto: boolean;
  topic: string | null;
  created_at: string;
  member_count: number;
  message_count: number;
  latest_message_at: string | null;
  members: Array<{ id: string; display_name: string; avatar_url: string | null }>;
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}日前`;
  return new Date(iso).toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  });
}

function channelLabel(ch: Channel): string {
  if (ch.is_dm) {
    const names = ch.members.map((m) => m.display_name).join(" ↔ ");
    return `DM: ${names}`;
  }
  if (ch.is_hitorigoto) {
    const owner = ch.members[0]?.display_name ?? "?";
    return `独り言 (${owner})`;
  }
  return `#${ch.name}`;
}

function channelIcon(ch: Channel): string {
  if (ch.is_dm) return "💬";
  if (ch.is_hitorigoto) return "🌙";
  if (ch.is_private) return "🔒";
  return "#";
}

export default async function MasterWorkspaceChannels({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const supabase = await createClient();

  // WS 名取得 (ヘッダー用)
  const { data: wsList } = await supabase.rpc("master_list_workspaces");
  type Ws = { id: string; name: string };
  const ws = (wsList as Ws[] | null)?.find((w) => w.id === wsId);
  if (!ws) redirect("/master");

  const { data, error } = await supabase.rpc("master_list_channels", {
    p_workspace_id: wsId,
  });
  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
        チャンネル一覧を取得できませんでした: {error.message}
      </div>
    );
  }
  const channels = (data || []) as Channel[];

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-muted mb-1">
          <Link href="/master" className="hover:underline">マスター</Link>
          {" / "}
          {ws.name}
        </div>
        <h1 className="text-lg font-bold text-foreground">{ws.name} のチャンネル</h1>
        <p className="text-xs text-muted">{channels.length} 件</p>
      </div>
      <ul className="space-y-2">
        {channels.map((c) => (
          <li key={c.id}>
            <Link
              href={`/master/ch/${c.id}`}
              className="block rounded-xl border border-border bg-input-bg px-4 py-3 hover:bg-sidebar-hover transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground truncate">
                    <span className="mr-1">{channelIcon(c)}</span>
                    {channelLabel(c)}
                  </div>
                  {c.topic && (
                    <div className="text-[11px] text-muted truncate">
                      {c.topic}
                    </div>
                  )}
                  <div className="text-[10px] text-muted/70 truncate">
                    slug: {c.slug}
                  </div>
                </div>
                <div className="text-right text-[11px] text-muted shrink-0">
                  <div>{c.member_count} 名</div>
                  <div>{c.message_count.toLocaleString()} msg</div>
                  <div className="text-[10px] mt-0.5">
                    最終: {relativeTime(c.latest_message_at)}
                  </div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
