"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type MemberProfile = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

type Props = {
  channelId: string;
  onCreated: (messageId: string) => void;
  onClose: () => void;
};

/** 次の正時を datetime-local 用の文字列で返す */
function getNextHourLocal(): string {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** 日時を日本語表記にフォーマット */
function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dow = dayNames[d.getDay()];
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${month}月${day}日(${dow}) ${h}:${m}`;
}

export function CreateEventModal({ channelId, onCreated, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState(getNextHourLocal);
  const [location, setLocation] = useState("");
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetchingMembers, setFetchingMembers] = useState(true);
  const [error, setError] = useState("");

  // チャンネルメンバーを取得
  useEffect(() => {
    let mounted = true;
    async function fetchMembers() {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from("channel_members")
        .select("user_id, profiles(id, display_name, avatar_url)")
        .eq("channel_id", channelId);

      if (!mounted) return;
      if (fetchErr) {
        // eslint-disable-next-line no-console
        console.error("[event] members fetch failed:", fetchErr);
        setFetchingMembers(false);
        return;
      }

      const list: MemberProfile[] = (data ?? []).map((row: Record<string, unknown>) => {
        const p = row.profiles as { id: string; display_name: string; avatar_url: string | null } | null;
        return {
          user_id: row.user_id as string,
          display_name: p?.display_name ?? "不明",
          avatar_url: p?.avatar_url ?? null,
        };
      });
      setMembers(list);
      // デフォルト全員選択
      setSelectedIds(new Set(list.map((m) => m.user_id)));
      setFetchingMembers(false);
    }
    fetchMembers();
    return () => { mounted = false; };
  }, [channelId]);

  function toggleMember(userId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(members.map((m) => m.user_id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  const allSelected = members.length > 0 && selectedIds.size === members.length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("タイトルを入力してください");
      return;
    }
    if (!startAt) {
      setError("日時を入力してください");
      return;
    }
    const dt = new Date(startAt);
    if (Number.isNaN(dt.getTime())) {
      setError("日時が不正です");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      // メッセージ本文を組み立て
      const locLine = location.trim() ? `\n📍 ${location.trim()}` : "";
      const content = `📅 ${trimmedTitle}\n${formatDateTimeJa(startAt)}${locLine}`;

      // 現在のユーザーIDを取得
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("認証エラー"); return; }

      // メッセージを作成
      const { data: msgData, error: msgErr } = await supabase
        .from("messages")
        .insert({
          channel_id: channelId,
          user_id: user.id,
          content,
        })
        .select("id")
        .single();

      if (msgErr || !msgData) {
        setError("メッセージの作成に失敗しました: " + (msgErr?.message ?? "不明なエラー"));
        return;
      }

      const messageId = msgData.id as string;

      // イベントを作成 (RPC)
      const { error: rpcErr } = await supabase.rpc("create_event", {
        p_message_id: messageId,
        p_channel_id: channelId,
        p_title: trimmedTitle,
        p_start_at: dt.toISOString(),
        p_location: location.trim() || null,
        p_attendee_ids: Array.from(selectedIds),
      });

      if (rpcErr) {
        setError("イベントの作成に失敗しました: " + rpcErr.message);
        return;
      }

      onCreated(messageId);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-sidebar border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <h3 className="text-base font-bold">イベントを作成</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted hover:text-foreground rounded transition-colors"
            aria-label="閉じる"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4" id="create-event-form">
          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>
          )}

          {/* タイトル */}
          <div>
            <label className="block text-xs text-muted mb-1">タイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="例: 週次定例ミーティング"
              autoFocus
            />
          </div>

          {/* 日時 */}
          <div>
            <label className="block text-xs text-muted mb-1">日時</label>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
              className="w-full max-w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none appearance-none"
            />
          </div>

          {/* 場所 */}
          <div>
            <label className="block text-xs text-muted mb-1">場所 (任意)</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="例: 会議室A / Zoom"
            />
          </div>

          {/* 参加者 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted">参加者</label>
              <button
                type="button"
                onClick={allSelected ? deselectAll : selectAll}
                className="text-xs text-accent hover:underline"
              >
                {allSelected ? "全員解除" : "全員選択"}
              </button>
            </div>
            {fetchingMembers ? (
              <div className="text-xs text-muted py-2">メンバーを読み込み中...</div>
            ) : members.length === 0 ? (
              <div className="text-xs text-muted py-2">メンバーが見つかりません</div>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-input-bg">
                {members.map((m) => (
                  <label
                    key={m.user_id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-foreground/5 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(m.user_id)}
                      onChange={() => toggleMember(m.user_id)}
                      className="rounded border-border"
                    />
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
                        alt=""
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                        {m.display_name.charAt(0)}
                      </div>
                    )}
                    <span className="text-sm text-foreground truncate">{m.display_name}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted">
              {selectedIds.size}人選択中
            </p>
          </div>
        </form>

        {/* フッター */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border/50 shrink-0 bg-sidebar">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            form="create-event-form"
            disabled={loading || !title.trim() || !startAt}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "作成中..." : "イベントを作成"}
          </button>
        </div>
      </div>
    </div>
  );
}
