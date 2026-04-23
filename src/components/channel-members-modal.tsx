"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type MemberProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type ChannelMember = {
  user_id: string;
  profiles: MemberProfile;
};

type Props = {
  channelId: string;
  workspaceId: string;
  currentUserId: string;
  onClose: () => void;
};

export function ChannelMembersModal({
  channelId,
  workspaceId,
  currentUserId,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<"members" | "add">("members");
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([]);
  const [wsMembers, setWsMembers] = useState<ChannelMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const supabase = createClient();

  // データ取得
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");

    const [chRes, wsRes] = await Promise.all([
      supabase
        .from("channel_members")
        .select("user_id, profiles(id, display_name, avatar_url)")
        .eq("channel_id", channelId),
      supabase
        .from("workspace_members")
        .select("user_id, profiles(id, display_name, avatar_url)")
        .eq("workspace_id", workspaceId),
    ]);

    if (chRes.error) {
      setError(chRes.error.message);
      setLoading(false);
      return;
    }
    if (wsRes.error) {
      setError(wsRes.error.message);
      setLoading(false);
      return;
    }

    // プロフィールを正規化（配列の場合は先頭を取得）
    const normalizeMember = (row: { user_id: string; profiles: unknown }): ChannelMember => {
      const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        user_id: row.user_id,
        profiles: p as MemberProfile,
      };
    };

    setChannelMembers((chRes.data || []).map(normalizeMember));
    setWsMembers((wsRes.data || []).map(normalizeMember));
    setLoading(false);
  }, [supabase, channelId, workspaceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // チャンネルに未参加のWSメンバー
  const nonMembers = wsMembers.filter(
    (ws) => !channelMembers.some((ch) => ch.user_id === ws.user_id)
  );

  // メンバー追加
  async function handleAdd(userId: string) {
    setError("");
    const { error: insertError } = await supabase
      .from("channel_members")
      .insert({ channel_id: channelId, user_id: userId });

    if (insertError) {
      setError(insertError.message);
      return;
    }
    await fetchData();
  }

  // メンバー削除
  async function handleRemove(userId: string) {
    setError("");
    const { error: deleteError } = await supabase
      .from("channel_members")
      .delete()
      .eq("channel_id", channelId)
      .eq("user_id", userId);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await fetchData();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-sidebar border border-border p-6 space-y-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">チャンネルメンバー</h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* タブ切り替え */}
        <div className="flex gap-1 bg-background/50 rounded-xl p-1">
          <button
            onClick={() => setActiveTab("members")}
            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "members"
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            メンバー一覧 ({channelMembers.length})
          </button>
          <button
            onClick={() => setActiveTab("add")}
            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "add"
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            メンバー追加
          </button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* コンテンツ */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <div className="px-3 py-6 text-center text-sm text-muted">読み込み中...</div>
          ) : activeTab === "members" ? (
            // メンバー一覧タブ
            channelMembers.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted">
                メンバーがいません
              </div>
            ) : (
              channelMembers.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl"
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
                  <span className="text-sm text-foreground truncate flex-1">
                    {member.profiles.display_name}
                    {member.user_id === currentUserId && (
                      <span className="text-muted ml-1">(あなた)</span>
                    )}
                  </span>
                  {/* 削除ボタン（自分以外） */}
                  {member.user_id !== currentUserId && (
                    <button
                      onClick={() => handleRemove(member.user_id)}
                      className="text-muted hover:text-red-400 transition-colors shrink-0 p-1 rounded hover:bg-red-500/10"
                      title="メンバーを削除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))
            )
          ) : (
            // メンバー追加タブ
            nonMembers.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted">
                追加できるメンバーがいません
              </div>
            ) : (
              nonMembers.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl"
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
                  <span className="text-sm text-foreground truncate flex-1">
                    {member.profiles.display_name}
                  </span>
                  {/* 追加ボタン */}
                  <button
                    onClick={() => handleAdd(member.user_id)}
                    className="text-muted hover:text-accent transition-colors shrink-0 p-1 rounded hover:bg-accent/10"
                    title="メンバーを追加"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              ))
            )
          )}
        </div>

      </div>
    </div>
  );
}
