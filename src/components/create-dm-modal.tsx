"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Channel } from "@/lib/supabase/types";

// DMチャンネル + メンバー情報の型
type DmChannelWithMembers = Channel & {
  channel_members: Array<{ user_id: string }>;
};

type MemberProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  status: string | null;
};

type Props = {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  members: Array<{
    user_id: string;
    profiles: MemberProfile;
  }>;
  onClose: () => void;
};

export function CreateDmModal({
  workspaceId,
  workspaceSlug,
  currentUserId,
  members,
  onClose,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createClient();

  // 自分を除外し、検索でフィルタリング
  const filteredMembers = useMemo(() => {
    const others = members.filter((m) => m.user_id !== currentUserId);
    if (!searchQuery.trim()) return others;
    const q = searchQuery.toLowerCase();
    return others.filter((m) =>
      m.profiles.display_name.toLowerCase().includes(q)
    );
  }, [members, currentUserId, searchQuery]);

  // メンバーをクリックしてDMを開始
  async function handleSelectMember(targetUserId: string) {
    setLoading(true);
    setError("");

    try {
      // 既存のDMチャンネルを検索
      const { data: existingDms, error: fetchError } = await supabase
        .from("channels")
        .select("*, channel_members(user_id)")
        .eq("workspace_id", workspaceId)
        .eq("is_dm", true);

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      // 同じ2人のDMが既にあるかチェック
      const dmList = existingDms as DmChannelWithMembers[] | null;
      const existingDm = dmList?.find((ch) => {
        const memberIds = ch.channel_members.map((m) => m.user_id);
        return (
          memberIds.length === 2 &&
          memberIds.includes(currentUserId) &&
          memberIds.includes(targetUserId)
        );
      });

      if (existingDm) {
        // 既存のDMに遷移
        onClose();
        router.push(`/${workspaceSlug}/${existingDm.slug}`);
        router.refresh();
        return;
      }

      // 新規DMチャンネルを作成
      const dmSlug = `dm-${crypto.randomUUID()}`;
      const { data: channel, error: insertError } = await supabase
        .from("channels")
        .insert({
          workspace_id: workspaceId,
          name: "dm",
          slug: dmSlug,
          is_dm: true,
          is_private: true,
          created_by: currentUserId,
        })
        .select()
        .single();

      if (insertError || !channel) {
        setError(insertError?.message || "DMチャンネルの作成に失敗しました");
        setLoading(false);
        return;
      }

      // 両方のユーザーをチャンネルメンバーに追加
      const { error: memberError } = await supabase
        .from("channel_members")
        .insert([
          { channel_id: channel.id, user_id: currentUserId },
          { channel_id: channel.id, user_id: targetUserId },
        ]);

      if (memberError) {
        setError(memberError.message);
        setLoading(false);
        return;
      }

      onClose();
      router.push(`/${workspaceSlug}/${channel.slug}`);
      router.refresh();
    } catch {
      setError("予期しないエラーが発生しました");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-sidebar border border-border p-6 space-y-4 animate-fade-in">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">新しいメッセージ</h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* メンバー検索 */}
        <input
          type="text"
          placeholder="メンバーを検索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-input-bg border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none transition-colors"
        />

        {/* メンバーリスト */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <div className="px-3 py-6 text-center text-sm text-muted">
              処理中...
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">
              メンバーが見つかりません
            </div>
          ) : (
            filteredMembers.map((member) => (
              <button
                key={member.user_id}
                onClick={() => handleSelectMember(member.user_id)}
                disabled={loading}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.04] cursor-pointer transition-colors text-left disabled:opacity-50"
              >
                {/* アバター */}
                {member.profiles.avatar_url ? (
                  <img
                    src={member.profiles.avatar_url}
                    alt={member.profiles.display_name}
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <span className="text-xs font-medium text-accent">
                      {member.profiles.display_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                {/* 表示名 */}
                <span className="text-sm text-foreground truncate">
                  {member.profiles.display_name}
                </span>
                {/* オンライン状態 */}
                {member.profiles.status === "online" && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-online shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
