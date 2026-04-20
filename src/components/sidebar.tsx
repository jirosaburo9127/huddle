"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Workspace, Channel } from "@/lib/supabase/types";
import type { WorkspaceCategory } from "@/lib/channel-categories";
import { UNCATEGORIZED_LABEL } from "@/lib/channel-categories";
import { CreateChannelModal } from "@/components/create-channel-modal";
import { CreateDmModal } from "@/components/create-dm-modal";
import { InviteModal } from "@/components/invite-modal";
import { BookmarkModal } from "@/components/bookmark-modal";
import { WsMembersModal } from "@/components/ws-members-modal";
import { ThemeSelector } from "@/components/theme-selector";
import { MfaSetup } from "@/components/mfa-setup";
import { SecuritySettings } from "@/components/security-settings";
import { signOut } from "@/lib/actions";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";
import { showMessageNotification } from "@/lib/notification";
import { setupPushNotifications, syncAppBadgeFromServer } from "@/lib/push-notifications";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import type { Message } from "@/lib/supabase/types";

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

type SidebarProps = {
  workspace: Workspace;
  channels: Channel[];
  dmChannels: Channel[];
  members: WorkspaceMember[];
  currentUserId: string;
  workspaceSlug: string;
  unreadCounts?: Record<string, number>;
  allWorkspaces: Array<{ id: string; name: string; slug: string }>;
  categories?: WorkspaceCategory[];
};

export function Sidebar({
  workspace,
  channels,
  dmChannels,
  members,
  currentUserId,
  workspaceSlug,
  unreadCounts = {},
  allWorkspaces,
  categories = [],
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  // 未読カウントをローカルstate化（Realtime+クリックで更新するため）
  // NOTE: prop → state のシンク useEffect は意図的に置いていない。
  // サーバーアクション等で親が revalidate されると unreadCounts の参照が
  // 毎回新しくなるため、シンクすると無限ループ（React error #185）を起こす。
  // WS切替時は layout が再マウントされるので初期値で十分。
  const [unreadState, setUnreadState] = useState<Record<string, number>>(unreadCounts);
  // ワークスペース単位の未読カウント（他WSにメッセージが来たことを一目で伝えるため）
  const [unreadByWorkspace, setUnreadByWorkspace] = useState<Record<string, number>>({});
  // 決定事項ボードの未読数 (自分が最後に見た時刻以降に追加された決定の数)
  const [decisionUnreadCount, setDecisionUnreadCount] = useState<number>(0);
  // Sidebar専用のSupabaseクライアント（毎レンダー再生成しない）
  const sidebarSupabaseRef = useRef(createClient());
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateDm, setShowCreateDm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [showWsMembers, setShowWsMembers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWsSwitcher, setShowWsSwitcher] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [catList, setCatList] = useState(categories);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [catAdding, setCatAdding] = useState(false);
  const [catError, setCatError] = useState("");

  async function handleAddCategory() {
    if (!newCatLabel.trim() || catAdding) return;
    setCatAdding(true);
    setCatError("");
    const supabase = sidebarSupabaseRef.current;
    const { data, error } = await supabase.rpc("add_workspace_category", {
      p_workspace_id: workspace.id,
      p_label: newCatLabel.trim(),
    });
    if (error) {
      setCatError(error.message);
    } else if (data) {
      const row = data as unknown as { slug: string; label: string; sort_order: number };
      setCatList((prev) => [...prev, row]);
      setNewCatLabel("");
    }
    setCatAdding(false);
  }
  const wsSwitcherRef = useRef<HTMLDivElement>(null);
  // zustand セレクタ形式で購読範囲を限定（不要な再レンダーを防ぐ）
  const sidebarOpen = useMobileNavStore((s) => s.sidebarOpen);
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const [searchQuery, setSearchQuery] = useState("");

  // プロフィール編集用のstate
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileToast, setProfileToast] = useState(false);
  const [profileUploading, setProfileUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // 設定モーダルが開いたらプロフィールを取得
  const loadProfile = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", currentUserId)
      .single();
    if (data) {
      setProfileDisplayName(data.display_name || "");
      setProfileAvatarUrl(data.avatar_url);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (showSettings) {
      loadProfile();
    }
  }, [showSettings, loadProfile]);

  // アバター画像アップロード処理
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "png";
      const path = `avatars/${currentUserId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("chat-files")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from("chat-files")
        .getPublicUrl(path);
      setProfileAvatarUrl(urlData.publicUrl);
    } catch (err) {
      console.error("アバターアップロードエラー:", err);
    } finally {
      setProfileUploading(false);
      // inputをリセットして同じファイルも再選択可能にする
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  };

  // プロフィール保存処理
  const handleProfileSave = async () => {
    if (!profileDisplayName.trim()) return;
    setProfileSaving(true);
    try {
      const supabase = createClient();
      await supabase
        .from("profiles")
        .update({
          display_name: profileDisplayName.trim(),
          avatar_url: profileAvatarUrl,
        })
        .eq("id", currentUserId);
      setProfileToast(true);
      setTimeout(() => setProfileToast(false), 2000);
    } catch (err) {
      console.error("プロフィール保存エラー:", err);
    } finally {
      setProfileSaving(false);
    }
  };

  // 現在開いているチャンネルのID（pathname → slug → channel）
  const currentChannelId = useMemo(() => {
    const slug = pathname.split("/")[2]; // /[workspace]/[channel]
    if (!slug) return null;
    const found = [...channels, ...dmChannels].find((c) => c.slug === slug);
    return found?.id ?? null;
  }, [pathname, channels, dmChannels]);

  // 表示中のチャンネルが切り替わったら:
  // 1. 楽観的にバッジを即消す
  // 2. DB の last_read_at を更新
  // ※ 以前は get_unread_counts で全チャンネルを再同期していたが、
  //   RPC が空を返すと他チャンネルのバッジも消える問題があったため、
  //   現在のチャンネルのバッジだけ消す方式に変更。
  useEffect(() => {
    if (!currentChannelId) return;

    // 楽観的にバッジを即消す
    setUnreadState((prev) => {
      if (!prev[currentChannelId]) return prev;
      const next = { ...prev };
      delete next[currentChannelId];
      return next;
    });

    // サーバの now() で last_read_at を更新する
    const supabase = sidebarSupabaseRef.current;
    supabase.rpc("mark_channel_read", { p_channel_id: currentChannelId });
  }, [currentChannelId]);

  // ブラウザ通知許可リクエスト（マウント時に一度だけ）
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ネイティブプッシュ通知（Capacitor）のセットアップ
  // Web ブラウザでは中で early return するので副作用なし
  useEffect(() => {
    setupPushNotifications(currentUserId);
  }, [currentUserId]);

  // タブタイトルに未読数を表示（Chatwork風: (3) Huddle）
  useEffect(() => {
    const total = Object.values(unreadState).reduce((sum, n) => sum + n, 0);
    document.title = total > 0 ? `(${total}) Huddle` : "Huddle";
  }, [unreadState]);

  // フォアグラウンド復帰時 / マウント時 / ワークスペース切替時に未読カウントを再同期
  // モバイルで画面オフ→復帰した際にRealtime取りこぼしを補完するのと、
  // SSRから渡された unreadCounts がRSCキャッシュで古い場合の補正も兼ねる
  useEffect(() => {
    let cancelled = false;
    async function refetchUnread() {
      const supabase = sidebarSupabaseRef.current;
      // チャンネル単位とワークスペース単位 + 決定事項未読を並列取得
      const [channelRes, wsRes, decisionRes] = await Promise.all([
        supabase.rpc("get_unread_counts", { p_user_id: currentUserId }),
        supabase.rpc("get_unread_counts_by_workspace", { p_user_id: currentUserId }),
        supabase.rpc("get_decision_unread_count", {
          p_workspace_id: workspace.id,
          p_user_id: currentUserId,
        }),
      ]);
      if (cancelled) return;

      if (typeof decisionRes.data === "number") {
        setDecisionUnreadCount(decisionRes.data);
      }

      if (channelRes.data && Array.isArray(channelRes.data)) {
        // サーバデータをマージ: サーバが返したカウントで更新しつつ、
        // サーバに無い（=未読0の）チャンネルはローカルからも消す。
        // ただしサーバが空配列を返した場合はRPCエラーの可能性があるため
        // ローカルに未読がある場合はスキップして既存バッジを維持する。
        setUnreadState((prev) => {
          const serverCounts = channelRes.data as Array<{ channel_id: string; unread_count: number }>;
          // サーバが空なのにローカルに未読がある → RPCエラーの疑い → 既存維持
          const localHasUnread = Object.keys(prev).length > 0;
          if (serverCounts.length === 0 && localHasUnread) return prev;

          const next: Record<string, number> = {};
          for (const row of serverCounts) {
            if (row.channel_id === currentChannelId) continue;
            next[row.channel_id] = Number(row.unread_count);
          }
          return next;
        });
      }

      if (wsRes.data) {
        const nextWs: Record<string, number> = {};
        for (const row of wsRes.data as Array<{ workspace_id: string; unread_count: number }>) {
          // 現在見ているワークスペースは除外（自分のWS内のバッジはチャンネル側で表現されるので）
          if (row.workspace_id === workspace.id) continue;
          nextWs[row.workspace_id] = Number(row.unread_count);
        }
        setUnreadByWorkspace(nextWs);
      }

      // ネイティブ（iOS）アプリアイコンのバッジもここで一緒に同期
      syncAppBadgeFromServer(currentUserId);
    }

    // マウント直後・ワークスペース切替直後に必ず1回同期する
    refetchUnread();

    function onVisible() {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      refetchUnread();
    }

    // ダッシュボードが既読マークした瞬間にバッジを 0 にする
    function onDecisionsRead() {
      setDecisionUnreadCount(0);
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("huddle:decisionsRead", onDecisionsRead);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("huddle:decisionsRead", onDecisionsRead);
    };
    // currentChannelId を依存配列に含めない:
    // チャンネル切替ごとに get_unread_counts を呼ぶと、RPCの結果で
    // 他チャンネルのバッジも上書きされて消える問題があるため。
    // チャンネル切替時の既読処理は別の useEffect で行う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, workspace.id]);

  // ワークスペース内のメッセージを Realtime 購読（未読バッジ更新 + 通知）
  useEffect(() => {
    const supabase = sidebarSupabaseRef.current;
    const allChannels = [...channels, ...dmChannels];
    const channelById = new Map(allChannels.map((c) => [c.id, c]));

    const memberNameById = new Map<string, string>();
    for (const m of members) {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      if (p?.display_name) memberNameById.set(m.user_id, p.display_name);
    }

    const subscription = supabase
      .channel(`sidebar-unread-${workspace.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload: RealtimePostgresInsertPayload<Message>) => {
          const msg = payload.new;
          const isReply = !!msg.parent_id;

          // 決定登録のシステムメッセージ → 決定事項バッジを再取得
          if (msg.system_event === "decision_marked") {
            (async () => {
              const { data } = await supabase.rpc("get_decision_unread_count", {
                p_workspace_id: workspace.id,
                p_user_id: currentUserId,
              });
              if (typeof data === "number") {
                setDecisionUnreadCount(data);
              }
            })();
            return;
          }

          if (msg.user_id === currentUserId) return;
          const ch = channelById.get(msg.channel_id);
          if (!ch) {
            // 別ワークスペースのメッセージの可能性
            (async () => {
              const { data } = await supabase.rpc("get_unread_counts_by_workspace", {
                p_user_id: currentUserId,
              });
              if (!data) return;
              const nextWs: Record<string, number> = {};
              for (const row of data as Array<{ workspace_id: string; unread_count: number }>) {
                if (row.workspace_id === workspace.id) continue;
                nextWs[row.workspace_id] = Number(row.unread_count);
              }
              setUnreadByWorkspace(nextWs);
            })();
            return;
          }

          // 表示中チャンネル → 自動既読（ただし通知は出す — 別タブやバックグラウンド対応）
          if (msg.channel_id === currentChannelId) {
            supabase
              .rpc("mark_channel_read", { p_channel_id: msg.channel_id })
              .then(() => {});
            // 表示中チャンネルでもブラウザ通知は出す（フォーカス判定は showMessageNotification 内で行う）
          } else {
            // 未読カウント増加（返信メッセージはサーバー側 get_unread_counts と一致させるためスキップ）
            if (!isReply) {
              setUnreadState((prev) => ({
                ...prev,
                [msg.channel_id]: (prev[msg.channel_id] || 0) + 1,
              }));
            }
          }

          // ブラウザ通知 — 返信含むすべてのメッセージで通知（LINE方式）
          const senderName = memberNameById.get(msg.user_id) || "メンバー";
          let channelLabel = ch.name;
          if (ch.is_dm) {
            const dmCh = ch as unknown as {
              channel_members?: Array<{
                user_id: string;
                profiles?: { display_name?: string };
              }>;
            };
            const other = dmCh.channel_members?.find(
              (cm) => cm.user_id !== currentUserId
            );
            channelLabel = other?.profiles?.display_name || "DM";
          }
          showMessageNotification({
            senderName,
            channelName: channelLabel,
            content: msg.content,
            url: `/${workspaceSlug}/${ch.slug}`,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [channels, dmChannels, members, currentUserId, currentChannelId, workspace.id, workspaceSlug]);

  // ワークスペース切り替えドロップダウンの外側クリックで閉じる
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wsSwitcherRef.current && !wsSwitcherRef.current.contains(e.target as Node)) {
        setShowWsSwitcher(false);
      }
    }
    if (showWsSwitcher) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showWsSwitcher]);

  // 検索クエリでチャンネルとDMをフィルタリング
  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const q = searchQuery.toLowerCase();
    return channels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [channels, searchQuery]);

  const filteredDmChannels = useMemo(() => {
    if (!searchQuery.trim()) return dmChannels;
    const q = searchQuery.toLowerCase();
    return dmChannels.filter((dm) => {
      const dmWithMembers = dm as unknown as {
        channel_members: Array<{
          user_id: string;
          profiles: { display_name: string };
        }>;
      };
      const otherMembers = dmWithMembers.channel_members?.filter(
        (m) => m.user_id !== currentUserId
      );
      const name = otherMembers?.[0]?.profiles?.display_name || "DM";
      return name.toLowerCase().includes(q);
    });
  }, [dmChannels, searchQuery, currentUserId]);

  return (
    <>
      {/* サイドバー（モバイルではフルスクリーン表示） */}
      {/* transform ではなく display の切り替えで表示/非表示を制御する。
          translate-x 系の CSS 変数はブラウザのコンポジターが一瞬動かしてしまい
          「横スライド」に見える副作用があるので完全に使わない */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-full sm:w-64 bg-sidebar flex-col border-r border-border
          lg:relative lg:flex
          ${sidebarOpen ? "flex" : "hidden"}
        `}
      >
        {/* ヘッダー: 現在のワークスペースを一番目立たせる */}
        <div className="px-4 py-4 border-b border-border/50">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
            WORKSPACE
          </div>
          <div className="flex items-center gap-1">
          <div className="relative flex-1 min-w-0" ref={wsSwitcherRef}>
            <button
              onClick={() => setShowWsSwitcher((prev) => !prev)}
              className="flex items-center gap-1.5 text-lg font-bold text-foreground hover:text-accent transition-colors truncate w-full text-left"
            >
              <span className="truncate">{workspace.name}</span>
              {/* 他のワークスペースに未読がある時はドットを表示 */}
              {Object.keys(unreadByWorkspace).length > 0 && (
                <span
                  className="shrink-0 w-2.5 h-2.5 rounded-full bg-mention"
                  aria-label="他のワークスペースに未読あり"
                />
              )}
              <svg className="w-5 h-5 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* ワークスペース切り替えドロップダウン */}
            {showWsSwitcher && (
              <div className="absolute left-0 top-full mt-1 w-full bg-sidebar border border-border rounded-xl shadow-lg z-50 py-1 animate-fade-in">
                {allWorkspaces.map((ws) => {
                  const wsUnread = unreadByWorkspace[ws.id] || 0;
                  return (
                    <Link
                      key={ws.id}
                      href={`/${ws.slug}`}
                      prefetch
                      onClick={() => setShowWsSwitcher(false)}
                      className={`flex items-center justify-between gap-2 px-3 py-2 text-sm truncate transition-colors rounded-lg mx-1 ${
                        ws.id === workspace.id
                          ? "text-accent bg-accent/10 font-semibold"
                          : "text-foreground hover:bg-white/[0.04]"
                      }`}
                    >
                      <span className="truncate">{ws.name}</span>
                      {wsUnread > 0 && (
                        <span className="shrink-0 min-w-[20px] px-1.5 h-5 rounded-full bg-mention text-white text-[11px] font-bold flex items-center justify-center">
                          {wsUnread > 99 ? "99+" : wsUnread}
                        </span>
                      )}
                    </Link>
                  );
                })}
                <div className="border-t border-border/50 mt-1 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      setShowWsSwitcher(false);
                      const input = prompt(
                        "新しいワークスペース名を入力してください",
                        workspace.name
                      );
                      if (input === null) return;
                      const trimmed = input.trim();
                      if (!trimmed || trimmed === workspace.name) return;
                      const supabase = createClient();
                      const { data, error } = await supabase.rpc("rename_workspace", {
                        p_workspace_id: workspace.id,
                        p_new_name: trimmed,
                      });
                      if (error) {
                        alert("変更に失敗しました: " + error.message);
                        return;
                      }
                      // slug が変わるので新 URL に遷移
                      const ws = data as { slug: string } | null;
                      if (ws?.slug) {
                        window.location.href = `/${ws.slug}`;
                      } else {
                        window.location.reload();
                      }
                    }}
                    className="block w-full px-3 py-2 text-sm text-foreground hover:bg-white/[0.04] transition-colors rounded-lg mx-1 text-left"
                  >
                    このワークスペースの名前を変更
                  </button>
                  <Link
                    href="/?create=true"
                    onClick={() => setShowWsSwitcher(false)}
                    className="block px-3 py-2 text-sm text-muted hover:text-accent transition-colors rounded-lg mx-1 hover:bg-white/[0.04]"
                  >
                    + 新しいワークスペースを作成
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      setShowWsSwitcher(false);
                      const name = workspace.name;
                      const input = prompt(
                        `ワークスペース「${name}」を完全に削除しますか？\n\n` +
                        `すべてのチャンネル・メッセージ・決定事項が削除されます。\n` +
                        `確認のためワークスペース名を入力:`
                      );
                      if (input !== name) {
                        if (input !== null) alert("名前が一致しません");
                        return;
                      }
                      const supabase = createClient();
                      const { data, error } = await supabase.rpc("delete_workspace", {
                        p_workspace_id: workspace.id,
                      });
                      if (error) { alert("削除失敗: " + error.message); return; }
                      if (data?.error === "owner_only") { alert("オーナーのみ削除できます"); return; }
                      window.location.href = "/";
                    }}
                    className="block w-full px-3 py-2 text-sm text-mention hover:bg-mention/10 transition-colors rounded-lg mx-1 text-left"
                  >
                    このワークスペースを削除
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* WSメンバー一覧ボタン */}
          <button
            onClick={() => setShowWsMembers(true)}
            className="shrink-0 p-1.5 text-muted hover:text-foreground rounded-lg hover:bg-white/[0.04] transition-colors"
            title="ワークスペースメンバー"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </button>
          </div>
        </div>

        {/* 検索バー */}
        <div className="px-3 py-2">
          <input
            type="text"
            placeholder="チャンネルを検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background/50 rounded-xl px-3 py-2 text-base border border-border/50 focus:border-accent focus:bg-input-bg placeholder-muted/60 transition-all outline-none"
          />
        </div>

        {/* チャンネル・DM一覧 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          {/* 決定事項ダッシュボードリンク */}
          <Link
            href={`/${workspaceSlug}/dashboard`}
            prefetch
            onClick={() => setSidebarOpen(false)}
            className={`flex items-center gap-2 px-3 py-2 text-[13px] mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mb-1 ${
              decisionUnreadCount > 0 ? "text-accent font-semibold" : "text-muted hover:text-accent"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1 text-left">決定事項</span>
            {decisionUnreadCount > 0 && (
              <span className="bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {decisionUnreadCount > 99 ? "99+" : decisionUnreadCount}
              </span>
            )}
          </Link>

          {/* 進行中ダッシュボードリンク */}
          <Link
            href={`/${workspaceSlug}/in-progress`}
            prefetch
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted hover:text-accent mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mb-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="flex-1 text-left">進行中</span>
          </Link>

          {/* ブックマークリンク */}
          <button
            onClick={() => setShowBookmarkModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted hover:text-accent mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mb-2"
          >
            <svg className="w-4 h-4" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            ブックマーク
          </button>

          {/* チャンネルセクション */}
          <div className="px-3 mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold uppercase text-muted tracking-wider">
              チャンネル
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setCatList(categories);
                  setCatError("");
                  setNewCatLabel("");
                  setShowCategoryManager(true);
                }}
                className="text-muted hover:text-accent transition-colors p-2 -m-1 rounded-lg hover:bg-white/[0.04]"
                title="カテゴリ管理"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              </button>
              <button
                onClick={() => setShowCreateChannel(true)}
                className="text-muted hover:text-accent transition-colors p-2 -m-1 rounded-lg hover:bg-white/[0.04]"
                title="チャンネル作成"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          <ChannelCategoryList
            channels={filteredChannels}
            categories={categories}
            workspaceSlug={workspaceSlug}
            pathname={pathname}
            unreadState={unreadState}
            onNavigate={() => setSidebarOpen(false)}
          />


          {/* DMセクション */}
          <div className="px-3 mt-4 mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold uppercase text-muted tracking-wider">
              ダイレクトメッセージ
            </span>
            <button
              onClick={() => setShowCreateDm(true)}
              className="text-muted hover:text-accent transition-colors p-2 -m-1 rounded-lg hover:bg-white/[0.04]"
              title="新しいメッセージ"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* DM一覧 */}
          {filteredDmChannels.map((dm) => {
            const href = `/${workspaceSlug}/${dm.slug}`;
            const isActive = pathname === href;
            const dmWithMembers = dm as unknown as {
              channel_members: Array<{
                user_id: string;
                profiles: {
                  display_name: string;
                  avatar_url: string | null;
                  status: string | null;
                  last_seen_at: string | null;
                };
              }>;
            };
            const otherMember = dmWithMembers.channel_members?.find(
              (m) => m.user_id !== currentUserId
            );
            const name =
              otherMember?.profiles?.display_name || "DM";
            const avatarUrl = otherMember?.profiles?.avatar_url;
            // ステータス取得
            const memberStatus = otherMember?.profiles?.status as string | null;
            // 5分以内のアクティビティでオンライン判定
            const lastSeen = otherMember?.profiles?.last_seen_at;
            const isOnline = lastSeen
              ? Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000
              : false;
            // ステータスに応じたドットカラー
            const statusDotColor = memberStatus === "focusing"
              ? "bg-yellow-500"
              : memberStatus === "away"
                ? "bg-muted/50"
                : isOnline
                  ? "bg-online"
                  : "bg-muted/50";
            const dmUnread = unreadState[dm.id] || 0;
            const dmShowUnreadStyle = dmUnread > 0 && !isActive;

            return (
              <Link
                key={dm.id}
                href={href}
                prefetch
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-2 px-3 py-2 text-base rounded-xl mx-2 transition-colors
                  ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:text-foreground hover:bg-white/[0.04]"
                  }
                `}
              >
                {/* アバター + オンラインドット */}
                <span className="relative shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={name}
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-medium text-accent">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar ${statusDotColor}`}
                  />
                </span>
                <span
                  className={`truncate ${dmShowUnreadStyle ? "font-semibold text-foreground" : ""}`}
                >
                  {name}
                </span>
                {dmShowUnreadStyle && (
                  <span className="ml-auto bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {dmUnread > 99 ? "99+" : dmUnread}
                  </span>
                )}
              </Link>
            );
          })}

          {/* メンバー招待ボタン */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted hover:text-accent mx-2 rounded-xl hover:bg-white/[0.04] transition-colors w-full mt-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
              />
            </svg>
            メンバーを招待
          </button>

          {/* 検索結果が空の場合 */}
          {searchQuery.trim() &&
            filteredChannels.length === 0 &&
            filteredDmChannels.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted">
                見つかりませんでした
              </div>
            )}
        </div>

        {/* 下部: ユーザー名 + ステータス + 設定 */}
        <div className="px-3 py-3 border-t border-border/50 space-y-2">
          <div className="flex items-center gap-2">
            {(() => {
              const me = members.find((m) => m.user_id === currentUserId);
              const profile = me?.profiles;
              const p = Array.isArray(profile) ? profile[0] : profile;
              const name = p?.display_name || "ユーザー";
              const initial = name[0].toUpperCase();
              return (
                <>
                  <span className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[11px] font-bold text-accent shrink-0">
                    {p?.avatar_url ? (
                      <img src={p.avatar_url} alt={name} className="w-7 h-7 rounded-full object-cover" />
                    ) : initial}
                  </span>
                  <span className="text-[13px] text-foreground truncate flex-1">{name}</span>
                </>
              );
            })()}
            {/* LP プレビュー（アプリ内から /about に直接ジャンプ） */}
            <a
              href="/about"
              className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-white/[0.04] shrink-0"
              title="LPプレビュー"
              aria-label="ランディングページを開く"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.6 9h16.8M3.6 15h16.8M11.25 3a17 17 0 000 18M12.75 3a17 17 0 010 18" />
              </svg>
            </a>
            <button
              onClick={() => setShowSettings(true)}
              className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-white/[0.04] shrink-0"
              title="設定"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <form
              action={signOut}
              onSubmit={(e) => {
                if (!confirm("ログアウトしますか？")) e.preventDefault();
              }}
            >
              <button
                type="submit"
                className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-white/[0.04] shrink-0"
                title="ログアウト"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* チャンネル作成モーダル */}
      {showCreateChannel && (
        <CreateChannelModal
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          members={members as Array<{ user_id: string; profiles: MemberProfile | MemberProfile[] }>}
          categories={categories}
          onClose={() => setShowCreateChannel(false)}
        />
      )}

      {/* DM作成モーダル */}
      {showCreateDm && (
        <CreateDmModal
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          members={members as Array<{ user_id: string; profiles: MemberProfile }>}
          onClose={() => setShowCreateDm(false)}
        />
      )}

      {/* 招待モーダル */}
      {showInviteModal && (
        <InviteModal
          workspaceId={workspace.id}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {/* ブックマークモーダル */}
      {showBookmarkModal && (
        <BookmarkModal
          currentUserId={currentUserId}
          workspaceSlug={workspaceSlug}
          onClose={() => setShowBookmarkModal(false)}
        />
      )}

      {/* WSメンバー一覧モーダル */}
      {showWsMembers && (
        <WsMembersModal
          members={members}
          workspaceId={workspace.id}
          currentUserId={currentUserId}
          onClose={() => setShowWsMembers(false)}
        />
      )}

      {/* カテゴリ管理モーダル */}
      {showCategoryManager && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowCategoryManager(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-sidebar border border-border p-5 space-y-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">カテゴリ管理</h3>
              <button
                onClick={() => setShowCategoryManager(false)}
                className="text-muted hover:text-foreground transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {catError && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{catError}</div>
            )}

            <div className="space-y-1 max-h-60 overflow-y-auto">
              {catList.map((cat, idx) => (
                <div
                  key={cat.slug}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-border/50"
                >
                  {/* 上下ボタン */}
                  <div className="flex flex-col shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={async () => {
                        const prev = catList[idx - 1];
                        setCatError("");
                        const supabase = sidebarSupabaseRef.current;
                        const { error } = await supabase.rpc("swap_category_order", {
                          p_workspace_id: workspace.id,
                          p_slug_a: cat.slug,
                          p_slug_b: prev.slug,
                        });
                        if (error) { setCatError(error.message); return; }
                        setCatList((list) => {
                          const next = [...list];
                          next[idx] = list[idx - 1];
                          next[idx - 1] = list[idx];
                          return next;
                        });
                      }}
                      className="text-muted hover:text-foreground disabled:opacity-20 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      disabled={idx === catList.length - 1}
                      onClick={async () => {
                        const next = catList[idx + 1];
                        setCatError("");
                        const supabase = sidebarSupabaseRef.current;
                        const { error } = await supabase.rpc("swap_category_order", {
                          p_workspace_id: workspace.id,
                          p_slug_a: cat.slug,
                          p_slug_b: next.slug,
                        });
                        if (error) { setCatError(error.message); return; }
                        setCatList((list) => {
                          const n = [...list];
                          n[idx] = list[idx + 1];
                          n[idx + 1] = list[idx];
                          return n;
                        });
                      }}
                      className="text-muted hover:text-foreground disabled:opacity-20 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  {/* カテゴリ名 */}
                  <span className="text-sm text-foreground flex-1 truncate">{cat.label}</span>
                  {/* 編集ボタン */}
                  <button
                    type="button"
                    onClick={async () => {
                      const input = prompt("カテゴリ名を変更", cat.label);
                      if (input === null || input.trim() === "" || input.trim() === cat.label) return;
                      setCatError("");
                      const supabase = sidebarSupabaseRef.current;
                      const { error } = await supabase.rpc("rename_workspace_category", {
                        p_workspace_id: workspace.id,
                        p_slug: cat.slug,
                        p_new_label: input.trim(),
                      });
                      if (error) { setCatError(error.message); return; }
                      setCatList((list) =>
                        list.map((c) => c.slug === cat.slug ? { ...c, label: input.trim() } : c)
                      );
                    }}
                    className="shrink-0 p-1 text-muted hover:text-accent rounded hover:bg-accent/10 transition-colors"
                    title="名前を変更"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {/* 削除ボタン */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`カテゴリ「${cat.label}」を削除しますか？\n該当チャンネルは「その他」に移動します。`)) return;
                      setCatError("");
                      const supabase = sidebarSupabaseRef.current;
                      const { error } = await supabase.rpc("delete_workspace_category", {
                        p_workspace_id: workspace.id,
                        p_slug: cat.slug,
                      });
                      if (error) {
                        setCatError(error.message);
                      } else {
                        setCatList((prev) => prev.filter((c) => c.slug !== cat.slug));
                      }
                    }}
                    className="shrink-0 p-1 text-muted hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
                    title="削除"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {catList.length === 0 && (
                <div className="text-xs text-muted py-2 text-center">カテゴリがありません</div>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newCatLabel}
                onChange={(e) => setNewCatLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                placeholder="新しいカテゴリ名"
                className="flex-1 rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                disabled={!newCatLabel.trim() || catAdding}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {catAdding ? "..." : "追加"}
              </button>
            </div>

            {/* 決定ボタン */}
            <button
              type="button"
              onClick={() => {
                setShowCategoryManager(false);
                // サイドバーに即反映するためページを再検証
                router.refresh();
              }}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              決定
            </button>
          </div>
        </div>
      )}

      {/* 設定モーダル */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSettings(false)}>
          <div
            className="w-full max-w-md max-h-[92vh] flex flex-col rounded-2xl bg-sidebar border border-border animate-fade-in overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー: 常に画面に残るよう sticky 相当に固定 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-sidebar shrink-0">
              <h2 className="text-lg font-bold">設定</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 text-muted hover:text-foreground rounded transition-colors"
                aria-label="閉じる"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* スクロール可能なボディ */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* プロフィール */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">プロフィール</h3>
              <div className="flex items-center gap-4 mb-4">
                {/* アバター（クリックで変更） */}
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative w-16 h-16 rounded-full shrink-0 overflow-hidden bg-accent/20 flex items-center justify-center hover:opacity-80 transition-opacity group"
                  disabled={profileUploading}
                >
                  {profileAvatarUrl ? (
                    <img
                      src={profileAvatarUrl}
                      alt="アバター"
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-bold text-accent">
                      {profileDisplayName ? profileDisplayName[0].toUpperCase() : "?"}
                    </span>
                  )}
                  {/* ホバー時のオーバーレイ */}
                  <span className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </span>
                  {profileUploading && (
                    <span className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-full">
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </span>
                  )}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
                <div className="flex-1">
                  <label className="text-xs text-muted mb-1 block">表示名</label>
                  <input
                    type="text"
                    value={profileDisplayName}
                    onChange={(e) => setProfileDisplayName(e.target.value)}
                    placeholder="表示名を入力"
                    className="w-full bg-background/50 rounded-xl px-3 py-2 text-sm border border-border/50 focus:border-accent focus:bg-input-bg placeholder-muted/60 transition-all outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleProfileSave}
                  disabled={profileSaving || !profileDisplayName.trim()}
                  className="px-4 py-2 text-sm rounded-xl bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {profileSaving ? "保存中..." : "保存"}
                </button>
                {profileToast && (
                  <span className="text-sm text-green-400 animate-fade-in">保存しました</span>
                )}
              </div>
            </div>

            {/* 2段階認証 */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">2段階認証</h3>
              <MfaSetup />
            </div>

            {/* テーマ */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">テーマ</h3>
              <ThemeSelector />
            </div>

            {/* セキュリティ（デバイス一覧・ログイン履歴・MFA状態） */}
            <SecuritySettings currentUserId={currentUserId} />

            {/* ログアウト */}
            <div className="pt-2 border-t border-border/50">
              <form
                action={signOut}
                onSubmit={(e) => {
                  if (!confirm("ログアウトしますか？")) e.preventDefault();
                }}
              >
                <button
                  type="submit"
                  className="px-4 py-2 text-sm rounded-xl border border-mention/30 text-mention hover:bg-mention/10 transition-colors"
                >
                  ログアウト
                </button>
              </form>
            </div>
            </div> {/* /scrollable body */}
          </div>
        </div>
      )}
    </>
  );
}

// ==================================================
// カテゴリ別チャンネルリスト
// Chatwork風タスクステータスでチャンネルをグループ化してサイドバーに表示する
// ==================================================
type ChannelCategoryListProps = {
  channels: Channel[];
  categories: WorkspaceCategory[];
  workspaceSlug: string;
  pathname: string;
  unreadState: Record<string, number>;
  onNavigate: () => void;
};

const COLLAPSED_KEY = "huddle:sidebar:collapsedCategories";

function ChannelCategoryList({
  channels,
  categories,
  workspaceSlug,
  pathname,
  unreadState,
  onNavigate,
}: ChannelCategoryListProps) {
  // 折りたたみ状態をlocalStorageに保存。初期値は「全カテゴリ折りたたみ」
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const all = new Set<string>(categories.map((c) => c.slug));
    all.add("__uncategorized__");
    return all;
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setCollapsed(new Set(arr));
      }
    } catch {
      // 破損した設定は無視
    }
  }, []);

  // アコーディオン方式: 1つ開くと他は全部閉じる
  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const wasOpen = !prev.has(key);
      let next: Set<string>;
      if (wasOpen) {
        // 既に開いていた → 閉じる
        next = new Set(prev);
        next.add(key);
      } else {
        // 閉じていた → 開く（他は全部閉じる）
        const allKeys = categories.map((c) => c.slug);
        allKeys.push("__uncategorized__");
        next = new Set(allKeys);
        next.delete(key);
      }
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // localStorage使えない環境は無視
      }
      return next;
    });
  }

  // カテゴリごとにチャンネルを振り分け
  const grouped = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const cat of categories) map.set(cat.slug, []);
    map.set("__uncategorized__", []);
    for (const ch of channels) {
      const key = ch.category ?? "__uncategorized__";
      const list = map.get(key);
      if (list) list.push(ch);
      else map.get("__uncategorized__")!.push(ch);
    }
    return map;
  }, [channels, categories]);

  // カテゴリラベルマップ
  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.slug, c.label);
    m.set("__uncategorized__", UNCATEGORIZED_LABEL);
    return m;
  }, [categories]);

  const sections = useMemo(() => [
    ...categories.map((c) => ({ key: c.slug, label: c.label })),
    { key: "__uncategorized__", label: UNCATEGORIZED_LABEL },
  ], [categories]);

  return (
    <div className="space-y-0.5">
      {sections.map(({ key, label }) => {
        const list = grouped.get(key) || [];
        if (list.length === 0) return null;
        const isCollapsed = collapsed.has(key);
        // カテゴリ内の未読合計
        const unreadTotal = list.reduce(
          (sum, ch) => sum + (unreadState[ch.id] || 0),
          0
        );
        return (
          <div key={key} className="mb-1">
            <button
              type="button"
              onClick={() => toggleCollapsed(key)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-muted hover:text-foreground transition-colors"
            >
              <svg
                className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                  isCollapsed ? "-rotate-90" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              <span className="flex-1 text-left">■ {label}</span>
              {isCollapsed && unreadTotal > 0 && (
                <span className="bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </span>
              )}
            </button>
            {!isCollapsed &&
              list.map((channel) => {
                const href = `/${workspaceSlug}/${channel.slug}`;
                const isActive = pathname === href;
                const unreadCount = unreadState[channel.id] || 0;
                const showUnreadStyle = unreadCount > 0 && !isActive;
                return (
                  <Link
                    key={channel.id}
                    href={href}
                    prefetch
                    onClick={onNavigate}
                    className={`
                      flex items-center min-w-0 px-3 py-2 text-base rounded-xl mx-2 transition-colors
                      ${
                        isActive
                          ? "bg-accent/10 text-accent"
                          : "text-muted hover:text-foreground hover:bg-white/[0.04]"
                      }
                    `}
                  >
                    <span
                      className={`mr-2 shrink-0 ${
                        isActive ? "text-accent/50" : "text-accent/50"
                      }`}
                    >
                      #
                    </span>
                    <span
                      className={`truncate min-w-0 flex-1 ${
                        showUnreadStyle ? "font-semibold text-foreground" : ""
                      }`}
                    >
                      {channel.name}
                    </span>
                    {showUnreadStyle && (
                      <span className="ml-auto bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </Link>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
