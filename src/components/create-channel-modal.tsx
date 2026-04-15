"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ChannelCategory } from "@/lib/supabase/types";
import {
  CHANNEL_CATEGORIES,
  CHANNEL_CATEGORY_LABELS,
} from "@/lib/channel-categories";

type MemberProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  status: string | null;
};

type WorkspaceMember = {
  user_id: string;
  profiles: MemberProfile | MemberProfile[];
};

type Props = {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  members: WorkspaceMember[];
  onClose: () => void;
};

export function CreateChannelModal({
  workspaceId,
  workspaceSlug,
  currentUserId,
  members,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [category, setCategory] = useState<ChannelCategory | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [memberQuery, setMemberQuery] = useState("");
  const router = useRouter();
  const supabase = createClient();

  // 自分を除いたメンバー一覧（自分は自動で追加される）
  const candidateMembers = useMemo(() => {
    return members
      .filter((m) => m.user_id !== currentUserId)
      .map((m) => ({
        user_id: m.user_id,
        profile: Array.isArray(m.profiles) ? m.profiles[0] : m.profiles,
      }))
      .filter((m) => m.profile);
  }, [members, currentUserId]);

  // 検索フィルタ
  const filteredMembers = useMemo(() => {
    if (!memberQuery.trim()) return candidateMembers;
    const q = memberQuery.toLowerCase();
    return candidateMembers.filter((m) =>
      m.profile.display_name.toLowerCase().includes(q)
    );
  }, [candidateMembers, memberQuery]);

  function toggleMember(userId: string) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const asciiSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const slug = asciiSlug || `ch-${crypto.randomUUID().slice(0, 8)}`;

    // 027: メンバー一括追加対応 RPC
    const { data: channel, error: err } = await supabase.rpc(
      "create_channel_with_members",
      {
        p_workspace_id: workspaceId,
        p_name: name,
        p_slug: slug,
        p_is_private: isPrivate,
        p_member_ids: Array.from(selectedMemberIds),
      }
    );

    if (err || !channel) {
      setError(err?.message || "チャンネル作成に失敗しました");
      setLoading(false);
      return;
    }

    // カテゴリを別 RPC で設定 (create_channel_with_members RPC はカテゴリ未対応のため)
    if (category) {
      const { error: catErr } = await supabase.rpc("update_channel_category", {
        p_channel_id: channel.id,
        p_category: category,
      });
      if (catErr) {
        // カテゴリ設定失敗はチャンネル作成自体は成功として扱い、警告だけ出す
        // eslint-disable-next-line no-console
        console.warn("[create-channel] category set failed:", catErr);
      }
    }

    onClose();
    router.push(`/${workspaceSlug}/${channel.slug}`);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl bg-sidebar border border-border overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <h3 className="text-lg font-bold">チャンネルを作成</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted hover:text-foreground rounded transition-colors"
            aria-label="閉じる"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* ボディ（スクロール可能） */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
          id="create-channel-form"
        >
          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-muted mb-1">チャンネル名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="例: random"
            />
          </div>

          <div>
            <label className="block text-sm text-muted mb-1">カテゴリ</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ChannelCategory | "")}
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">未分類</option>
              {CHANNEL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-muted">プライベートチャンネルにする</span>
          </label>

          {/* メンバー選択 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-muted">
                メンバーを追加 ({selectedMemberIds.size}人選択中)
              </label>
              {selectedMemberIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedMemberIds(new Set())}
                  className="text-xs text-muted hover:text-accent"
                >
                  クリア
                </button>
              )}
            </div>
            {candidateMembers.length === 0 ? (
              <p className="text-xs text-muted">
                ワークスペースに他のメンバーがいません
              </p>
            ) : (
              <>
                <input
                  type="text"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="メンバーを検索"
                  className="w-full mb-2 rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
                />
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border/50 bg-background/30">
                  {filteredMembers.length === 0 ? (
                    <p className="text-xs text-muted p-3 text-center">
                      該当するメンバーがいません
                    </p>
                  ) : (
                    filteredMembers.map((m) => {
                      const checked = selectedMemberIds.has(m.user_id);
                      return (
                        <button
                          key={m.user_id}
                          type="button"
                          onClick={() => toggleMember(m.user_id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors ${
                            checked ? "bg-accent/5" : ""
                          }`}
                        >
                          <span className="w-8 h-8 shrink-0 rounded-full bg-accent/20 flex items-center justify-center overflow-hidden">
                            {m.profile.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={m.profile.avatar_url}
                                alt=""
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <span className="text-xs font-bold text-accent">
                                {m.profile.display_name?.[0]?.toUpperCase() || "?"}
                              </span>
                            )}
                          </span>
                          <span className="flex-1 min-w-0 text-sm text-foreground truncate">
                            {m.profile.display_name}
                          </span>
                          <span
                            className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                              checked
                                ? "border-accent bg-accent"
                                : "border-border"
                            }`}
                          >
                            {checked && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </form>

        {/* フッター（sticky） */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border/50 shrink-0 bg-sidebar">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            form="create-channel-form"
            disabled={loading || !name.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "作成中..." : "作成"}
          </button>
        </div>
      </div>
    </div>
  );
}
