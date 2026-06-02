"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { useUnreadStore } from "@/stores/unread-store";
import { BookmarkModal } from "@/components/bookmark-modal";
import { WsMembersModal } from "@/components/ws-members-modal";
import type { Channel } from "@/lib/supabase/types";

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
  members: Array<{ user_id: string; profiles: { id: string; display_name: string; avatar_url: string | null; status: string | null } | Array<{ id: string; display_name: string; avatar_url: string | null; status: string | null }> }>;
  channels?: Channel[];
  hitorigotoChannel?: { id: string; slug: string; name: string } | null;
};

export function BottomTabBar({ workspaceSlug, workspaceId, currentUserId, members, channels = [], hitorigotoChannel }: Props) {
  const pathname = usePathname();
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const messageInputFocused = useMobileNavStore((s) => s.messageInputFocused);
  const dmUnreadCount = useUnreadStore((s) => s.dmUnreadCount);
  const [showMore, setShowMore] = useState(false);
  const [showBookmark, setShowBookmark] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [quickPostTarget, setQuickPostTarget] = useState<string>("");
  const [quickPostText, setQuickPostText] = useState("");

  // URL が変わったら「その他」ポップオーバー (showMore) のみ閉じる。
  // サイドバーはここでは閉じない: チャンネル遷移時は ChannelView マウント時
  // (channel-view.tsx の useEffect) で閉じる。pathname 変更直後にここで閉じると
  // loading だけが先に表示されて白く見えるため。
  // showBookmark / showMembers はモーダルで、開いた状態から直接 URL 遷移する
  // 導線がないので pathname 同期は不要。
  const initialMountRef = useRef(true);
  // pathname 変化（外部のナビゲーション state）に同期して UI を閉じる。
  // 派生 state では計算できないため effect 内で setState する正当なケース
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowMore(false);
  }, [pathname]);

  // ポップオーバー外タップで閉じる（その他ボタン自身と中身は除外）
  useEffect(() => {
    if (!showMore) return;
    function onDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      const popover = document.querySelector("[data-more-popover]");
      const trigger = document.querySelector("[data-more-trigger]");
      if (popover?.contains(target)) return;
      if (trigger?.contains(target)) return;
      setShowMore(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [showMore]);

  const isHome = !pathname.includes("/dm-list") && !pathname.includes("/in-progress") && !pathname.includes("/calendar") && !pathname.includes("/files") && !pathname.includes("/dashboard") && !pathname.includes("/albums");
  const isCalendar = pathname.includes("/calendar");
  const isAlbums = pathname.includes("/albums");
  const [showQuickPost, setShowQuickPost] = useState(false);
  const currentUserProfile = useMemo(() => {
    const me = members.find((m) => m.user_id === currentUserId);
    const profile = me?.profiles;
    return Array.isArray(profile) ? profile[0] : profile;
  }, [members, currentUserId]);
  const recentTargets = useMemo(() => {
    const normalChannels = channels
      .filter((ch) => !ch.is_dm && !ch.is_hitorigoto)
      .slice(0, 4)
      .map((ch) => ({ id: ch.id, name: ch.name }));
    return [
      ...(hitorigotoChannel ? [{ id: hitorigotoChannel.id, name: hitorigotoChannel.name || "独り言" }] : []),
      ...normalChannels,
    ].slice(0, 5);
  }, [channels, hitorigotoChannel]);
  const canQuickPost = quickPostTarget && quickPostText.trim();

  return (
    <>
      <nav
        className={`fixed bottom-0 left-0 right-0 z-[55] bg-surface lg:hidden safe-area-bottom transition-transform duration-150 ${
          messageInputFocused ? "translate-y-full pointer-events-none" : "translate-y-0"
        }`}
        aria-hidden={messageInputFocused}
      >
        <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
        <div className="flex items-center justify-around h-14 px-2 pt-2 pb-1">
          {/* ホーム */}
          <button
            onClick={() => setSidebarOpen(true)}
            className={`relative flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              isHome ? "text-foreground" : "text-muted"
            }`}
          >
            <svg className="w-[23px] h-[23px]" fill="none" stroke="currentColor" strokeWidth={isHome ? 2 : 1.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            <span className="text-[10px]">ホーム</span>
            {isHome && <span className="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-foreground" />}
          </button>

          {/* カレンダー */}
          <Link
            href={`/${workspaceSlug}/calendar`}
            onClick={() => setSidebarOpen(false)}
            className={`relative flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              isCalendar ? "text-foreground" : "text-muted"
            }`}
          >
            <svg className="w-[23px] h-[23px]" fill="none" stroke="currentColor" strokeWidth={isCalendar ? 2 : 1.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <span className="text-[10px]">カレンダー</span>
            {isCalendar && <span className="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-foreground" />}
          </Link>

          {/* ＋ボタン（クイック投稿） */}
          <button
            onClick={() => setShowQuickPost(true)}
            className="flex items-center justify-center -mt-1"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky text-white shadow-[0_1px_4px_rgba(56,189,248,0.20)] active:scale-90 transition-transform">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </span>
          </button>

          {/* アルバム */}
          <Link
            href={`/${workspaceSlug}/albums`}
            onClick={() => setSidebarOpen(false)}
            className={`relative flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              isAlbums ? "text-foreground" : "text-muted"
            }`}
          >
            <svg className="w-[23px] h-[23px]" fill="none" stroke="currentColor" strokeWidth={isAlbums ? 2 : 1.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            <span className="text-[10px]">アルバム</span>
            {isAlbums && <span className="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-foreground" />}
          </Link>

          {/* その他 (DM 未読があればアイコン右上にバッジ) */}
          <button
            data-more-trigger
            onClick={() => setShowMore((v) => !v)}
            className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              showMore ? "text-foreground" : "text-muted"
            }`}
          >
            <span className="relative">
              {currentUserProfile?.avatar_url ? (
                <img
                  src={currentUserProfile.avatar_url}
                  alt=""
                  className={`h-[23px] w-[23px] rounded-full object-cover ${showMore ? "ring-2 ring-foreground" : ""}`}
                />
              ) : (
                <span className={`flex h-[23px] w-[23px] items-center justify-center rounded-full bg-muted text-[10px] font-bold text-white ${showMore ? "ring-2 ring-foreground" : ""}`}>
                  {(currentUserProfile?.display_name || "?").charAt(0)}
                </span>
              )}
              {dmUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-white text-[10px] font-bold leading-[16px] text-center">
                  {dmUnreadCount > 99 ? "99+" : dmUnreadCount}
                </span>
              )}
            </span>
            <span className="text-[10px]">その他</span>
          </button>
        </div>
      </nav>

      {/* その他メニュー
          条件付きマウント({showMore && ...})だと iOS WKWebView でリンクの
          navigation が壊れるケースがあったため、常にマウントして CSS で
          visibility を切り替える方式に変更。 */}
      <div
        data-more-popover
        aria-hidden={!showMore}
        className={`fixed bottom-14 left-0 right-0 z-[56] mx-4 rounded-2xl bg-surface border border-border p-4 shadow-xl lg:hidden transition-opacity ${
          showMore ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
            <div className="grid grid-cols-3 gap-3">
              <Link
                href={`/${workspaceSlug}/search`}
                onClick={() => {
                  setShowMore(false);
                  setSidebarOpen(false);
                }}
                className="flex flex-col items-center gap-2 py-3 rounded-lg hover:bg-sidebar-hover transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">検索</span>
              </Link>
              <Link
                href={`/${workspaceSlug}/dm-list`}
                onClick={() => {
                  setShowMore(false);
                  setSidebarOpen(false);
                }}
                className="flex flex-col items-center gap-2 py-3 rounded-lg hover:bg-sidebar-hover transition-colors"
              >
                <span className="relative w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {dmUnreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold leading-[18px] text-center">
                      {dmUnreadCount > 99 ? "99+" : dmUnreadCount}
                    </span>
                  )}
                </span>
                <span className="text-xs text-foreground">DM</span>
              </Link>
              <Link
                href={`/${workspaceSlug}/files`}
                onClick={() => {
                  setShowMore(false);
                  setSidebarOpen(false);
                }}
                className="flex flex-col items-center gap-2 py-3 rounded-lg hover:bg-sidebar-hover transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">ファイル</span>
              </Link>
              <button
                onClick={() => { setShowMore(false); setShowBookmark(true); }}
                className="flex flex-col items-center gap-2 py-3 rounded-lg hover:bg-sidebar-hover transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">ブックマーク</span>
              </button>
              <button
                onClick={() => { setShowMore(false); setShowMembers(true); }}
                className="flex flex-col items-center gap-2 py-3 rounded-lg hover:bg-sidebar-hover transition-colors"
              >
                <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </span>
                <span className="text-xs text-foreground">メンバー</span>
              </button>
            </div>
      </div>

      {/* クイック投稿シート */}
      {showQuickPost && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center lg:hidden"
          onClick={() => setShowQuickPost(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg rounded-t-[24px] bg-surface p-5 pb-20 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-border" />
            <button
              type="button"
              onClick={() => setShowQuickPost(false)}
              className="absolute right-4 top-4 text-muted hover:text-foreground transition-colors"
              aria-label="閉じる"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              type="button"
              className={`flex h-[46px] w-full items-center justify-between rounded-2xl border px-4 text-left transition-colors ${
                quickPostTarget
                  ? "border-border bg-background-soft"
                  : "border-sky/45 bg-background-soft"
              }`}
            >
              <span className="text-[14px] font-semibold">
                <span className="text-muted">投稿先: </span>
                <span className={quickPostTarget ? "text-foreground" : "text-accent"}>
                  {quickPostTarget || "チャンネルを選択"}
                </span>
              </span>
              <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-muted">最近使ったチャンネル</span>
              <button type="button" className="inline-flex items-center gap-1 text-[12px] text-muted">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                検索
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recentTargets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => setQuickPostTarget(target.name)}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                    quickPostTarget === target.name
                      ? "bg-sky-soft text-foreground ring-1 ring-sky/30"
                      : "bg-background-soft text-foreground hover:bg-sidebar-hover"
                  }`}
                >
                  # {target.name}
                </button>
              ))}
            </div>
            <textarea
              value={quickPostText}
              onChange={(e) => setQuickPostText(e.target.value)}
              placeholder="メッセージを入力..."
              className="mt-5 h-[112px] w-full resize-none rounded-2xl border-0 bg-background-soft px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-muted"
            />
            <div className="mt-4 flex items-center gap-5">
              <button type="button" className="text-muted hover:text-foreground">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94a3 3 0 114.243 4.243L8.552 18.32a1.5 1.5 0 11-2.121-2.121l9.192-9.193" />
                </svg>
              </button>
              <button type="button" className="text-muted hover:text-foreground">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
              </button>
              <button
                type="button"
                disabled={!canQuickPost}
                className="ml-auto rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors disabled:bg-background-soft disabled:text-muted"
              >
                送信
              </button>
            </div>
          </div>
        </div>
      )}

      {showBookmark && (
        <BookmarkModal
          currentUserId={currentUserId}
          workspaceSlug={workspaceSlug}
          onClose={() => setShowBookmark(false)}
        />
      )}

      {showMembers && (
        <WsMembersModal
          members={members}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          onClose={() => setShowMembers(false)}
        />
      )}
    </>
  );
}
