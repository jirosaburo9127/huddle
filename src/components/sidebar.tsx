"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PullToRefresh } from "@/components/pull-to-refresh";
import type { Workspace, Channel } from "@/lib/supabase/types";
import type { WorkspaceCategory } from "@/lib/channel-categories";
import { UNCATEGORIZED_LABEL, CATEGORY_COLORS } from "@/lib/channel-categories";
import { CreateChannelModal } from "@/components/create-channel-modal";
import { CreateDmModal } from "@/components/create-dm-modal";
import { InviteModal } from "@/components/invite-modal";
import { BookmarkModal } from "@/components/bookmark-modal";
import { WsMembersModal } from "@/components/ws-members-modal";
import { ChannelMembersModal } from "@/components/channel-members-modal";
import { ActivityModal } from "@/components/activity-modal";
import { ThemeSelector } from "@/components/theme-selector";
import { MfaSetup } from "@/components/mfa-setup";
import { SecuritySettings } from "@/components/security-settings";
import { signOut } from "@/lib/actions";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { useUnreadStore } from "@/stores/unread-store";
import { createClient } from "@/lib/supabase/client";
import { showMessageNotification } from "@/lib/notification";
import { setupPushNotifications, syncAppBadgeFromServer } from "@/lib/push-notifications";
import { setupAppStateHandler } from "@/lib/app-state";
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

type SearchResult = {
  id: string;
  content: string;
  created_at: string;
  channel_name: string;
  channel_slug: string;
  sender_name: string;
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
  hitorigotoChannel?: { id: string; slug: string; name: string } | null;
  isMaster?: boolean;
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
  hitorigotoChannel,
  isMaster = false,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  // 未読カウントをローカルstate化（Realtime+クリックで更新するため）
  // NOTE: prop → state のシンク useEffect は意図的に置いていない。
  // サーバーアクション等で親が revalidate されると unreadCounts の参照が
  // 毎回新しくなるため、シンクすると無限ループ（React error #185）を起こす。
  // WS切替時は layout が再マウントされるので初期値で十分。
  const [unreadState, setUnreadState] = useState<Record<string, number>>(unreadCounts);
  // カテゴリ変更をRSC再検証なしで即反映するためのオーバーライド
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string | null>>({});
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
  const [storageUsageMB, setStorageUsageMB] = useState<number | null>(null);
  const [settingsEmail, setSettingsEmail] = useState("");
  const [settingsNewEmail, setSettingsNewEmail] = useState("");
  const [settingsEmailSaving, setSettingsEmailSaving] = useState(false);
  const [settingsEmailMsg, setSettingsEmailMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showWsSwitcher, setShowWsSwitcher] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [catList, setCatList] = useState<WorkspaceCategory[]>(categories);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newCatColor, setNewCatColor] = useState<string | null>(null);
  const [catAdding, setCatAdding] = useState(false);
  const [catError, setCatError] = useState("");
  // 各チャンネルの所属ユーザーID (チャンネル行に参加者アバターを表示するため)
  const [channelMembersMap, setChannelMembersMap] = useState<Record<string, string[]>>({});
  // チャンネルメンバー一覧モーダル: 開いているチャンネルID (null = 閉)
  const [membersModalChannelId, setMembersModalChannelId] = useState<string | null>(null);
  // アクティビティ（自分の投稿へのリアクション通知）
  const [showActivity, setShowActivity] = useState(false);
  const [hasUnreadActivity, setHasUnreadActivity] = useState(false);
  // PC/モバイル判定（モックのスタイル差分を切り替えるため）
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(typeof window !== "undefined" && window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  // 独り言プレビュー（サイドバーに最新数件を横スクロール表示）
  const [hitorigotoPreview, setHitorigotoPreview] = useState<Array<{
    content: string;
    created_at: string;
    display_name: string;
    avatar_url: string | null;
  }>>([]);

  async function handleAddCategory() {
    if (!newCatLabel.trim() || catAdding) return;
    setCatAdding(true);
    setCatError("");
    const supabase = sidebarSupabaseRef.current;
    const { data, error } = await supabase.rpc("add_workspace_category", {
      p_workspace_id: workspace.id,
      p_label: newCatLabel.trim(),
      p_color: newCatColor,
    });
    if (error) {
      setCatError(error.message);
    } else if (data) {
      const row = data as unknown as { slug: string; label: string; sort_order: number; color: string | null };
      setCatList((prev) => [...prev, row]);
      setNewCatLabel("");
      setNewCatColor(null);
    }
    setCatAdding(false);
  }

  // 既存カテゴリの色変更（楽観的更新 + 失敗時ロールバック）
  async function handleChangeCategoryColor(slug: string, color: string | null) {
    setCatError("");
    const prev = catList;
    setCatList((list) => list.map((c) => (c.slug === slug ? { ...c, color } : c)));
    const supabase = sidebarSupabaseRef.current;
    const { error } = await supabase.rpc("update_workspace_category_color", {
      p_workspace_id: workspace.id,
      p_slug: slug,
      p_color: color,
    });
    if (error) {
      setCatError(error.message);
      setCatList(prev);
    }
  }
  const wsSwitcherRef = useRef<HTMLDivElement>(null);
  // zustand セレクタ形式で購読範囲を限定（不要な再レンダーを防ぐ）
  const sidebarOpen = useMobileNavStore((s) => s.sidebarOpen);
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const startDetailOpen = useMobileNavStore((s) => s.startDetailOpen);
  const pendingDetailOpen = useMobileNavStore((s) => s.pendingDetailOpen);
  const detailTransitionTitle = useMobileNavStore((s) => s.detailTransitionTitle);
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

  // 独り言プレビュー: 最新3件を取得する関数
  const fetchHitorigotoPreview = useCallback(async () => {
    if (!hitorigotoChannel) return;
    const supabase = sidebarSupabaseRef.current;
    const { data } = await supabase
      .from("messages")
      .select("content, created_at, profiles(display_name, avatar_url)")
      .eq("channel_id", hitorigotoChannel.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3);
    if (data) {
      setHitorigotoPreview(
        data.map((m: { content: string; created_at: string; profiles: { display_name: string; avatar_url: string | null } | { display_name: string; avatar_url: string | null }[] | null }) => {
          const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
          return {
            content: m.content,
            created_at: m.created_at,
            display_name: p?.display_name || "?",
            avatar_url: p?.avatar_url || null,
          };
        })
      );
    }
  }, [hitorigotoChannel]);

  // 初回取得 + Realtime購読で即時反映
  useEffect(() => {
    if (!hitorigotoChannel) return;
    fetchHitorigotoPreview();

    // Realtimeで独り言チャンネルの新規メッセージを監視
    const supabase = sidebarSupabaseRef.current;
    const subscription = supabase
      .channel(`hitorigoto-preview-${hitorigotoChannel.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `channel_id=eq.${hitorigotoChannel.id}` },
        () => { fetchHitorigotoPreview(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(subscription); };
  }, [hitorigotoChannel, fetchHitorigotoPreview]);

  useEffect(() => {
    if (showSettings) {
      loadProfile();
      // Storage使用量をDB経由で取得
      (async () => {
        const supabase = sidebarSupabaseRef.current;
        const { data, error } = await supabase.rpc("get_storage_usage");
        if (!error && data !== null) {
          setStorageUsageMB(Math.round((data as number) / 1024 / 1024));
        } else {
          setStorageUsageMB(0);
        }
      })();
      // メールアドレス取得
      (async () => {
        const supabase = sidebarSupabaseRef.current;
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) setSettingsEmail(user.email);
      })();
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
  // 独り言チャンネルは別フィールド (hitorigotoChannel) に入っているので、
  // ここで明示的に含めないとポーリングのスキップ判定や Realtime 即時バッジ消しが
  // できない（既読化自体は ChannelView の責務）
  const currentChannelId = useMemo(() => {
    const slug = pathname.split("/")[2]; // /[workspace]/[channel]
    if (!slug) return null;
    if (hitorigotoChannel?.slug === slug) return hitorigotoChannel.id;
    const found = [...channels, ...dmChannels].find((c) => c.slug === slug);
    return found?.id ?? null;
  }, [pathname, channels, dmChannels, hitorigotoChannel]);

  const dmUnreadTotal = useMemo(
    () => dmChannels.reduce((sum, dm) => sum + (unreadState[dm.id] || 0), 0),
    [dmChannels, unreadState]
  );

  const inProgressCount = useMemo(() => {
    const progressSlugs = new Set(
      categories
        .filter((cat) => cat.label.includes("進行中"))
        .map((cat) => cat.slug)
    );
    return channels.filter((ch) => {
      const category = ch.id in categoryOverrides ? categoryOverrides[ch.id] : ch.category;
      return category ? progressSlugs.has(category) : false;
    }).length;
  }, [channels, categories, categoryOverrides]);

  // polling の refetchUnread は [currentUserId, workspace.id] だけに依存させているため
  // currentChannelId はクロージャで初期値に固定される。最新値を参照するため ref を使う
  const currentChannelIdRef = useRef<string | null>(currentChannelId);
  useEffect(() => {
    currentChannelIdRef.current = currentChannelId;
  }, [currentChannelId]);

  // チャンネル ID ごとに「最後に楽観的削除した時刻 (ms)」を記録する。
  // mark_channel_read の DB 反映前に走るポーリングがサーバの古い値で
  // バッジを復活させてしまうのを防ぐため、ガード時間内 (READ_GUARD_MS) は
  // そのチャンネルだけサーバ値を採用しない。
  // 単一の Map で管理することで、過去にあった「全バッジ消失」「ad-hoc 空配列ガード」
  // 「current チャンネルだけ除外」といった条件分岐の重なりを排除する。
  const lastOptimisticReadRef = useRef<Map<string, number>>(new Map());
  const READ_GUARD_MS = 30000;

  // 既読化の責務は ChannelView に移管したので、Sidebar から mark_channel_read は呼ばない。
  // (URL 推測でチャンネル ID を起点に既読化していたが、ChannelView マウントで一元化)
  //
  // ChannelView がマウント時に mark_channel_read を実行 → 戻り値の last_read_at を
  // huddle:channelRead イベントで通知。Sidebar はその event を受けてバッジを消す。
  useEffect(() => {
    function onChannelRead(e: Event) {
      const detail = (e as CustomEvent).detail as { channelId?: string } | undefined;
      const channelId = detail?.channelId;
      if (!channelId) return;
      // 1. バッジ即時削除
      setUnreadState((prev) => {
        if (!prev[channelId]) return prev;
        const next = { ...prev };
        delete next[channelId];
        return next;
      });
      // 2. ポーリングが古いサーバ値で復活させないようガード時刻を記録
      lastOptimisticReadRef.current.set(channelId, Date.now());
      // 2.5. 進行中の refetchUnread レスポンスを無効化（既読化より前に発行されたリクエストのため）
      unreadGenerationRef.current++;
      // 3. アプリバッジはunreadState変更で自動反映される
    }
    window.addEventListener("huddle:channelRead", onChannelRead);
    return () => window.removeEventListener("huddle:channelRead", onChannelRead);
  }, [currentUserId]);

  // カテゴリ変更イベントで即反映（router.refresh()の代替）
  useEffect(() => {
    const handler = (e: Event) => {
      const { channelId, category } = (e as CustomEvent<{ channelId: string; category: string | null }>).detail;
      setCategoryOverrides((prev) => ({ ...prev, [channelId]: category }));
    };
    window.addEventListener("huddle:categoryChanged", handler);
    return () => window.removeEventListener("huddle:categoryChanged", handler);
  }, []);

  // 各チャンネルの所属ユーザーIDを取得（チャンネル行のメンバーアバター表示用）
  useEffect(() => {
    let cancelled = false;
    async function fetchChannelMembers() {
      const supabase = sidebarSupabaseRef.current;
      const ids = channels.map((c) => c.id);
      if (ids.length === 0) {
        if (!cancelled) setChannelMembersMap({});
        return;
      }
      const { data } = await supabase
        .from("channel_members")
        .select("channel_id, user_id")
        .in("channel_id", ids);
      if (cancelled || !data) return;
      const next: Record<string, string[]> = {};
      for (const row of data as Array<{ channel_id: string; user_id: string }>) {
        if (!next[row.channel_id]) next[row.channel_id] = [];
        next[row.channel_id].push(row.user_id);
      }
      setChannelMembersMap(next);
    }
    fetchChannelMembers();
    return () => { cancelled = true; };
  }, [channels]);

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
    // iOS Capacitor の appStateChange を huddle:appResumed に橋渡し
    // （visibilitychange / focus が復帰時に発火しないケースの救済）
    setupAppStateHandler();
  }, [currentUserId]);

  // タブタイトル + アプリバッジに未読数を反映
  // unreadStateは独り言除外済みなので安全
  useEffect(() => {
    const channelTotal = Object.values(unreadState).reduce((sum, n) => sum + n, 0);
    const otherWsTotal = Object.values(unreadByWorkspace).reduce((sum, n) => sum + n, 0);
    const total = channelTotal + otherWsTotal;
    document.title = total > 0 ? `(${total}) Huddle` : "Huddle";
    // アプリバッジもunreadStateベースで設定（独り言除外済み）
    import("@capacitor/core").then(({ Capacitor }) => {
      if (!Capacitor.isNativePlatform()) return;
      import("@capawesome/capacitor-badge").then(({ Badge }) => {
        Badge.set({ count: Math.max(0, total) }).catch(() => {});
      }).catch(() => {});
    }).catch(() => {});
  }, [unreadState, unreadByWorkspace]);

  // DM の未読合計を Zustand に書き出し、BottomTabBar の「その他」「DM」に
  // バッジ表示できるようにする
  const setDmUnreadCount = useUnreadStore((s) => s.setDmUnreadCount);
  useEffect(() => {
    const dmIds = new Set(dmChannels.map((c) => c.id));
    const dmTotal = Object.entries(unreadState).reduce(
      (sum, [id, n]) => (dmIds.has(id) ? sum + n : sum),
      0
    );
    setDmUnreadCount(dmTotal);
  }, [unreadState, dmChannels, setDmUnreadCount]);

  // フォアグラウンド復帰時 / マウント時 / ワークスペース切替時に未読カウントを再同期
  // モバイルで画面オフ→復帰した際にRealtime取りこぼしを補完するのと、
  // SSRから渡された unreadCounts がRSCキャッシュで古い場合の補正も兼ねる
  // refetchUnread の世代番号。古いレスポンスが新しい既読イベント後に state を上書きしないようにする
  const unreadGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function refetchUnread() {
      const generation = ++unreadGenerationRef.current;
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
      // 古い世代のレスポンスは捨てる（既読化が間に挟まった場合のバッジ復活防止）
      if (cancelled || generation !== unreadGenerationRef.current) return;

      if (typeof decisionRes.data === "number") {
        setDecisionUnreadCount(decisionRes.data);
      }

      // 通信エラー時のみ local を維持する (サーバから「空配列」を信頼する設計に変更)。
      // 以前は serverCounts.length === 0 && prev > 0 のとき local を維持していたが、
      // これが「既読化したのにバッジが復活する」事故の主因だったので撤去。
      // 真実の源はサーバ。READ_GUARD_MS の時間ベースガードだけで吸収する。
      if (channelRes.error) {
        // ネットワークエラー等。前回値を保持して次回ポーリングを待つ。
        // do nothing.
      } else if (Array.isArray(channelRes.data)) {
        const serverCounts = channelRes.data as Array<{ channel_id: string; unread_count: number }>;
        const currentId = currentChannelIdRef.current;
        const now = Date.now();
        setUnreadState(() => {
          const hitorigotoId = hitorigotoChannel?.id;
          const next: Record<string, number> = {};
          for (const row of serverCounts) {
            if (row.channel_id === currentId) continue;
            if (row.channel_id === hitorigotoId) continue;
            const lastReadAt = lastOptimisticReadRef.current.get(row.channel_id);
            if (lastReadAt && now - lastReadAt < READ_GUARD_MS) continue;
            const count = Number(row.unread_count);
            if (count > 0) next[row.channel_id] = count;
          }
          // ガード期限切れのエントリを掃除（メモリリーク防止）
          for (const [chId, ts] of lastOptimisticReadRef.current) {
            if (now - ts >= READ_GUARD_MS) lastOptimisticReadRef.current.delete(chId);
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

      // アプリバッジはunreadState変更時のuseEffectで自動同期（独り言除外済み）

      // アクティビティ (自分の投稿へのリアクション) 未読判定（現WSのみ）
      const { data: hasAct } = await supabase.rpc("has_unread_activity", {
        p_user_id: currentUserId,
        p_workspace_id: workspace.id,
      });
      if (!cancelled && typeof hasAct === "boolean") {
        setHasUnreadActivity(hasAct);
      }
    }

    // マウント直後・ワークスペース切替直後に必ず1回同期する
    refetchUnread();

    function onVisible() {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      refetchUnread();
    }

    // iOS Capacitor: app-state.ts が appStateChange を受けてディスパッチするイベント
    function onAppResume() {
      refetchUnread();
    }

    // ダッシュボードが既読マークした瞬間にバッジを 0 にする
    function onDecisionsRead() {
      setDecisionUnreadCount(0);
    }

    // アクティビティモーダルで既読にした瞬間にバッジを消す
    function onActivitySeen() {
      setHasUnreadActivity(false);
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("huddle:appResumed", onAppResume);
    window.addEventListener("huddle:decisionsRead", onDecisionsRead);
    window.addEventListener("huddle:activitySeen", onActivitySeen);

    // 5秒ごとにサーバーと同期（Realtime取りこぼし+既読状態の安定化）
    // 10秒だとドリフトが目立ちやすかったので半分に短縮
    const poll = setInterval(refetchUnread, 5000);

    // 5分ごとに「フル再同期」: ローカル state と楽観的削除フラグをすべてクリアして、
    // サーバの真実だけを取りに行く。長時間使用時のドリフト解消のため。
    const FULL_RESYNC_INTERVAL_MS = 5 * 60 * 1000;
    const fullResync = setInterval(() => {
      if (cancelled) return;
      // 楽観的削除フラグを全クリア（サーバ値をそのまま受け入れる）
      lastOptimisticReadRef.current.clear();
      refetchUnread();
    }, FULL_RESYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(fullResync);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("huddle:appResumed", onAppResume);
      window.removeEventListener("huddle:decisionsRead", onDecisionsRead);
      window.removeEventListener("huddle:activitySeen", onActivitySeen);
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

          // 表示中チャンネル → ChannelView 側の Realtime ハンドラが mark_channel_read を実行し
          // huddle:channelRead イベントで通知してくる。Sidebar はバッジを即時に消すだけ。
          // (RPC を二重に呼ばないことで責務分離を維持し、ChannelView を唯一の既読源にする)
          if (msg.channel_id === currentChannelId) {
            setUnreadState((prev) => {
              if (!prev[msg.channel_id]) return prev;
              const next = { ...prev };
              delete next[msg.channel_id];
              return next;
            });
            lastOptimisticReadRef.current.set(msg.channel_id, Date.now());
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
            url: `/${workspaceSlug}/${ch.slug}?m=${msg.id}`,
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
      {/* サイドバー（モバイルでは一覧画面として常駐。詳細画面が右から重なる） */}
      <aside
        data-sidebar
        className={`
          fixed top-0 bottom-14 left-0 z-40 w-full sm:w-64 bg-surface lg:bg-sidebar flex flex-col lg:border-r lg:border-border/50
          transform-gpu transition-transform duration-200 ease-out
          lg:bottom-0 lg:relative lg:z-auto lg:translate-x-0 lg:transform-none
          ${sidebarOpen ? "translate-x-0 pointer-events-auto" : "-translate-x-[24%] pointer-events-none lg:pointer-events-auto"}
        `}
      >
        {/* ヘッダー — モック準拠インラインスタイル */}
        <div
          className="shrink-0 flex items-center"
          style={{ padding: "12px 16px", height: 56, background: isDesktop ? "var(--color-sidebar)" : "var(--color-surface)" }}
        >
          {/* 左: WS名 + シェブロン */}
          <div className="relative" style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} ref={wsSwitcherRef}>
            <button
              onClick={() => setShowWsSwitcher((prev) => !prev)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer" }}
            >
              {/* ロゴアイコン（PCのみ。モバイルモックにはない） */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {isDesktop && <img src="/icons/icon-192.png" alt="Huddle" style={{ width: 28, height: 28, borderRadius: 7 }} />}
              <span style={{ fontSize: isDesktop ? 14 : 17, fontWeight: isDesktop ? 700 : 650, color: "var(--color-foreground)", whiteSpace: "nowrap" }}>{workspace.name}</span>
              {Object.keys(unreadByWorkspace).length > 0 && (
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--color-mention)", flexShrink: 0 }} />
              )}
              <svg style={{ width: 16, height: 16, color: "var(--color-muted)" }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* ワークスペース切り替えドロップダウン */}
            {showWsSwitcher && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 animate-fade-in">
                {allWorkspaces.map((ws) => {
                  const wsUnread = unreadByWorkspace[ws.id] || 0;
                  return (
                    <a
                      key={ws.id}
                      href={`/${ws.slug}`}
                      onClick={() => setShowWsSwitcher(false)}
                      className={`flex items-center justify-between gap-2 px-3 py-2 text-sm truncate transition-colors rounded-lg mx-1 ${
                        ws.id === workspace.id
                          ? "text-accent bg-accent/10 font-semibold"
                          : "text-foreground hover:bg-sidebar-hover"
                      }`}
                    >
                      <span className="truncate">{ws.name}</span>
                      {wsUnread > 0 && (
                        <span className="shrink-0 min-w-[20px] px-1.5 h-5 rounded-full bg-mention text-white text-[11px] font-bold flex items-center justify-center">
                          {wsUnread > 99 ? "99+" : wsUnread}
                        </span>
                      )}
                    </a>
                  );
                })}
                <div className="border-t border-border/50 mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowWsSwitcher(false);
                      setShowInviteModal(true);
                    }}
                    className="block w-full px-3 py-2 text-sm text-foreground hover:bg-sidebar-hover transition-colors rounded-lg mx-1 text-left"
                  >
                    メンバーを招待
                  </button>
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
                    className="block w-full px-3 py-2 text-sm text-foreground hover:bg-sidebar-hover transition-colors rounded-lg mx-1 text-left"
                  >
                    このワークスペースの名前を変更
                  </button>
                  <Link
                    href="/?create=true"
                    onClick={() => setShowWsSwitcher(false)}
                    className="block px-3 py-2 text-sm text-muted hover:text-accent transition-colors rounded-lg mx-1 hover:bg-sidebar-hover"
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

          {/* 中: モバイルのみ進行中/決定チップ（ヘッダー行内、モック準拠） */}
          <div className="flex lg:hidden" style={{ gap: 4, marginLeft: "auto", marginRight: 2 }}>
            <Link
              href={`/${workspaceSlug}/in-progress`}
              onClick={() => setSidebarOpen(false)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", height: 28, borderRadius: 999, border: "none", cursor: "pointer", background: "#EAF8FF", textDecoration: "none" }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-foreground)" }}>進行中</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--color-sky)", width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
                {inProgressCount}
              </span>
            </Link>
            <Link
              href={`/${workspaceSlug}/dashboard`}
              onClick={() => setSidebarOpen(false)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", height: 28, borderRadius: 999, border: "none", cursor: "pointer", background: "#FFF1EA", textDecoration: "none" }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-foreground)" }}>決定</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--color-accent)", width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
                {decisionUnreadCount}
              </span>
            </Link>
          </div>

          {/* 右: アイコン群 — PC: 30px/18px/muted、モバイル: 44px/23px/fg */}
          <div style={{ display: "flex", gap: 0, alignItems: "center", marginLeft: isDesktop ? "auto" : 6 }}>
            {/* 検索（PCのみ） */}
            {isDesktop && (
              <Link
                href={`/${workspaceSlug}/search`}
                onClick={() => setSidebarOpen(false)}
                style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, color: "var(--color-muted)", cursor: "pointer" }}
                aria-label="検索"
              >
                <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </Link>
            )}
            {/* DM */}
            <Link
              href={`/${workspaceSlug}/dm-list`}
              onClick={() => setSidebarOpen(false)}
              style={{
                position: "relative",
                width: isDesktop ? 30 : 36, height: isDesktop ? 30 : 36,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: isDesktop ? 8 : 10,
                color: isDesktop ? "var(--color-muted)" : "var(--color-foreground)",
                marginRight: isDesktop ? 0 : -4,
              }}
              aria-label="DM"
            >
              <svg style={{ width: isDesktop ? 18 : 23, height: isDesktop ? 18 : 23, transform: isDesktop ? undefined : "translateY(-1px)" }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
              {dmUnreadTotal > 0 && (
                <span style={{ position: "absolute", top: 4, right: 2, width: 8, height: 8, borderRadius: "50%", background: "var(--color-accent)" }} />
              )}
            </Link>
            {/* ベル */}
            <button
              type="button"
              onClick={() => setShowActivity(true)}
              aria-label="アクティビティ"
              style={{
                position: "relative",
                width: isDesktop ? 30 : 36, height: isDesktop ? 30 : 36,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: isDesktop ? 8 : 10,
                background: "none", border: "none", cursor: "pointer",
                color: isDesktop ? "var(--color-muted)" : "var(--color-foreground)",
              }}
            >
              <svg style={{ width: isDesktop ? 18 : 23, height: isDesktop ? 18 : 23 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              {hasUnreadActivity && (
                <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "var(--color-accent)" }} />
              )}
            </button>
          </div>
        </div>

        {/* グラデーションライン（モバイルモック準拠、PCにはない） */}
        <div className="lg:hidden" style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />

        {/* 固定エリア: 進行中・決定 + 独り言 + カレンダー等 */}
        <div className="shrink-0" style={{ padding: "8px 12px 0" }}>
          {/* PC: 進行中・決定チップ（固定表示、独り言の上） */}
          <div className="hidden lg:flex" style={{ gap: 6, padding: "0 4px 6px", flexShrink: 0 }}>
            <Link
              href={`/${workspaceSlug}/in-progress`}
              onClick={() => setSidebarOpen(false)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "6px 0", height: 34,
                borderRadius: 10, border: "none", cursor: "pointer",
                background: "rgba(56,189,248,0.15)", fontSize: 13, fontWeight: 650, color: "var(--color-foreground)",
                textDecoration: "none",
              }}
            >
              進行中
              <span style={{
                fontSize: 11, fontWeight: 700, color: "var(--color-sky)",
                width: 18, height: 18, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#fff",
              }}>{inProgressCount}</span>
            </Link>
            <Link
              href={`/${workspaceSlug}/dashboard`}
              onClick={() => setSidebarOpen(false)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "6px 0", height: 34,
                borderRadius: 10, border: "none", cursor: "pointer",
                background: "rgba(233,104,50,0.12)", fontSize: 13, fontWeight: 650, color: "var(--color-foreground)",
                textDecoration: "none",
              }}
            >
              決定
              <span style={{
                fontSize: 11, fontWeight: 700, color: "var(--color-accent)",
                width: 18, height: 18, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#fff",
              }}>{decisionUnreadCount}</span>
            </Link>
          </div>

          {/* 独り言プレビュー — PCのみ固定表示（スマホはスクロールエリア内） */}
          {hitorigotoChannel && hitorigotoPreview.length > 0 && (
            <div className="hidden lg:block" style={{ flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", padding: isDesktop ? "6px 8px 4px" : "2px 10px 4px", flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: isDesktop ? 650 : 600, color: isDesktop ? "var(--color-foreground)" : "var(--color-muted)", opacity: isDesktop ? 0.7 : 0.75, flex: 1 }}>独り言</span>
              </div>
              <div style={{ display: "flex", gap: isDesktop ? 6 : 8, padding: isDesktop ? "2px 4px 10px" : "2px 10px 8px", overflowX: "auto", minHeight: isDesktop ? 56 : undefined, flexShrink: 0 }}>
                {hitorigotoPreview.map((note, i) => {
                  const lines = note.content.split("\n");
                  const imageUrl = lines.find((l: string) => /^https:\/\/.*supabase.*\/storage\/.*\.(jpg|jpeg|png|gif|webp)/i.test(l.trim()));
                  const textContent = lines.filter((l: string) => !/^https:\/\/.*supabase.*\/storage\//.test(l.trim())).join(" ").trim();
                  const ago = (() => {
                    const diff = Date.now() - new Date(note.created_at).getTime();
                    const h = Math.floor(diff / 3600000);
                    if (h < 1) return "今";
                    if (h < 24) return `${h}h`;
                    const d = Math.floor(h / 24);
                    return d < 7 ? `${d}日前` : "1w+";
                  })();
                  return (
                    <Link
                      key={i}
                      href={`/${workspaceSlug}/${hitorigotoChannel.slug}`}
                      onClick={() => setSidebarOpen(false)}
                      style={{
                        width: isDesktop ? 160 : "68%", minWidth: isDesktop ? 140 : undefined, maxWidth: isDesktop ? 160 : undefined,
                        padding: isDesktop ? "6px 8px" : "8px 10px",
                        borderRadius: isDesktop ? 8 : 12, border: "none", cursor: "pointer",
                        background: isDesktop ? "#FFFFFF" : "var(--color-sidebar)",
                        textAlign: "left" as const,
                        display: "flex", gap: isDesktop ? 6 : 10, flexShrink: 0,
                        alignItems: isDesktop ? "flex-start" : "center",
                        height: isDesktop ? undefined : 80, textDecoration: "none",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                        {imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl.trim().split("#")[0]} alt="" style={{
                            width: isDesktop ? 44 : 56, height: isDesktop ? 44 : 56,
                            objectFit: "cover", borderRadius: 8, flexShrink: 0,
                          }} loading="lazy" />
                        )}
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {note.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={note.avatar_url} alt="" style={{
                                width: isDesktop ? 16 : 18, height: isDesktop ? 16 : 18,
                                borderRadius: "50%", objectFit: "cover" as const, flexShrink: 0,
                              }} />
                            ) : (
                              <span style={{
                                width: isDesktop ? 16 : 18, height: isDesktop ? 16 : 18,
                                borderRadius: "50%", background: "var(--color-muted)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 7, fontWeight: 700, color: "#fff", flexShrink: 0,
                              }}>{note.display_name.charAt(0)}</span>
                            )}
                            <span style={{ fontSize: isDesktop ? 10 : 11, color: "var(--color-foreground)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note.display_name}</span>
                            <span style={{ fontSize: isDesktop ? 9 : 10, color: "var(--color-muted)", marginLeft: "auto", flexShrink: 0 }}>{ago}</span>
                          </div>
                          {textContent ? (
                            <p style={{
                              fontSize: isDesktop ? 10.5 : 12, lineHeight: isDesktop ? 1.35 : 1.4,
                              color: isDesktop ? "var(--color-muted)" : "var(--color-foreground)",
                              margin: 0, overflow: "hidden", display: "-webkit-box",
                              WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                            }}>{textContent.slice(0, 70)}</p>
                          ) : !imageUrl ? (
                            <p style={{ fontSize: isDesktop ? 10.5 : 12, color: "var(--color-muted)", margin: 0 }}>📎 ファイル</p>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* PC: カレンダー・ファイル・アルバム・保存へのリンク（4列横並び、アイコン+テキスト縦配置） */}
          <div className="hidden lg:grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 2, padding: "2px 4px 6px" }}>
            {[
              { href: `/${workspaceSlug}/calendar`, label: "カレンダー", icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" },
              { href: `/${workspaceSlug}/files`, label: "ファイル", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
              { href: `/${workspaceSlug}/albums`, label: "アルバム", icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  padding: "6px 2px", borderRadius: 8,
                  fontSize: 9, fontWeight: 500, color: "var(--color-muted)",
                  textDecoration: "none",
                }}
              >
                <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setShowBookmarkModal(true)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: "6px 2px", borderRadius: 8,
                fontSize: 9, fontWeight: 500, color: "var(--color-muted)",
                background: "none", border: "none", cursor: "pointer",
              }}
            >
              <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              保存
            </button>
          </div>

        </div>

        {/* チャンネル・DM一覧（プルリフレッシュ対応） */}
        <PullToRefresh onRefresh={async () => { await fetchHitorigotoPreview(); }}>
        <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: "0 12px 8px" }}>
          {/* スマホ用: 独り言プレビュー（スクロールエリア内） */}
          {hitorigotoChannel && hitorigotoPreview.length > 0 && (
            <div className="lg:hidden" style={{ flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", padding: "2px 10px 4px", flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-muted)", opacity: 0.75, flex: 1 }}>独り言</span>
              </div>
              <div style={{ display: "flex", gap: 8, padding: "2px 10px 8px", overflowX: "auto", flexShrink: 0 }}>
                {hitorigotoPreview.map((note, i) => {
                  const lines = note.content.split("\n");
                  const imageUrl = lines.find((l: string) => /^https:\/\/.*supabase.*\/storage\/.*\.(jpg|jpeg|png|gif|webp)/i.test(l.trim()));
                  const textContent = lines.filter((l: string) => !/^https:\/\/.*supabase.*\/storage\//.test(l.trim())).join(" ").trim();
                  const ago = (() => {
                    const diff = Date.now() - new Date(note.created_at).getTime();
                    const h = Math.floor(diff / 3600000);
                    if (h < 1) return "今";
                    if (h < 24) return `${h}h`;
                    const d = Math.floor(h / 24);
                    return d < 7 ? `${d}日前` : "1w+";
                  })();
                  return (
                    <Link
                      key={i}
                      href={`/${workspaceSlug}/${hitorigotoChannel.slug}`}
                      onClick={() => setSidebarOpen(false)}
                      style={{
                        width: "68%", padding: "8px 10px",
                        borderRadius: 12, border: "none", cursor: "pointer",
                        background: "var(--color-sidebar)",
                        textAlign: "left" as const,
                        display: "flex", gap: 10, flexShrink: 0,
                        alignItems: "center",
                        height: 80, textDecoration: "none",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                        {imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl.trim().split("#")[0]} alt="" style={{
                            width: 56, height: 56,
                            objectFit: "cover", borderRadius: 8, flexShrink: 0,
                          }} loading="lazy" />
                        )}
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {note.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={note.avatar_url} alt="" style={{
                                width: 18, height: 18,
                                borderRadius: "50%", objectFit: "cover" as const, flexShrink: 0,
                              }} />
                            ) : (
                              <span style={{
                                width: 18, height: 18,
                                borderRadius: "50%", background: "var(--color-muted)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 7, fontWeight: 700, color: "#fff", flexShrink: 0,
                              }}>{note.display_name.charAt(0)}</span>
                            )}
                            <span style={{ fontSize: 11, color: "var(--color-foreground)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note.display_name}</span>
                            <span style={{ fontSize: 10, color: "var(--color-muted)", marginLeft: "auto", flexShrink: 0 }}>{ago}</span>
                          </div>
                          {textContent ? (
                            <p style={{
                              fontSize: 12, lineHeight: 1.4,
                              color: "var(--color-foreground)",
                              margin: 0, overflow: "hidden", display: "-webkit-box",
                              WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                            }}>{textContent.slice(0, 70)}</p>
                          ) : !imageUrl ? (
                            <p style={{ fontSize: 12, color: "var(--color-muted)", margin: 0 }}>📎 ファイル</p>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* チャンネルセクション — ヘッダーは控えめに、＋ボタンのみ */}
          <div className="mt-1 mb-0.5 flex items-center justify-end" style={{ gap: 2 }}>
            <button
              onClick={() => {
                setCatList(categories);
                setCatError("");
                setNewCatLabel("");
                setShowCategoryManager(true);
              }}
              className="text-muted/50 hover:text-muted transition-colors p-1 rounded hover:bg-sidebar-hover"
              title="カテゴリ管理"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </button>
            <button
              onClick={() => setShowCreateChannel(true)}
              className="text-muted/50 hover:text-muted transition-colors p-1 rounded hover:bg-sidebar-hover"
              title="チャンネル作成"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <ChannelCategoryList
            channels={filteredChannels}
            categories={categories}
            workspaceSlug={workspaceSlug}
            pathname={pathname}
            unreadState={unreadState}
            onNavigate={(isActive, title) => {
              if (isActive) setSidebarOpen(false);
              else startDetailOpen(title);
            }}
            channelMembersMap={channelMembersMap}
            workspaceMembers={members}
            onOpenMembers={(id) => setMembersModalChannelId(id)}
            categoryOverrides={categoryOverrides}
          />

          {/* 独り言チャンネルはプレビューカードから開く。個別リンク行は不要 */}

          {/* DMセクション（PCのみ。モバイルはボトムタブのDMページ）— モック準拠インラインスタイル */}
          <div className="hidden lg:flex items-center justify-between" style={{ padding: "16px 8px 6px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-muted)", opacity: 0.75 }}>
              ダイレクトメッセージ
            </span>
            <button
              onClick={() => setShowCreateDm(true)}
              className="text-muted/50 hover:text-muted transition-colors p-1 rounded hover:bg-sidebar-hover"
              title="新しいメッセージ"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* DM一覧（PCのみ） */}
          <div className="hidden lg:block">
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
                onClick={() => {
                  if (isActive) setSidebarOpen(false);
                  else startDetailOpen(name);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "0 10px", height: 38, borderRadius: 8,
                  cursor: "pointer", marginBottom: 1, textDecoration: "none",
                  color: dmShowUnreadStyle ? "var(--color-foreground)" : "var(--color-muted)",
                  fontWeight: dmShowUnreadStyle ? 700 : 500,
                }}
              >
                {/* アバター + オンラインドット */}
                <span style={{ position: "relative", display: "inline-flex" }}>
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt={name}
                      style={{ width: 28, height: 28, borderRadius: 14, objectFit: "cover" as const }}
                    />
                  ) : (
                    <span style={{
                      width: 28, height: 28, borderRadius: 14,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--color-muted)",
                    }}>
                      {name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  {isOnline && (
                    <span style={{
                      position: "absolute", bottom: -1, right: -1,
                      width: 10, height: 10, borderRadius: 5,
                      border: "2px solid var(--color-sidebar)", background: "var(--color-online)",
                    }} />
                  )}
                </span>
                <span style={{
                  fontSize: 14, flex: 1, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
                }}>
                  {name}
                </span>
                {dmShowUnreadStyle && (
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%",
                    fontSize: 10, fontWeight: 700, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--color-accent)",
                  }}>
                    {dmUnread > 99 ? "99+" : dmUnread}
                  </span>
                )}
              </Link>
            );
          })}

          {/* メンバー招待ボタン */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted hover:text-accent mx-2 rounded-lg hover:bg-sidebar-hover transition-colors w-full mt-2"
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

          </div>
          {/* 検索結果が空の場合 */}
          {searchQuery.trim() &&
            filteredChannels.length === 0 &&
            filteredDmChannels.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted">
                見つかりませんでした
              </div>
            )}
        </div>
        </PullToRefresh>

        {/* 下部: ユーザー名 + 設定（PCのみ。モバイルは右上アイコン+ボトムタブに移動） */}
        <div className="hidden lg:block px-3 py-3 border-t border-border/50 space-y-2">
          <div className="flex items-center gap-2">
            {(() => {
              const me = members.find((m) => m.user_id === currentUserId);
              const profile = me?.profiles;
              const p = Array.isArray(profile) ? profile[0] : profile;
              const name = p?.display_name || "ユーザー";
              const initial = name[0].toUpperCase();
              return (
                <>
                  <span className="w-7 h-7 rounded-full bg-muted/20 flex items-center justify-center text-[11px] font-bold text-muted shrink-0">
                    {p?.avatar_url ? (
                      <img src={p.avatar_url} alt={name} className="w-7 h-7 rounded-full object-cover" />
                    ) : initial}
                  </span>
                  <span className="text-[13px] text-foreground truncate flex-1">{name}</span>
                </>
              );
            })()}
            {/* マスター画面 (is_master 限定で表示) */}
            {isMaster && (
              <Link
                href="/master"
                className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-sidebar-hover shrink-0"
                title="マスター画面（全WS閲覧）"
                aria-label="マスター画面を開く"
              >
                <span className="text-base leading-none">🔑</span>
              </Link>
            )}
            {/* LP プレビュー（アプリ内から /about に直接ジャンプ） */}
            <Link
              href="/about"
              className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-sidebar-hover shrink-0"
              title="LPプレビュー"
              aria-label="ランディングページを開く"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.6 9h16.8M3.6 15h16.8M11.25 3a17 17 0 000 18M12.75 3a17 17 0 010 18" />
              </svg>
            </Link>
            <button
              onClick={() => setShowSettings(true)}
              className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-sidebar-hover shrink-0"
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
                className="text-muted hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-sidebar-hover shrink-0"
                title="ログアウト"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </form>
          </div>
        </div>
        {/* チャンネル読み込み中オーバーレイ（一覧の上に重ねる） */}
        {pendingDetailOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm lg:hidden">
            <div className="flex flex-col items-center gap-2">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              {detailTransitionTitle && (
                <span className="text-xs text-muted">{detailTransitionTitle}</span>
              )}
            </div>
          </div>
        )}
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

      {/* チャンネルメンバー一覧モーダル（サイドバーのアバタータップで開く） */}
      {membersModalChannelId && (
        <ChannelMembersModal
          channelId={membersModalChannelId}
          workspaceId={workspace.id}
          currentUserId={currentUserId}
          onClose={() => setMembersModalChannelId(null)}
        />
      )}

      {/* アクティビティ（自分の投稿へのリアクション一覧） */}
      {showActivity && (
        <ActivityModal
          workspaceSlug={workspaceSlug}
          workspaceId={workspace.id}
          currentChannelSlug={pathname.split("/")[2] || null}
          onClose={() => setShowActivity(false)}
        />
      )}

      {/* カテゴリ管理モーダル */}
      {showCategoryManager && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowCategoryManager(false)}
        >
          <div
            style={{ width: "100%", maxWidth: 400, borderRadius: 16, background: "var(--color-surface)", border: "1px solid var(--color-border)", padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--color-foreground)", margin: 0 }}>カテゴリ管理</h3>
              <button
                onClick={() => setShowCategoryManager(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", padding: 4 }}
              >
                <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 12 }}>色はチャンネル一覧の # 部分に反映されます</p>

            {catError && (
              <div style={{ borderRadius: 8, background: "rgba(239,68,68,0.1)", padding: "8px 12px", fontSize: 13, color: "#ef4444", marginBottom: 12 }}>{catError}</div>
            )}

            <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 16 }}>
              {catList.map((cat, idx) => (
                <div
                  key={cat.slug}
                  style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 10, background: "var(--color-background-soft)", marginBottom: 6 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {/* 上下ボタン */}
                    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
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
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", opacity: idx === 0 ? 0.2 : 1, padding: 0 }}
                      >
                        <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
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
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", opacity: idx === catList.length - 1 ? 0.2 : 1, padding: 0 }}
                      >
                        <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    {/* # プレビュー + カテゴリ名 */}
                    <span style={{ fontSize: 15, fontWeight: 600, color: cat.color || "var(--color-muted)", flexShrink: 0 }}>#</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-foreground)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                    {/* 編集 */}
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
                      style={{ flexShrink: 0, padding: 4, background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", borderRadius: 4 }}
                      title="名前を変更"
                    >
                      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    {/* 削除 */}
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
                      style={{ flexShrink: 0, padding: 4, background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", borderRadius: 4 }}
                      title="削除"
                    >
                      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {/* カラーピッカー: # の色を変更 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: 28 }}>
                    <button
                      type="button"
                      onClick={() => handleChangeCategoryColor(cat.slug, null)}
                      style={{
                        width: 18, height: 18, borderRadius: "50%",
                        border: !cat.color ? "2px solid var(--color-foreground)" : "2px solid var(--color-border)",
                        background: "none", cursor: "pointer", padding: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                      title="無色"
                    >
                      <svg style={{ width: 12, height: 12, color: "var(--color-muted)" }} viewBox="0 0 20 20" fill="currentColor">
                        <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    </button>
                    {CATEGORY_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => handleChangeCategoryColor(cat.slug, c.value)}
                        style={{
                          width: 18, height: 18, borderRadius: "50%",
                          backgroundColor: c.value, cursor: "pointer", padding: 0,
                          border: cat.color === c.value ? "2px solid var(--color-foreground)" : "2px solid transparent",
                          transform: cat.color === c.value ? "scale(1.15)" : undefined,
                          transition: "transform 150ms, border 150ms",
                        }}
                        title={c.label}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {catList.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-muted)", padding: "8px 0", textAlign: "center" }}>カテゴリがありません</div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
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
                  style={{
                    flex: 1, borderRadius: 10, border: "1px solid var(--color-border)",
                    background: "var(--color-input-bg)", padding: "8px 12px",
                    fontSize: 14, color: "var(--color-foreground)", outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  disabled={!newCatLabel.trim() || catAdding}
                  style={{
                    flexShrink: 0, borderRadius: 10, padding: "8px 16px",
                    fontSize: 13, fontWeight: 600, color: "#fff",
                    background: "var(--color-accent)", border: "none", cursor: "pointer",
                    opacity: (!newCatLabel.trim() || catAdding) ? 0.5 : 1,
                  }}
                >
                  {catAdding ? "..." : "追加"}
                </button>
              </div>
              {/* 新規カテゴリの # 色 */}
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 11, color: "var(--color-muted)", marginRight: 2 }}># 色</span>
                <button
                  type="button"
                  onClick={() => setNewCatColor(null)}
                  style={{
                    width: 18, height: 18, borderRadius: "50%",
                    border: !newCatColor ? "2px solid var(--color-foreground)" : "2px solid var(--color-border)",
                    background: "none", cursor: "pointer", padding: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                  title="無色"
                >
                  <svg style={{ width: 12, height: 12, color: "var(--color-muted)" }} viewBox="0 0 20 20" fill="currentColor">
                    <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setNewCatColor(c.value)}
                    style={{
                      width: 18, height: 18, borderRadius: "50%",
                      backgroundColor: c.value, cursor: "pointer", padding: 0,
                      border: newCatColor === c.value ? "2px solid var(--color-foreground)" : "2px solid transparent",
                      transform: newCatColor === c.value ? "scale(1.15)" : undefined,
                      transition: "transform 150ms, border 150ms",
                    }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* 決定ボタン */}
            <button
              type="button"
              onClick={() => {
                setShowCategoryManager(false);
                // モバイルでも即反映されるよう強制リロード
                window.location.reload();
              }}
              style={{
                width: "100%", marginTop: 16, borderRadius: 10, padding: "10px 0",
                fontSize: 14, fontWeight: 600, color: "#fff",
                background: "var(--color-accent)", border: "none", cursor: "pointer",
              }}
            >
              決定
            </button>
          </div>
        </div>
      )}

      {/* 設定モーダル */}
      {showSettings && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShowSettings(false)}>
          <div
            className="w-full max-w-md max-h-[85vh] mb-16 lg:mb-0 flex flex-col rounded-2xl bg-surface border border-border animate-fade-in overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー: 常に画面に残るよう sticky 相当に固定 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-surface shrink-0">
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
                  className="relative w-16 h-16 rounded-full shrink-0 overflow-hidden bg-muted/20 flex items-center justify-center hover:opacity-80 transition-opacity group"
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
                    className="w-full bg-background/50 rounded-lg px-3 py-2 text-sm border border-border/50 focus:border-accent focus:bg-input-bg placeholder-muted/60 transition-all outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleProfileSave}
                  disabled={profileSaving || !profileDisplayName.trim()}
                  className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {profileSaving ? "保存中..." : "保存"}
                </button>
                {profileToast && (
                  <span className="text-sm text-green-400 animate-fade-in">保存しました</span>
                )}
              </div>
            </div>

            {/* 2段階認証 */}
            {/* ストレージ使用量 */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">ストレージ</h3>
              <div className="rounded-lg border border-border bg-input-bg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted">使用量</span>
                  <span className="text-sm font-medium text-foreground">
                    {storageUsageMB !== null ? `${storageUsageMB >= 1024 ? `${(storageUsageMB / 1024).toFixed(1)} GB` : `${storageUsageMB} MB`}` : "計算中..."}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-border/50 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      storageUsageMB !== null && storageUsageMB > 80 * 1024 ? "bg-red-400" : "bg-accent"
                    }`}
                    style={{ width: storageUsageMB !== null ? `${Math.min((storageUsageMB / (100 * 1024)) * 100, 100)}%` : "0%" }}
                  />
                </div>
                <p className="text-xs text-muted mt-1.5">上限: 100 GB（Pro）・画像は30日で自動削除</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">2段階認証</h3>
              <MfaSetup />
            </div>

            {/* テーマ */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">テーマ</h3>
              <ThemeSelector />
            </div>

            {/* メールアドレス変更 */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">メールアドレス</h3>
              <p className="text-sm text-muted mb-2">{settingsEmail || "読み込み中..."}</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={settingsNewEmail}
                  onChange={(e) => { setSettingsNewEmail(e.target.value); setSettingsEmailMsg(null); }}
                  placeholder="新しいメールアドレス"
                  className="flex-1 rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={settingsEmailSaving || !settingsNewEmail.trim() || settingsNewEmail.trim() === settingsEmail}
                  onClick={async () => {
                    setSettingsEmailSaving(true);
                    setSettingsEmailMsg(null);
                    const supabase = sidebarSupabaseRef.current;
                    const { error } = await supabase.auth.updateUser({ email: settingsNewEmail.trim() });
                    if (error) {
                      setSettingsEmailMsg({ type: "error", text: "変更に失敗しました: " + error.message });
                    } else {
                      setSettingsEmailMsg({ type: "success", text: "確認メールを送信しました。新しいメールアドレスのリンクをクリックして完了してください。" });
                      setSettingsNewEmail("");
                    }
                    setSettingsEmailSaving(false);
                  }}
                  className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {settingsEmailSaving ? "送信中..." : "変更"}
                </button>
              </div>
              {settingsEmailMsg && (
                <div className={`mt-2 rounded-lg px-3 py-2 text-sm ${settingsEmailMsg.type === "error" ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
                  {settingsEmailMsg.text}
                </div>
              )}
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
                  className="px-4 py-2 text-sm rounded-lg border border-mention/30 text-mention hover:bg-mention/10 transition-colors"
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
  onNavigate: (isActive: boolean, title: string) => void;
  // channel.id → 所属ユーザーID配列
  channelMembersMap: Record<string, string[]>;
  // ユーザーID → プロフィール解決用
  workspaceMembers: WorkspaceMember[];
  // アバタータップで所属メンバー一覧モーダルを開く
  onOpenMembers: (channelId: string) => void;
  // カテゴリ変更のローカルオーバーライド
  categoryOverrides: Record<string, string | null>;
};

const COLLAPSED_KEY = "huddle:sidebar:collapsedCategories";

function ChannelCategoryList({
  channels,
  categories,
  workspaceSlug,
  pathname,
  unreadState,
  onNavigate,
  channelMembersMap,
  workspaceMembers,
  onOpenMembers,
  categoryOverrides,
}: ChannelCategoryListProps) {
  // PC/モバイル判定（モックのスタイル差分を切り替えるため）
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(typeof window !== "undefined" && window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // user_id → profile 変換マップ
  const profileById = useMemo(() => {
    const m = new Map<string, { display_name: string; avatar_url: string | null }>();
    for (const mem of workspaceMembers) {
      const p = Array.isArray(mem.profiles) ? mem.profiles[0] : mem.profiles;
      if (p) m.set(mem.user_id, { display_name: p.display_name, avatar_url: p.avatar_url });
    }
    return m;
  }, [workspaceMembers]);
  // 折りたたみ状態をlocalStorageに保存。初期値は「全カテゴリ折りたたみ」
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const all = new Set<string>(categories.map((c) => c.slug));
    all.add("__uncategorized__");
    return all;
  });
  // localStorage は SSR で読めないため effect で読み込む。
  // 初期値（全カテゴリ折りたたみ）から保存値へ同期する正当な外部システム読み取り
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(arr)) setCollapsed(new Set(arr));
      }
    } catch {
      // 破損した設定は無視
    }
  }, []);

  // アコーディオン方式: 1つ開くと他は全部閉じる
  function toggleCollapsed(key: string) {
    // 各カテゴリの開閉は独立。タップしたカテゴリだけを開閉し、
    // 他のカテゴリの開閉状態には触らない。
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key); // 閉じていた → 開く
      } else {
        next.add(key);    // 開いていた → 閉じる
      }
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // localStorage 使えない環境は無視
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
      // カテゴリ変更のローカルオーバーライドを適用
      const cat = ch.id in categoryOverrides ? categoryOverrides[ch.id] : ch.category;
      const key = cat ?? "__uncategorized__";
      const list = map.get(key);
      if (list) list.push(ch);
      else map.get("__uncategorized__")!.push(ch);
    }
    return map;
  }, [channels, categories, categoryOverrides]);

  // カテゴリラベルマップ
  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.slug, c.label);
    m.set("__uncategorized__", UNCATEGORIZED_LABEL);
    return m;
  }, [categories]);

  const sections = useMemo(() => [
    ...categories.map((c) => ({ key: c.slug, label: c.label, color: c.color ?? null })),
    { key: "__uncategorized__", label: UNCATEGORIZED_LABEL, color: null as string | null },
  ], [categories]);

  return (
    <div>
      {sections.map(({ key, label, color }, catIdx) => {
        const list = grouped.get(key) || [];
        if (list.length === 0) return null;
        const isCollapsed = collapsed.has(key);
        // カテゴリ内の未読合計
        const unreadTotal = list.reduce(
          (sum, ch) => sum + (unreadState[ch.id] || 0),
          0
        );
        return (
          <div key={key} style={{ marginBottom: 2 }}>
            {/* カテゴリヘッダー — モック準拠インラインスタイル */}
            <button
              type="button"
              onClick={() => toggleCollapsed(key)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 6,
                padding: "6px 10px 3px", border: "none", background: "none",
                cursor: "pointer", marginTop: catIdx === 0 ? (isDesktop ? 0 : 2) : (isDesktop ? 10 : 6),
                position: "relative", zIndex: 2,
              }}
            >
              <svg
                style={{
                  width: 14, height: 14,
                  color: isDesktop
                    ? "var(--color-muted)"
                    : (color ? `${color}B3` : "var(--color-muted)"),
                  opacity: 0.7, flexShrink: 0,
                  transition: "transform 150ms",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                }}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              <span style={{
                fontSize: isDesktop ? 12 : 15, fontWeight: isDesktop ? 650 : 600,
                color: "var(--color-foreground)",
                opacity: isDesktop ? 0.7 : 0.8, flex: 1, textAlign: "left" as const,
              }}>{label}</span>
              {isCollapsed && unreadTotal > 0 && (
                <span style={{
                  width: isDesktop ? 20 : 16, height: isDesktop ? 20 : 16, borderRadius: "50%",
                  fontSize: isDesktop ? 10 : 9, fontWeight: 700, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--color-accent)", opacity: isDesktop ? 1 : 0.85,
                }}>{unreadTotal > 99 ? "99+" : unreadTotal}</span>
              )}
            </button>
            {/* チャンネル行 — モック準拠インラインスタイル */}
            {!isCollapsed &&
              list.map((channel) => {
                const href = `/${workspaceSlug}/${channel.slug}`;
                const isActive = pathname === href;
                const unreadCount = unreadState[channel.id] || 0;
                const showUnreadStyle = unreadCount > 0 && !isActive;
                const chMemberIds = channelMembersMap[channel.id] || [];
                return (
                  <Link
                    key={channel.id}
                    href={href}
                    onClick={() => onNavigate(isActive, channel.name)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: isDesktop ? "0 10px" : "0 10px 0 28px",
                      height: isDesktop ? 36 : 34, borderRadius: 8,
                      border: "none", cursor: "pointer", marginBottom: isDesktop ? 1 : 0,
                      background: (isDesktop && isActive) ? "var(--color-sky-soft)" : "none",
                      position: "relative" as const, zIndex: 1,
                      color: isDesktop
                        ? ((isActive || showUnreadStyle) ? "var(--color-foreground)" : "var(--color-muted)")
                        : "var(--color-foreground)",
                      fontWeight: (isDesktop && isActive) || showUnreadStyle ? 700 : isDesktop ? 500 : 500,
                      fontSize: isDesktop ? 14 : (showUnreadStyle ? 15.5 : 15),
                      textAlign: "left" as const, textDecoration: "none",
                    }}
                  >
                    {channel.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={channel.icon_url}
                        alt=""
                        style={{
                          width: isDesktop ? 20 : 18, height: isDesktop ? 20 : 18,
                          borderRadius: 4, objectFit: "cover", flexShrink: 0,
                          opacity: 1,
                        }}
                      />
                    ) : (
                      <span style={{
                        fontSize: isDesktop ? 16 : 15,
                        color: (isDesktop && isActive) ? "var(--color-sky)" : (color || "var(--color-muted)"),
                        opacity: (isDesktop && isActive) ? 1 : showUnreadStyle ? 0.7 : 0.4,
                      }}>#</span>
                    )}
                    <span style={{
                      flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap" as const,
                    }}>{channel.name}</span>
                    {showUnreadStyle && (
                      <span style={{
                        width: isDesktop ? 20 : 16, height: isDesktop ? 20 : 16, borderRadius: "50%",
                        fontSize: isDesktop ? 10 : 9, fontWeight: 700, color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "var(--color-accent)", opacity: isDesktop ? 1 : 0.85,
                        flexShrink: 0, marginLeft: "auto",
                      }}>{unreadCount > 99 ? "99+" : unreadCount}</span>
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
