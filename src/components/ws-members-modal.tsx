"use client";

import { useState, useMemo } from "react";

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
  members: WorkspaceMember[];
  onClose: () => void;
};

export function WsMembersModal({ members, onClose }: Props) {
  const [searchQuery, setSearchQuery] = useState("");

  // プロフィールを正規化（配列の場合は先頭を取得）
  const normalizedMembers = useMemo(() => {
    return members.map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return { user_id: m.user_id, profile: p };
    });
  }, [members]);

  // 検索フィルタリング
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return normalizedMembers;
    const q = searchQuery.toLowerCase();
    return normalizedMembers.filter((m) =>
      m.profile?.display_name?.toLowerCase().includes(q)
    );
  }, [normalizedMembers, searchQuery]);

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
          <h3 className="text-lg font-bold">ワークスペースメンバー</h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* メンバー数 */}
        <p className="text-sm text-muted">
          {filteredMembers.length}人のメンバー
        </p>

        {/* 検索 */}
        <input
          type="text"
          placeholder="メンバーを検索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-background/50 rounded-xl px-3 py-2 text-sm border border-border/50 focus:border-accent focus:bg-input-bg placeholder-muted/60 transition-all outline-none"
        />

        {/* メンバーリスト */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filteredMembers.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">
              メンバーが見つかりません
            </div>
          ) : (
            filteredMembers.map((member) => {
              const profile = member.profile;
              const name = profile?.display_name || "不明";
              const avatarUrl = profile?.avatar_url;
              const status = profile?.status;
              // ステータスに応じたドットカラー
              const dotColor =
                status === "focusing"
                  ? "bg-yellow-500"
                  : status === "away"
                    ? "bg-muted/50"
                    : "bg-online";

              return (
                <div
                  key={member.user_id}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  {/* アバター + オンラインドット */}
                  <span className="relative shrink-0">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={name}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                        <span className="text-xs font-medium text-accent">
                          {name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-sidebar ${dotColor}`}
                    />
                  </span>
                  {/* 表示名 */}
                  <span className="text-sm text-foreground truncate">
                    {name}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
