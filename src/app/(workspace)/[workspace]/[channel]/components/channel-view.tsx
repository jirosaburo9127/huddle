"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import type { Channel, Message, MessageWithProfile, Reaction } from "@/lib/supabase/types";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { WorkspaceCategory } from "@/lib/channel-categories";
import { MessageItem } from "./message-item";
import { HitorigotoPostCard } from "./hitorigoto-post-card";
import { MessageInput, type MentionPayload } from "./message-input";
import { CreatePollModal } from "./create-poll-modal";
import { CreateEventModal } from "./create-event-modal";
import { EventDisplay } from "./event-display";
import { DateSeparator } from "./date-separator";
import { ChannelWiki } from "./channel-wiki";
import { ChannelMembersModal } from "@/components/channel-members-modal";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { showMessageNotification } from "@/lib/notification";
import { clearPushBadge } from "@/lib/push-notifications";
import { fetchSincePeriod, mergeById } from "@/lib/sync-fetcher";

type Props = {
  channel: Channel;
  initialMessages: MessageWithProfile[];
  currentUserId: string;
  // SSR 時点（= RPC による last_read_at 更新より前）の値。
  // 未読区切り線を安定して表示するために必須。
  initialLastReadAt: string | null;
};

export function ChannelView({ channel, initialMessages, currentUserId, initialLastReadAt }: Props) {
  // zustand セレクタ形式: 購読範囲を setSidebarOpen のみに限定
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // 進行中まとめなど、外部からの投稿ジャンプ指定（?m=<messageId>）
  // 同じIDで二重実行されないよう処理済みIDを保持
  const jumpHandledIdRef = useRef<string | null>(null);
  // ジャンプ進行中フラグ: 自動スクロール（未読線/最下部）を一時的に抑止するため
  // ?m 指定がある間は true。ジャンプ完了後 2秒経ってから false に戻す
  const jumpActiveRef = useRef<boolean>(false);
  const [messages, setMessages] = useState<MessageWithProfile[]>(initialMessages);
  // 過去メッセージの追加読み込み用
  const [loadingOlder, setLoadingOlder] = useState(false);
  // 初期取得で 50 件未満しか返ってこなかったら、それ以前の履歴は無いとみなす
  const [hasMoreOlder, setHasMoreOlder] = useState(initialMessages.length >= 50);
  // Chatwork風インライン返信の返信対象
  const [replyTo, setReplyTo] = useState<MessageWithProfile | null>(null);
  // 独り言チャンネル用X風スレッドモーダル
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showDeleteChannel, setShowDeleteChannel] = useState(false);
  const [deletingChannel, setDeletingChannel] = useState(false);
  const [showDecisionsOnly, setShowDecisionsOnly] = useState(false);
  const [showWiki, setShowWiki] = useState(false);
  const [hasWiki, setHasWiki] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [categoryValue, setCategoryValue] = useState<string | null>(channel.category ?? null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [wsCategories, setWsCategories] = useState<WorkspaceCategory[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [mikanEnabled, setMikanEnabled] = useState<boolean>(!!channel.mikan_enabled);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(initialMessages.length);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncMissedRef = useRef<(() => void) | null>(null);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // 画面全体でのドラッグ&ドロップを受け付けるオーバーレイ表示制御
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragCounterRef = useRef(0);

  // 投票作成モーダル
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  // 予定作成モーダル
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  // このチャンネルでイベントが紐づいているメッセージID集合
  const [eventMessageIds, setEventMessageIds] = useState<Set<string>>(new Set());
  // このチャンネルで投票が紐づいているメッセージID集合
  const [pollMessageIds, setPollMessageIds] = useState<Set<string>>(new Set());
  // このタブが自分で送信して既に楽観的反映済みのメッセージID集合。
  // Realtime購読では「同一ユーザーかどうか」ではなく「このタブで送ったか」で判定するのが正しい。
  // （PCとiPhoneで同じユーザーでログインしている場合に、片方の送信がもう片方に届かなくなるため）
  const sentMessageIdsRef = useRef<Set<string>>(new Set());
  // messages の最新参照を ref で保持することで、handleReact 等の useCallback が
  // messages の変更ごとに再生成されるのを回避する（大量メッセージでの性能劣化対策）
  const messagesRef = useRef<MessageWithProfile[]>(initialMessages);
  // テキスト＋添付が別々に onSend される際、parent_id を最初の1回だけ付ける制御用
  const replyConsumedRef = useRef(false);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 自分のプロフィールを取得して楽観的メッセージに使う（avatar_url を正しく反映）
  const [myProfile, setMyProfile] = useState<{
    display_name: string;
    avatar_url: string | null;
  } | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", currentUserId)
        .maybeSingle();
      if (data) setMyProfile(data);
    })();
  }, [currentUserId, supabase]);

  // 自分の最終既読時刻（チャンネル初回表示時点の値を保持。未読区切り線の位置に使用）
  // SSR で先取りした値を初期値に使う（RPC が last_read_at を NOW に更新する前の値）
  const [myLastReadAt, setMyLastReadAt] = useState<string | null>(initialLastReadAt);
  const myLastReadAtRef = useRef<string | null>(initialLastReadAt);
  const unreadLineRef = useRef<HTMLDivElement>(null);
  // 未読区切り線の表示ステート: 画面に入って3秒 → fading → 0.5秒後にhiddenで完全に消す
  const [unreadLineState, setUnreadLineState] = useState<"visible" | "fading" | "hidden">("visible");

  // 既読状態: チャンネルメンバーの last_read_at を取得して既読数を計算
  const [memberReadTimes, setMemberReadTimes] = useState<Array<{ user_id: string; last_read_at: string | null }>>([]);
  const memberCountForRead = memberReadTimes.filter((m) => m.user_id !== currentUserId).length;

  useEffect(() => {
    let cancelled = false;
    async function fetchReadTimes() {
      const { data } = await supabase
        .from("channel_members")
        .select("user_id, last_read_at")
        .eq("channel_id", channel.id);
      if (!cancelled && data) setMemberReadTimes(data);
    }
    fetchReadTimes();
    // 10秒ごとに既読状態を更新
    const interval = setInterval(fetchReadTimes, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [channel.id, supabase]);

  // メッセージの既読数を計算（自分の投稿のみ対象）
  const getReadCount = useCallback((message: MessageWithProfile) => {
    if (message.user_id !== currentUserId) return -1; // 自分の投稿以外は表示しない
    const msgTime = new Date(message.created_at).getTime();
    return memberReadTimes.filter(
      (m) => m.user_id !== currentUserId && m.last_read_at && new Date(m.last_read_at).getTime() >= msgTime
    ).length;
  }, [memberReadTimes, currentUserId]);

  // ミュート状態 + 自分の最終既読時刻を取得
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("channel_members")
        .select("muted, last_read_at")
        .eq("channel_id", channel.id)
        .eq("user_id", currentUserId)
        .maybeSingle();
      if (data) {
        setIsMuted(!!data.muted);
        // 初回のみセット（チャンネル表示中に更新しない）
        if (!myLastReadAtRef.current) {
          myLastReadAtRef.current = data.last_read_at;
          setMyLastReadAt(data.last_read_at);
        }
      }
    })();
  }, [channel.id, currentUserId, supabase]);

  // モバイル: チャンネルURL直アクセス（プッシュ通知タップや共有リンク）では
  // サイドバーを閉じてチャンネルビューを前面に出す
  useEffect(() => {
    setSidebarOpen(false);
    // チャンネルを開いた時点でiOSアプリアイコンのバッジと配信済み通知をクリア
    // userIdを渡すことで、他チャンネルに残っている未読数とバッジを正しく同期する
    clearPushBadge(currentUserId);
  }, [channel.id, setSidebarOpen, currentUserId]);

  // overflow メニュー外クリックで閉じる
  useEffect(() => {
    if (!showOverflowMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        overflowMenuRef.current &&
        !overflowMenuRef.current.contains(e.target as Node)
      ) {
        setShowOverflowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showOverflowMenu]);

  // 返信対象をセット
  const handleReply = useCallback((msg: MessageWithProfile) => {
    // 通常チャンネル: メッセージ入力欄に引用
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("huddle:closeAllActions"));
    }
    replyConsumedRef.current = false;
    setReplyTo(msg);
  }, []);

  // 引用元メッセージへジャンプしてハイライト
  const handleJumpToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("reply-jump-highlight");
    setTimeout(() => el.classList.remove("reply-jump-highlight"), 1600);
  }, []);

  // URL ?m=<messageId> で指定された投稿へジャンプ（進行中まとめ等からの遷移用）
  // 初期ロードは直近50件のみのため、古い投稿はDBから追加取得してからスクロールする
  useEffect(() => {
    const target = searchParams?.get("m");
    if (!target) return;
    if (jumpHandledIdRef.current === target) return;

    // ジャンプ進行中フラグを立てる（既存の自動スクロールを抑止）
    jumpActiveRef.current = true;
    jumpHandledIdRef.current = target;

    // ジャンプ実行後に時間差でスクロールをやり直す（ResizeObserver対策）
    function runJump() {
      handleJumpToMessage(target!);
    }

    async function run() {
      const msgInState = messagesRef.current.find((m) => m.id === target);

      if (!msgInState) {
        // 未読込: 対象投稿の created_at を取得し、それ以降をまとめて取得してマージ
        const { data: targetRow } = await supabase
          .from("messages")
          .select("created_at")
          .eq("id", target!)
          .eq("channel_id", channel.id)
          .maybeSingle();

        if (!targetRow) {
          // 該当投稿が見つからない（削除済み or チャンネル違い）
          jumpActiveRef.current = false;
          return;
        }

        const { data: range } = await supabase
          .from("messages")
          .select("*, profiles(*), reactions(*)")
          .eq("channel_id", channel.id)
          .gte("created_at", targetRow.created_at)
          .order("created_at", { ascending: true })
          .limit(500);

        if (range && range.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const additions = (range as MessageWithProfile[]).filter((m) => !existingIds.has(m.id));
            if (additions.length === 0) return prev;
            const merged = [...prev, ...additions];
            merged.sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return merged;
          });
        }
      }

      // 既存の初期スクロール(300ms)・ResizeObserver(最大3s)より後に複数回ジャンプし直して勝たせる
      // 0ms, 400ms, 1000ms, 2000ms, 3100ms の5回
      const delays = [0, 400, 1000, 2000, 3100];
      for (const d of delays) {
        setTimeout(runJump, d);
      }
      // 抑止フラグは 3.5 秒後に解除（以降は通常の自動スクロールへ戻す）
      setTimeout(() => { jumpActiveRef.current = false; }, 3500);
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, channel.id]);

  // オンライン状態の更新（60秒ごと）
  useEffect(() => {
    const updatePresence = async () => {
      await supabase
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", currentUserId);
    };
    updatePresence();
    const interval = setInterval(updatePresence, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // Wikiの存在チェック
  useEffect(() => {
    async function checkWiki() {
      // .single() は0件で406を返すので .maybeSingle() を使う
      const { data } = await supabase
        .from("channel_notes")
        .select("id")
        .eq("channel_id", channel.id)
        .maybeSingle();
      setHasWiki(!!data);
    }
    checkWiki();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // ブックマーク一覧を取得
  useEffect(() => {
    async function fetchBookmarks() {
      const { data } = await supabase
        .from("bookmarks")
        .select("message_id")
        .eq("user_id", currentUserId);
      if (data) {
        setBookmarkedIds(new Set(data.map((b: { message_id: string }) => b.message_id)));
      }
    }
    fetchBookmarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // 投票メッセージID を一括取得 + Realtime 追跡
  useEffect(() => {
    let cancelled = false;
    async function fetchPolls() {
      const { data } = await supabase
        .from("polls")
        .select("message_id")
        .eq("channel_id", channel.id);
      if (cancelled || !data) return;
      setPollMessageIds(new Set(data.map((r: { message_id: string }) => r.message_id)));
    }
    fetchPolls();

    // 新規 polls INSERT を監視 (他端末からの投票作成も反映)
    const sub = supabase
      .channel(`polls-${channel.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "polls",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload: { new: { message_id: string } }) => {
          setPollMessageIds((prev) => {
            const next = new Set(prev);
            next.add(payload.new.message_id);
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // イベントメッセージID を一括取得
  useEffect(() => {
    let cancelled = false;
    async function fetchEvents() {
      const { data } = await supabase
        .from("events")
        .select("message_id")
        .eq("channel_id", channel.id);
      if (cancelled || !data) return;
      setEventMessageIds(new Set(data.map((r: { message_id: string }) => r.message_id)));
    }
    fetchEvents();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // スクロールコンテナを最下部に強制移動
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // 未読区切り線または最下部にスクロール
  const scrollToUnreadOrBottom = useCallback(() => {
    const unreadEl = unreadLineRef.current;
    if (unreadEl) {
      // 未読の先頭が画面上部に来るように（= 未読区切り線を上端付近に）
      unreadEl.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  // 未読区切り線が画面内に3秒入っていたら自動で消す（fade out）
  useEffect(() => {
    if (unreadLineState !== "visible") return;
    const el = unreadLineRef.current;
    if (!el) return;

    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((e) => e.isIntersecting);
        if (isVisible) {
          if (!fadeTimer) {
            fadeTimer = setTimeout(() => {
              setUnreadLineState("fading");
              // CSS トランジション分だけ待ってから DOM から消す
              setTimeout(() => setUnreadLineState("hidden"), 600);
            }, 3000);
          }
        } else {
          if (fadeTimer) {
            clearTimeout(fadeTimer);
            fadeTimer = null;
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (fadeTimer) clearTimeout(fadeTimer);
    };
    // messages.length に依存: 初回 DOM 構築後・メッセージ追加で ref が付け変わるタイミングで再セット
  }, [unreadLineState, messages.length]);

  // チャンネル切替時: 未読位置または最下部に移動 + ResizeObserver
  useEffect(() => {
    // myLastReadAt の取得を待ってからスクロール
    const waitAndScroll = setTimeout(() => {
      if (jumpActiveRef.current) return; // ジャンプ進行中はスキップ
      requestAnimationFrame(() => requestAnimationFrame(scrollToUnreadOrBottom));
    }, 300);
    prevMessageCountRef.current = initialMessages.length;

    // 初期表示中はコンテンツ高さの変化を監視してスクロール位置を維持。
    // 独り言は画像・動画が多く遅延ロードでレイアウトシフトが続くので、
    // 通常 3 秒のところを 10 秒に延長する。
    const armedDurationMs = channel.is_hitorigoto ? 10000 : 3000;
    const container = scrollContainerRef.current;
    if (!container) return () => clearTimeout(waitAndScroll);
    let armed = true;
    const observer = new ResizeObserver(() => {
      if (armed && !jumpActiveRef.current) {
        const unreadEl = unreadLineRef.current;
        if (unreadEl) {
          unreadEl.scrollIntoView({ behavior: "auto", block: "start" });
        } else {
          scrollToBottom();
        }
      }
    });
    const inner = container.firstElementChild;
    if (inner) observer.observe(inner);
    const timer = setTimeout(() => { armed = false; observer.disconnect(); }, armedDurationMs);
    return () => { armed = false; clearTimeout(waitAndScroll); clearTimeout(timer); observer.disconnect(); };
  }, [channel.id, channel.is_hitorigoto, initialMessages.length, scrollToBottom]);

  // メッセージ増加時: DOM 更新後に即座に最下部へ
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      if (!jumpActiveRef.current) {
        requestAnimationFrame(scrollToBottom);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, scrollToBottom]);

  // Realtime購読
  useEffect(() => {
    const subscription = supabase
      .channel(`room-${channel.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        async (payload: RealtimePostgresInsertPayload<Message>) => {
          // Chatwork風インライン返信: parent_id があるメッセージもタイムラインに流す

          // このタブで楽観的に追加済みのメッセージはスキップ（user_idでの判定はNG。
          // 同じユーザーが別端末で送ったメッセージも届かなくなってしまうため）
          if (sentMessageIdsRef.current.has(payload.new.id)) {
            sentMessageIdsRef.current.delete(payload.new.id);
            return;
          }

          // メッセージとプロフィールを一括取得（個別fetchより確実）
          const { data: fullMessage } = await supabase
            .from("messages")
            .select("*, profiles(*), reactions(*)")
            .eq("id", payload.new.id)
            .maybeSingle();

          const newMessage = (fullMessage ?? {
            ...payload.new,
            profiles: null,
            reactions: [],
          }) as unknown as MessageWithProfile;

          setMessages((prev) => {
            // 重複チェック
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });

          // 通知表示
          showMessageNotification({
            senderName: newMessage.profiles?.display_name || "メンバー",
            channelName: channel.name,
            content: payload.new.content,
            url: window.location.pathname,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload: RealtimePostgresUpdatePayload<Message>) => {
          const updated = payload.new;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === updated.id
                ? { ...m, content: updated.content, edited_at: updated.edited_at, deleted_at: updated.deleted_at, is_decision: updated.is_decision ?? m.is_decision, status: updated.status ?? m.status, reply_count: updated.reply_count }
                : m
            )
          );
        }
      )
      .subscribe((status: string) => {
        // Realtime接続が切断→再接続した場合、取りこぼしを即座に補完する
        if (status === "SUBSCRIBED") {
          // 再接続時に最新メッセージを取得（初回接続時も走るが無害）
          syncMissedRef.current?.();
        }
      });

    return () => {
      supabase.removeChannel(subscription);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // 差分取得（マウント時 / フォアグラウンド復帰時 / Realtime取りこぼし対策）
  // - マウント時: SSRの initialMessages がRSCキャッシュなどで古い場合に最新50件で補正する
  //   （別チャンネルから戻った時に直近の数件が消えて見えるバグの修正）
  // - 復帰時: モバイル(特にCapacitor)で画面オフ・別アプリ切替で切断されたWebSocketの取りこぼしを補完
  useEffect(() => {
    let cancelled = false;

    async function syncMissedMessages() {
      // Realtime再接続時にも呼べるようrefに登録
      syncMissedRef.current = syncMissedMessages;

      // 「直近1週間を毎回フル取得 → ID で mergeById」が中抜けを起こさない唯一の正解。
      // 詳細と禁止パターン: AGENTS.md / src/lib/sync-fetcher.ts
      const fresh = await fetchSincePeriod<MessageWithProfile>({
        supabase,
        table: "messages",
        select: "*, profiles(*), reactions(*)",
        eq: { channel_id: channel.id },
        sinceDays: 7,
        isCancelled: () => cancelled,
      });

      if (cancelled || fresh.length === 0) return;

      setMessages((prev) => mergeById(prev, fresh));
    }

    // マウント直後に1回必ず走らせる
    syncMissedMessages();

    function onVisible() {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        syncMissedMessages();
      }
    }

    // iOS Capacitor: アプリ復帰時の取りこぼし補完（visibilitychange が発火しないケース）
    function onAppResume() {
      syncMissedMessages();
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("huddle:appResumed", onAppResume);

    // 保険: 10秒ごとにポーリング（Capacitor/WKWebViewでRealtimeが途切れた場合の補完）
    const poll = setInterval(syncMissedMessages, 10000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("huddle:appResumed", onAppResume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // メッセージ編集
  const handleEdit = useCallback(async (messageId: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, content: newContent, edited_at: new Date().toISOString() }
          : m
      )
    );

    const { error } = await supabase
      .from("messages")
      .update({ content: newContent, edited_at: new Date().toISOString() })
      .eq("id", messageId);

    if (error) {
      const { data } = await supabase
        .from("messages")
        .select("*, profiles(*)")
        .eq("id", messageId)
        .single();
      if (data) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? data as MessageWithProfile : m))
        );
      }
    }
  }, [supabase]);

  // メッセージ削除（ソフトデリート）
  const handleDelete = useCallback(async (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, deleted_at: new Date().toISOString() }
          : m
      )
    );

    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId);

    if (error) {
      const { data } = await supabase
        .from("messages")
        .select("*, profiles(*)")
        .eq("id", messageId)
        .single();
      if (data) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? data as MessageWithProfile : m))
        );
      }
    }
  }, [supabase]);

  // リアクション追加/削除（トグル）
  // 依存配列に messages を入れないことで、メッセージ追加のたびに
  // 子コンポーネント (MessageItem) の props が変わって不要な再レンダーが起きるのを防ぐ。
  const handleReact = useCallback(async (messageId: string, emoji: string) => {
    const currentMessages = messagesRef.current;
    const existingReaction = currentMessages.find((m) => m.id === messageId)
      ?.reactions?.find((r) => r.emoji === emoji && r.user_id === currentUserId);

    if (existingReaction) {
      // 削除（トグル）— 楽観的削除 → 失敗時はロールバック
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: m.reactions?.filter((r) => r.id !== existingReaction.id) }
            : m
        )
      );
      const { error: delErr } = await supabase
        .from("reactions")
        .delete()
        .eq("id", existingReaction.id);
      if (delErr) {
        // eslint-disable-next-line no-console
        console.error("[reaction] delete failed:", delErr);
        // ロールバック
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, reactions: [...(m.reactions || []), existingReaction] }
              : m
          )
        );
      }
    } else {
      // 追加
      // 自分の表示名を取得（楽観的リアクション用）
      const myProfile = currentMessages.find((m) => m.user_id === currentUserId)?.profiles;
      const optimisticReaction: Reaction = {
        id: crypto.randomUUID(),
        message_id: messageId,
        user_id: currentUserId,
        emoji,
        created_at: new Date().toISOString(),
        display_name: myProfile?.display_name || "",
      };
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: [...(m.reactions || []), optimisticReaction] }
            : m
        )
      );
      const { data } = await supabase
        .from("reactions")
        .insert({ message_id: messageId, user_id: currentUserId, emoji })
        .select()
        .single();
      if (data) {
        // IDをDB側のものに置き換え
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  reactions: m.reactions?.map((r) =>
                    r.id === optimisticReaction.id ? { ...r, id: data.id } : r
                  ),
                }
              : m
          )
        );
      }
    }
  }, [supabase, currentUserId]);

  // 決定事項マーカーのトグル
  const handleDecision = useCallback(async (messageId: string, isDecision: boolean) => {
    // 決定する時のみ確認ダイアログ（解除時は確認なし）
    if (isDecision) {
      const ok = window.confirm(
        "この投稿を「決定事項」としてマークしますか？\n決定事項一覧に表示されます。"
      );
      if (!ok) return;
    }

    // 楽観的更新
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, is_decision: isDecision } : m))
    );
    // messages_update RLS は著者のみに限定されているので、
    // チャンネルメンバー全員が操作できる RPC 経由で更新する
    const { error } = await supabase.rpc("toggle_decision", {
      p_message_id: messageId,
      p_is_decision: isDecision,
    });

    if (error) {
      // ロールバック
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, is_decision: !isDecision } : m))
      );
      alert("決定事項の更新に失敗しました");
      return;
    }

    // 進捗ダッシュボードを再検証（次回訪問時に最新データ取得）
    router.refresh();
  }, [supabase, router]);

  // ステータストグル（進行中 / 完了）
  const handleStatus = useCallback(async (messageId: string, status: "in_progress" | "done") => {
    // 楽観的更新（同じステータスならnullに戻す=トグル）
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        return { ...m, status: m.status === status ? null : status };
      })
    );

    const { error } = await supabase.rpc("toggle_message_status", {
      p_message_id: messageId,
      p_status: status,
    });

    if (error) {
      // ロールバック
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          return { ...m, status: m.status === null ? status : null };
        })
      );
      alert("ステータスの更新に失敗しました");
    }
  }, [supabase]);

  // 決定事項の Why / Due 追記
  const handleUpdateDecisionMeta = useCallback(
    async (messageId: string, why: string | null, due: string | null) => {
      // 楽観的更新
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, decision_why: why, decision_due: due }
            : m
        )
      );
      // こちらも RLS 回避のため RPC 経由
      const { error } = await supabase.rpc("update_decision_meta", {
        p_message_id: messageId,
        p_why: why,
        p_due: due,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[decision-meta] update failed:", error);
        alert("理由・期限の保存に失敗しました");
        return;
      }
      router.refresh();
    },
    [supabase, router]
  );

  // ブックマークのトグル
  const handleBookmark = useCallback(async (messageId: string) => {
    const isCurrentlyBookmarked = bookmarkedIds.has(messageId);
    // 楽観的更新
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (isCurrentlyBookmarked) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });

    if (isCurrentlyBookmarked) {
      await supabase
        .from("bookmarks")
        .delete()
        .eq("user_id", currentUserId)
        .eq("message_id", messageId);
    } else {
      await supabase
        .from("bookmarks")
        .insert({ user_id: currentUserId, message_id: messageId });
    }
  }, [supabase, currentUserId, bookmarkedIds]);

  // メッセージ送信
  async function handleSend(
    content: string,
    mentions: MentionPayload,
    options?: { isDecision?: boolean; parentId?: string }
  ) {
    if (content.length > 4000) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const isDecision = options?.isDecision ?? false;
    // 独り言X風返信の場合は直接parentIdを使う
    const parentIdSnapshot = options?.parentId
      ? options.parentId
      : (replyTo && !replyConsumedRef.current)
        ? replyTo.id
        : null;
    if (parentIdSnapshot) replyConsumedRef.current = true;

    // 送信前にクライアント側で UUID を決めてしまうことで、
    // 「optimistic insert → DB insert → realtime 到着」のレース条件を完全に排除する。
    // (以前は DB からの返り値を待って sentMessageIdsRef に入れていたため、
    //  その待ち時間の間に realtime が先に届くと同じメッセージが二重/消失する事故があった)
    const newMessageId = crypto.randomUUID();

    // まず realtime 用の除外セットに入れてから state へ楽観的に追加
    sentMessageIdsRef.current.add(newMessageId);

    const optimisticMsg: MessageWithProfile = {
      id: newMessageId,
      channel_id: channel.id,
      user_id: user.id,
      parent_id: parentIdSnapshot,
      content,
      edited_at: null,
      deleted_at: null,
      is_decision: isDecision,
      status: null,
      decision_why: null,
      decision_due: null,
      reply_count: 0,
      created_at: new Date().toISOString(),
      profiles: {
        id: user.id,
        email: user.email || "",
        display_name: myProfile?.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "",
        avatar_url: myProfile?.avatar_url ?? null,
        status: null,
        last_seen_at: null,
      },
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    // 送信と同時に返信対象をリセット (ref は handleReply で次の返信がセットされるまで維持)
    if (parentIdSnapshot) setReplyTo(null);

    // クライアント発行の UUID をそのまま使って DB に挿入
    const { data, error } = await supabase.from("messages").insert({
      id: newMessageId,
      channel_id: channel.id,
      user_id: user.id,
      content,
      ...(parentIdSnapshot ? { parent_id: parentIdSnapshot } : {}),
      ...(isDecision ? { is_decision: true } : {}),
    }).select().single();

    if (error) {
      // 失敗時は楽観的更新を取り消し、除外セットからも外す
      sentMessageIdsRef.current.delete(newMessageId);
      setMessages((prev) => prev.filter((m) => m.id !== newMessageId));
      // レート制限エラー(P0001 + rate_limit_exceeded)はユーザーに明示する
      if (error.message && error.message.includes("rate_limit_exceeded")) {
        alert("メッセージの送信頻度が高すぎます。少し時間を置いてください。");
      }
    } else if (data) {
      // サーバが割り当てた created_at だけ差し替え（IDは同じ）
      setMessages((prev) =>
        prev.map((m) => (m.id === newMessageId ? { ...m, created_at: data.created_at } : m))
      );

      // メンション行を mentions テーブルに保存（プッシュ通知 send-push が参照する）
      const mentionRows: Array<{
        message_id: string;
        mentioned_user_id: string;
        mention_type: "user" | "here" | "channel";
      }> = [];
      for (const uid of mentions.userIds) {
        mentionRows.push({
          message_id: newMessageId,
          mentioned_user_id: uid,
          mention_type: "user",
        });
      }
      // @here / @channel は全チャンネルメンバーに対して 1 行ずつ記録
      // （send-push 側では mention_type で判定するためダミーIDでも良いが、
      //   RLS/DB整合性の観点から自分のIDを入れておく）
      if (mentions.broadcast) {
        mentionRows.push({
          message_id: newMessageId,
          mentioned_user_id: user.id,
          mention_type: mentions.broadcast,
        });
      }
      if (mentionRows.length > 0) {
        const { error: mentionErr } = await supabase
          .from("mentions")
          .insert(mentionRows);
        if (mentionErr) {
          // eslint-disable-next-line no-console
          console.error("[mentions] insert failed:", mentionErr);
        }
      }
    }
  }

  return (
    <div
      className="flex h-full page-enter relative"
      onDragEnter={(e) => {
        // ファイルドラッグのみ対応
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        dragCounterRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setIsDraggingFiles(false);
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDraggingFiles(false);
        const files = Array.from(e.dataTransfer.files);
        // message-input にドロップされたファイルを通知
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("huddle:filesDropped", { detail: { files } })
          );
        }
      }}
    >
      {/* ドラッグ中のフルサイズオーバーレイ */}
      {isDraggingFiles && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-accent/10 backdrop-blur-sm pointer-events-none">
          <div className="rounded-2xl border-4 border-dashed border-accent bg-background/90 px-10 py-8 shadow-2xl">
            <div className="flex flex-col items-center gap-3 text-accent">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <div className="text-lg font-bold">ドロップしてアップロード</div>
              <div className="text-sm text-muted">画像やファイルを送信できます</div>
            </div>
          </div>
        </div>
      )}
      {/* チャンネルエリア */}
      <div className="flex flex-col h-full flex-1 min-w-0">
        {/* チャンネルヘッダー */}
        <header className="flex items-center gap-2 px-3 sm:px-4 py-3 lg:py-0 lg:h-14 border-b border-border bg-header shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
            {/* モバイル戻るボタン */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden shrink-0 p-1 text-muted hover:text-foreground rounded transition-colors"
              aria-label="戻る"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {channel.is_dm ? (
              <h1 className="font-bold text-base sm:text-lg truncate min-w-0">
                {/* DMの相手の名前を表示 */}
                {(() => {
                  const other = messages.find((m) => m.user_id !== currentUserId);
                  return other?.profiles?.display_name || channel.name;
                })()}
              </h1>
            ) : channel.is_hitorigoto ? (
              <>
                <svg className="w-5 h-5 text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
                <h1 className="font-bold text-base sm:text-lg truncate min-w-0">
                  独り言
                </h1>
              </>
            ) : (
              <>
                <span className="text-muted font-medium shrink-0">#</span>
                <h1 className="font-bold text-base sm:text-lg truncate min-w-0">
                  {channel.name}
                </h1>
              </>
            )}
            {channel.topic && (
              <span className="ml-2 text-sm text-muted truncate hidden lg:inline">
                {channel.topic}
              </span>
            )}
          </div>
          <div className="flex items-center shrink-0">
            {/* 全ての操作は ⋯ メニューに集約（タイトルが長くても崩れない） */}
            <div className="relative" ref={overflowMenuRef}>
              <button
                onClick={() => setShowOverflowMenu((v) => !v)}
                className="p-1.5 text-muted hover:text-foreground rounded-lg hover:bg-white/[0.04] transition-colors"
                title="メニュー"
                aria-haspopup="menu"
                aria-expanded={showOverflowMenu}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
                </svg>
              </button>
              {showOverflowMenu && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1 w-56 rounded-xl border border-border bg-sidebar shadow-lg z-20 py-1"
                >
                  {/* 決定事項フィルタ */}
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowOverflowMenu(false);
                      setShowDecisionsOnly((v) => !v);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors ${
                      showDecisionsOnly ? "text-accent" : "text-foreground"
                    }`}
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {showDecisionsOnly ? "すべて表示" : "決定事項のみ表示"}
                  </button>

                  {/* みかん（AIファシリ）トグル: DM・独り言以外で表示 */}
                  {!channel.is_dm && !channel.is_hitorigoto && (
                    <button
                      role="menuitem"
                      onClick={async () => {
                        setShowOverflowMenu(false);
                        const next = !mikanEnabled;
                        const { error } = await supabase.rpc("set_mikan_enabled", {
                          p_channel_id: channel.id,
                          p_enabled: next,
                        });
                        if (error) {
                          alert("みかんの設定変更に失敗しました: " + error.message);
                          return;
                        }
                        setMikanEnabled(next);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors ${
                        mikanEnabled ? "text-accent" : "text-foreground"
                      }`}
                    >
                      <span className="w-4 h-4 shrink-0 inline-flex items-center justify-center text-base leading-none">
                        🍊
                      </span>
                      {mikanEnabled ? "みかんを無効にする" : "みかんを有効にする"}
                    </button>
                  )}

                  {/* ミュートトグル */}
                  <button
                    role="menuitem"
                    onClick={async () => {
                      setShowOverflowMenu(false);
                      const { data, error } = await supabase.rpc("toggle_channel_mute", {
                        p_channel_id: channel.id,
                      });
                      if (!error && typeof data === "boolean") {
                        setIsMuted(data);
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors ${
                      isMuted ? "text-accent" : "text-foreground"
                    }`}
                  >
                    {isMuted ? (
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                    )}
                    {isMuted ? "ミュート解除" : "ミュート"}
                  </button>

                  {/* Wiki（DMでは非表示） */}
                  {!channel.is_dm && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setShowOverflowMenu(false);
                        setShowWiki((v) => !v);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors ${
                        showWiki ? "text-accent" : "text-foreground"
                      }`}
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      {showWiki ? "Wikiを閉じる" : "Wiki"}
                    </button>
                  )}

                  {/* 写真・動画一覧 */}
                  <Link
                    href={`${pathname}/media`}
                    role="menuitem"
                    onClick={() => setShowOverflowMenu(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-white/[0.04] transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    写真・動画
                  </Link>

                  {/* メンバー管理（DMでは非表示） */}
                  {!channel.is_dm && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setShowOverflowMenu(false);
                        setShowMembersModal(true);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-white/[0.04] transition-colors"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      メンバー管理
                    </button>
                  )}

                  {/* カテゴリ変更 (DMでは非表示) */}
                  {!channel.is_dm && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setShowOverflowMenu(false);
                        setCategoryValue(channel.category ?? null);
                        // カテゴリ一覧をDBから動的取得
                        (async () => {
                          const { data } = await supabase
                            .from("workspace_categories")
                            .select("slug, label, sort_order")
                            .eq("workspace_id", channel.workspace_id)
                            .order("sort_order", { ascending: true });
                          setWsCategories((data || []) as WorkspaceCategory[]);
                          setShowCategoryPicker(true);
                        })();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-white/[0.04] transition-colors"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      カテゴリを変更
                    </button>
                  )}

                  {/* チャンネル名変更 / 削除 は general と DM では非表示 */}
                  {!channel.is_dm && channel.slug !== "general" && (
                    <>
                      <div className="my-1 border-t border-border/50" />
                      <button
                        role="menuitem"
                        onClick={async () => {
                          setShowOverflowMenu(false);
                          const input = prompt(
                            "新しいチャンネル名を入力してください",
                            channel.name
                          );
                          if (input === null) return;
                          const trimmed = input.trim();
                          if (!trimmed || trimmed === channel.name) return;
                          const { data, error } = await supabase.rpc("rename_channel", {
                            p_channel_id: channel.id,
                            p_new_name: trimmed,
                          });
                          if (error) {
                            alert("変更に失敗しました: " + error.message);
                            return;
                          }
                          const ch = data as { slug: string } | null;
                          if (ch?.slug) {
                            const wsSlug = window.location.pathname.split("/")[1];
                            window.location.href = `/${wsSlug}/${ch.slug}`;
                          } else {
                            window.location.reload();
                          }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-white/[0.04] transition-colors"
                      >
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        チャンネル名を変更
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setShowOverflowMenu(false);
                          setShowDeleteChannel(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-mention hover:bg-mention/10 transition-colors"
                      >
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        チャンネルを削除
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Wikiバナー */}
        {hasWiki && !showWiki && (
          <div className="px-4 py-2 border-b border-border/50 bg-accent/5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <span>📋</span>
              <span>このチャンネルの使い方が書かれています</span>
            </div>
            <button
              onClick={() => setShowWiki(true)}
              className="text-sm text-accent hover:underline font-medium shrink-0"
            >
              読む
            </button>
          </div>
        )}

        {/* メッセージ一覧 */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
          {/* もっと前のメッセージを読み込むボタン（最上部） */}
          {messages.length > 0 && hasMoreOlder && (
            <div className="flex justify-center mb-4">
              <button
                type="button"
                onClick={async () => {
                  if (loadingOlder) return;
                  const oldest = messages[0];
                  if (!oldest) return;
                  setLoadingOlder(true);
                  // スクロール位置を維持するため、現在のスクロール高さを保存
                  const container = scrollContainerRef.current;
                  const prevScrollHeight = container?.scrollHeight ?? 0;
                  const prevScrollTop = container?.scrollTop ?? 0;
                  try {
                    const { data } = await supabase
                      .from("messages")
                      .select("*, profiles(*), reactions(*)")
                      .eq("channel_id", channel.id)
                      .lt("created_at", oldest.created_at)
                      .is("deleted_at", null)
                      .order("created_at", { ascending: false })
                      .limit(50);
                    if (!data || data.length === 0) {
                      setHasMoreOlder(false);
                    } else {
                      const additions = (data as MessageWithProfile[])
                        .slice()
                        .reverse();
                      setMessages((prev) => {
                        const existingIds = new Set(prev.map((m) => m.id));
                        const fresh = additions.filter((m) => !existingIds.has(m.id));
                        return [...fresh, ...prev];
                      });
                      if (data.length < 50) setHasMoreOlder(false);
                      // 新しい古いメッセージが上に追加されたぶんだけスクロール位置を補正して
                      // 見た目の表示位置をキープする
                      requestAnimationFrame(() => {
                        if (!container) return;
                        const newScrollHeight = container.scrollHeight;
                        container.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;
                      });
                    }
                  } finally {
                    setLoadingOlder(false);
                  }
                }}
                disabled={loadingOlder}
                className="px-4 py-2 text-xs rounded-full border border-border bg-sidebar hover:bg-sidebar-hover transition-colors text-muted disabled:opacity-50"
              >
                {loadingOlder ? "読み込み中…" : "もっと前のメッセージを読み込む"}
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted">
              {channel.is_hitorigoto ? (
                <>
                  <svg className="w-12 h-12 mb-3 text-muted/50" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                  </svg>
                  <p className="text-base font-medium">独り言タイムライン</p>
                  <p className="text-sm mt-1">思ったことを気軽につぶやこう</p>
                </>
              ) : (
                <>
                  <p className="text-base font-medium">#{channel.name} へようこそ</p>
                  <p className="text-sm mt-1">最初のメッセージを送信しましょう</p>
                </>
              )}
            </div>
          ) : channel.is_hitorigoto ? (
            /* 独り言: Twitter/Threads風カード表示（トップレベルのみ） */
            <div>
              {(() => {
                const topLevel = messages.filter((m) => !m.deleted_at && !m.parent_id);
                return topLevel.map((message, index, arr) => {
                  const prev = index > 0 ? arr[index - 1] : null;
                  const currentDate = new Date(message.created_at).toDateString();
                  const prevDate = prev ? new Date(prev.created_at).toDateString() : null;
                  const showDateSeparator = !prev || currentDate !== prevDate;
                  const replyCount = messages.filter((m) => m.parent_id === message.id && !m.deleted_at).length;

                  return (
                    <div key={message.id} className="group">
                      {showDateSeparator && (
                        <DateSeparator date={message.created_at} />
                      )}
                      <HitorigotoPostCard
                        message={message}
                        currentUserId={currentUserId}
                        onDelete={handleDelete}
                        hasPoll={pollMessageIds.has(message.id)}
                      />
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div>
              {/* 決定事項フィルタ表示中のバナー */}
              {showDecisionsOnly && (
                <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-accent/10 border border-accent/20 text-sm text-accent">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  決定事項のみ表示中
                  <button onClick={() => setShowDecisionsOnly(false)} className="ml-auto text-xs hover:underline">解除</button>
                </div>
              )}
              {(() => {
                const displayed = showDecisionsOnly
                  ? messages.filter((m) => m.is_decision)
                  : messages;
                // 引用ブロック表示用の参照マップ (O(1) 親解決)
                const byId = new Map<string, MessageWithProfile>();
                for (const m of messages) byId.set(m.id, m);
                return displayed.map((message, index, arr) => {
                  const prev = index > 0 ? arr[index - 1] : null;
                  // 日付セパレーター: 前のメッセージと日付が異なる場合に表示
                  const currentDate = new Date(message.created_at).toDateString();
                  const prevDate = prev ? new Date(prev.created_at).toDateString() : null;
                  const showDateSeparator = !prev || currentDate !== prevDate;
                  // 全メッセージにユーザー名+時刻を表示（連続投稿でも区別できるように）
                  const isConsecutive = false;
                  const parentMessage = message.parent_id ? byId.get(message.parent_id) ?? null : null;

                  // 未読区切り線: 自分以外のユーザーからの最初の未読メッセージの前に表示する。
                  // 自分自身の投稿は「未読」にはしない（知っている内容なので）が、
                  // 未読判定の「前メッセージが既読か」チェックでは、自分の投稿は "読んだもの扱い" にする。
                  const lastReadTime = myLastReadAt ? new Date(myLastReadAt).getTime() : 0;
                  const msgTime = new Date(message.created_at).getTime();
                  const isNewForMe =
                    !!myLastReadAt &&
                    message.user_id !== currentUserId &&
                    msgTime > lastReadTime;
                  const prevTreatedAsSeen =
                    prev === null ||
                    prev.user_id === currentUserId ||
                    new Date(prev.created_at).getTime() <= lastReadTime;
                  const showUnreadLine = isNewForMe && prevTreatedAsSeen && unreadLineState !== "hidden";

                  return (
                    <div key={message.id}>
                      {showUnreadLine && (
                        <div
                          ref={unreadLineRef}
                          className={`flex items-center gap-2 my-5 px-2 transition-opacity duration-500 ${
                            unreadLineState === "fading" ? "opacity-0" : "opacity-100"
                          }`}
                        >
                          <div className="flex-1 border-t-2 border-red-500" />
                          <span className="text-[11px] font-bold text-white bg-red-500 rounded-full px-2.5 py-0.5 shrink-0">ここから未読</span>
                          <div className="flex-1 border-t-2 border-red-500" />
                        </div>
                      )}
                      {showDateSeparator && (
                        <DateSeparator date={message.created_at} />
                      )}
                      <MessageItem
                        message={message}
                        parentMessage={parentMessage}
                        currentUserId={currentUserId}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onReply={handleReply}
                        onJumpToMessage={handleJumpToMessage}
                        onReact={handleReact}
                        onDecision={handleDecision}
                        onStatus={handleStatus}
                        onUpdateDecisionMeta={handleUpdateDecisionMeta}
                        onBookmark={handleBookmark}
                        isBookmarked={bookmarkedIds.has(message.id)}
                        isConsecutive={isConsecutive}
                        hasPoll={pollMessageIds.has(message.id)}
                        hasEvent={eventMessageIds.has(message.id)}
                        readCount={getReadCount(message)}
                        memberCount={memberCountForRead}
                      />
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        {/* メッセージ入力 */}
        <MessageInput
          channelName={channel.name}
          onSend={handleSend}
          channelId={channel.id}
          workspaceId={channel.workspace_id}
          onCreatePoll={() => setShowCreatePoll(true)}
          onCreateEvent={() => setShowCreateEvent(true)}
          replyTo={replyTo}
          onCancelReply={() => { replyConsumedRef.current = false; setReplyTo(null); }}
        />
      </div>

      {/* 投票作成モーダル */}
      {showCreatePoll && (
        <CreatePollModal
          channelId={channel.id}
          onClose={() => setShowCreatePoll(false)}
        />
      )}

      {/* 予定作成モーダル */}
      {showCreateEvent && (
        <CreateEventModal
          channelId={channel.id}
          onCreated={(messageId) => {
            setShowCreateEvent(false);
            setEventMessageIds((prev) => { const next = new Set(prev); next.add(messageId); return next; });
          }}
          onClose={() => setShowCreateEvent(false)}
        />
      )}

      {/* Wikiパネル */}
      {showWiki && (
        <ChannelWiki
          channelId={channel.id}
          onClose={() => { setShowWiki(false); setHasWiki(true); }}
        />
      )}

      {/* チャンネルメンバー管理モーダル */}
      {showMembersModal && (
        <ChannelMembersModal
          channelId={channel.id}
          workspaceId={channel.workspace_id}
          currentUserId={currentUserId}
          onClose={() => setShowMembersModal(false)}
        />
      )}

      {/* チャンネルカテゴリ変更モーダル */}
      {showCategoryPicker && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !categorySaving && setShowCategoryPicker(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-sidebar border border-border p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">カテゴリを選択</h3>
              <button
                type="button"
                onClick={() => !categorySaving && setShowCategoryPicker(false)}
                className="text-muted hover:text-foreground"
                aria-label="閉じる"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors">
                <input
                  type="radio"
                  name="channel-category"
                  checked={categoryValue === null}
                  onChange={() => setCategoryValue(null)}
                />
                <span className="text-sm text-foreground">未分類</span>
              </label>
              {wsCategories.map((cat) => (
                <label
                  key={cat.slug}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors"
                >
                  <input
                    type="radio"
                    name="channel-category"
                    checked={categoryValue === cat.slug}
                    onChange={() => setCategoryValue(cat.slug)}
                  />
                  <span className="text-sm text-foreground">
                    {cat.label}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => !categorySaving && setShowCategoryPicker(false)}
                className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={categorySaving}
                onClick={async () => {
                  setCategorySaving(true);
                  const { error } = await supabase.rpc("update_channel_category", {
                    p_channel_id: channel.id,
                    p_category: categoryValue,
                  });
                  setCategorySaving(false);
                  if (error) {
                    alert("カテゴリの更新に失敗しました: " + error.message);
                    return;
                  }
                  setShowCategoryPicker(false);
                  // サイドバーに反映するため RSC を再検証
                  router.refresh();
                }}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {categorySaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* チャンネル削除確認ダイアログ */}
      {showDeleteChannel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShowDeleteChannel(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-sidebar border border-border p-6 space-y-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">チャンネルを削除</h3>
            <p className="text-sm text-muted">
              <span className="font-semibold text-foreground">#{channel.name}</span> を削除しますか？メッセージも全て削除されます。この操作は取り消せません。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteChannel(false)}
                className="rounded-xl px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={async () => {
                  setDeletingChannel(true);
                  await supabase.from("channels").delete().eq("id", channel.id);
                  // URLからWSスラグを取得してgeneralにリダイレクト（slugバリデーション付き）
                  const wsSlug = window.location.pathname.split("/")[1];
                  if (/^[a-z0-9\-]+$/.test(wsSlug)) {
                    window.location.href = `/${wsSlug}/general`;
                  } else {
                    window.location.href = "/";
                  }
                }}
                disabled={deletingChannel}
                className="rounded-xl bg-mention px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-colors"
              >
                {deletingChannel ? "削除中..." : "削除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
