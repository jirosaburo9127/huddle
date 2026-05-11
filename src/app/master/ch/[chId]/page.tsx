import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type Reaction = {
  id: string;
  emoji: string;
  user_id: string;
  display_name: string;
};

type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_count: number;
  is_decision: boolean | null;
  status: string | null;
  system_event: string | null;
  profiles: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    is_bot?: boolean;
  };
  reactions: Reaction[];
};

type Channel = {
  id: string;
  name: string;
  slug: string;
  workspace_id: string;
  is_dm: boolean;
  is_private: boolean;
  is_hitorigoto: boolean;
  topic: string | null;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MasterChannelMessages({
  params,
}: {
  params: Promise<{ chId: string }>;
}) {
  const { chId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("master_get_channel_messages", {
    p_channel_id: chId,
    p_limit: 200,
  });
  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
        メッセージを取得できませんでした: {error.message}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="text-sm text-muted">チャンネルが見つかりません</div>
    );
  }

  const result = data as { channel: Channel; messages: Message[] };
  const channel = result.channel;
  const messages = result.messages || [];

  // Group by date for separators
  const byDate = new Map<string, Message[]>();
  for (const m of messages) {
    const d = new Date(m.created_at).toLocaleDateString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
    const arr = byDate.get(d) || [];
    arr.push(m);
    byDate.set(d, arr);
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-muted mb-1">
          <Link href="/master" className="hover:underline">マスター</Link>
          {" / "}
          <Link href={`/master/ws/${channel.workspace_id}`} className="hover:underline">
            WS
          </Link>
          {" / "}
          {channel.is_dm ? "💬 DM" : channel.is_hitorigoto ? "🌙 独り言" : `#${channel.name}`}
        </div>
        <h1 className="text-lg font-bold text-foreground">
          {channel.is_dm ? "DM" : channel.is_hitorigoto ? "独り言" : `#${channel.name}`}
        </h1>
        {channel.topic && (
          <p className="text-xs text-muted">{channel.topic}</p>
        )}
        <p className="text-xs text-muted">
          {messages.length} 件 / 古い順 / 読み取り専用
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-input-bg p-3">
        {messages.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted">
            メッセージはありません
          </div>
        ) : (
          Array.from(byDate.entries()).map(([dateLabel, msgs]) => (
            <div key={dateLabel} className="space-y-2">
              <div className="text-center">
                <span className="text-[11px] text-muted bg-background px-3 py-0.5 rounded-full border border-border/40">
                  {dateLabel}
                </span>
              </div>
              {msgs.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-start gap-2 px-1 ${
                    m.deleted_at ? "opacity-40" : ""
                  }`}
                >
                  {/* avatar */}
                  <div className="shrink-0 w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[11px] font-bold text-accent">
                    {m.profiles.is_bot
                      ? "🍊"
                      : (m.profiles.display_name || "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground truncate max-w-[10em]">
                        {m.profiles.display_name}
                      </span>
                      <span className="text-[11px] text-muted">
                        {formatTime(m.created_at)}
                      </span>
                      {m.edited_at && (
                        <span className="text-[10px] text-muted">(編集済み)</span>
                      )}
                      {m.deleted_at && (
                        <span className="text-[10px] text-red-400">[削除済み]</span>
                      )}
                      {m.parent_id && (
                        <span className="text-[10px] text-accent">↳ 返信</span>
                      )}
                      {m.is_decision && (
                        <span className="text-[10px] text-red-400">[決定]</span>
                      )}
                    </div>
                    <div className="text-sm text-foreground whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                    {m.reactions && m.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(
                          m.reactions.reduce<Record<string, number>>((acc, r) => {
                            acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
                            return acc;
                          }, {})
                        ).map(([emoji, count]) => (
                          <span
                            key={emoji}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-border/40"
                          >
                            {emoji} {count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
