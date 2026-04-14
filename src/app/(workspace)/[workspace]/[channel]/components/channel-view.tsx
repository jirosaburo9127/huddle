"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import type { Channel, Message, MessageWithProfile, Reaction } from "@/lib/supabase/types";
import { useRouter } from "next/navigation";
import { MessageItem } from "./message-item";
import { MessageInput, type MentionPayload } from "./message-input";
import { ThreadPanel } from "./thread-panel";
import { DateSeparator } from "./date-separator";
import { ChannelWiki } from "./channel-wiki";
import { ChannelMembersModal } from "@/components/channel-members-modal";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { showMessageNotification } from "@/lib/notification";
import { clearPushBadge } from "@/lib/push-notifications";

type Props = {
  channel: Channel;
  initialMessages: MessageWithProfile[];
  currentUserId: string;
};

export function ChannelView({ channel, initialMessages, currentUserId }: Props) {
  // zustand セレクタ形式: 購読範囲を setSidebarOpen のみに限定
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const router = useRouter();
  const [messages, setMessages] = useState<MessageWithProfile[]>(initialMessages);
  const [activeThread, setActiveThread] = useState<MessageWithProfile | null>(null);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showDeleteChannel, setShowDeleteChannel] = useState(false);
  const [deletingChannel, setDeletingChannel] = useState(false);
  const [showDecisionsOnly, setShowDecisionsOnly] = useState(false);
  const [showWiki, setShowWiki] = useState(false);
  const [hasWiki, setHasWiki] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [isMuted, setIsMuted] = useState(false);
  const [muteUpdating, setMuteUpdating] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(initialMessages.length);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  // このタブが自分で送信して既に楽観的反映済みのメッセージID集合。
  // Realtime購読では「同一ユーザーかどうか」ではなく「このタブで送ったか」で判定するのが正しい。
  // （PCとiPhoneで同じユーザーでログインしている場合に、片方の送信がもう片方に届かなくなるため）
  const sentMessageIdsRef = useRef<Set<string>>(new Set());
  // messages の最新参照を ref で保持することで、handleReact 等の useCallback が
  // messages の変更ごとに再生成されるのを回避する（大量メッセージでの性能劣化対策）
  const messagesRef = useRef<MessageWithProfile[]>(initialMessages);
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

  // モバイル: チャンネルURL直アクセス（プッシュ通知タップや共有リンク）では
  // サイドバーを閉じてチャンネルビューを前面に出す
  useEffect(() => {
    setSidebarOpen(false);
    // チャンネルを開いた時点でiOSアプリアイコンのバッジと配信済み通知をクリア
    // userIdを渡すことで、他チャンネルに残っている未読数とバッジを正しく同期する
    clearPushBadge(currentUserId);
  }, [channel.id, setSidebarOpen, currentUserId]);

  // このチャンネルの自分のミュート状態を取得（チャンネル切替時に再取得）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("channel_members")
        .select("muted")
        .eq("channel_id", channel.id)
        .eq("user_id", currentUserId)
        .maybeSingle();
      if (!cancelled) {
        setIsMuted(Boolean(data?.muted));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channel.id, currentUserId, supabase]);

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

  // ミュート ON/OFF 切替
  const handleToggleMute = useCallback(async () => {
    if (muteUpdating) return;
    setMuteUpdating(true);
    const nextMuted = !isMuted;
    // 楽観的更新
    setIsMuted(nextMuted);
    const { error } = await supabase
      .from("channel_members")
      .update({ muted: nextMuted })
      .eq("channel_id", channel.id)
      .eq("user_id", currentUserId);
    setMuteUpdating(false);
    if (error) {
      // ロールバック
      setIsMuted(!nextMuted);
      // eslint-disable-next-line no-console
      console.error("[mute] update failed:", error);
      return;
    }
    // サイドバーに通知（バッジ即時反映のため）
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("huddle:muteChanged", {
          detail: { channelId: channel.id, muted: nextMuted },
        })
      );
    }
  }, [isMuted, muteUpdating, channel.id, currentUserId, supabase]);

  // スレッドを開く
  const handleOpenThread = useCallback((msg: MessageWithProfile) => {
    // 同時に開いているモバイルのアクションシート/絵文字ピッカーを全部畳む
    // （タップした本人の MessageItem は onClick 側で閉じるが、
    //  スレッド内から別メッセージのリアクション選択中にスレッド遷移した場合などに残るため）
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("huddle:closeAllActions"));
    }
    setActiveThread(msg);
  }, []);

  // スレッド返信数の変更を親メッセージに反映
  const handleReplyCountChange = useCallback((parentId: string, delta: number) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === parentId ? { ...m, reply_count: m.reply_count + delta } : m
      )
    );
    // activeThreadも更新
    setActiveThread((prev) =>
      prev && prev.id === parentId
        ? { ...prev, reply_count: prev.reply_count + delta }
        : prev
    );
  }, []);

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

  // チャンネル切替時: 最新メッセージ位置まで即スクロール（初回マウント・URL直アクセス対応）
  useEffect(() => {
    // レイアウト確定後にスクロールさせるため次のフレームで実行
    const id = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    });
    prevMessageCountRef.current = initialMessages.length;
    return () => cancelAnimationFrame(id);
  }, [channel.id, initialMessages.length]);

  // 新着メッセージ追加時のみ自動スクロール
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

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
          // parent_idがあるものはスレッド返信なので無視
          if (payload.new.parent_id) return;

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
                ? { ...m, content: updated.content, edited_at: updated.edited_at, deleted_at: updated.deleted_at, is_decision: updated.is_decision ?? m.is_decision, reply_count: updated.reply_count }
                : m
            )
          );
        }
      )
      .subscribe();

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
      // 直近50件をDBから取り直し、ローカルに無いものだけマージする
      //（最新が消える系のバグは「ローカルに無いはずの新しい行」を補えれば直る）
      const { data } = await supabase
        .from("messages")
        .select("*, profiles(*), reactions(*)")
        .eq("channel_id", channel.id)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        .limit(50);

      if (cancelled || !data || data.length === 0) return;

      // created_at 昇順に戻す
      const fresh = (data as MessageWithProfile[])
        .slice()
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime()
        );

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const additions = fresh.filter((m) => !existingIds.has(m.id));
        if (additions.length === 0) return prev;
        // 新しい分を末尾に足し、created_at 昇順で再ソート
        // （DB由来の古い行が混ざってもインデックス上は正しい位置に挿入される）
        const merged = [...prev, ...additions];
        merged.sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime()
        );
        return merged;
      });
    }

    // マウント直後に1回必ず走らせる
    syncMissedMessages();

    function onVisible() {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        syncMissedMessages();
      }
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    // 保険: 15秒ごとにバックグラウンドで再同期
    // Realtime の取りこぼしや optimistic 更新のドリフトを定期的に直す
    const poll = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      syncMissedMessages();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
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
        "この投稿を「決定事項」としてマークしますか？\n進捗ダッシュボードに表示されます。"
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
    options?: { isDecision?: boolean }
  ) {
    if (content.length > 4000) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const isDecision = options?.isDecision ?? false;

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
      parent_id: null,
      content,
      edited_at: null,
      deleted_at: null,
      is_decision: isDecision,
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

    // クライアント発行の UUID をそのまま使って DB に挿入
    const { data, error } = await supabase.from("messages").insert({
      id: newMessageId,
      channel_id: channel.id,
      user_id: user.id,
      content,
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
    <div className="flex h-full page-enter">
      {/* チャンネルエリア */}
      <div className="flex flex-col h-full flex-1 min-w-0">
        {/* チャンネルヘッダー */}
        <header className="flex items-center gap-2 px-3 sm:px-4 py-3 border-b border-border bg-header shrink-0">
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
            <span className="text-muted font-medium shrink-0">#</span>
            <h1 className="font-bold text-lg sm:text-2xl truncate min-w-0">
              {channel.name}
            </h1>
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

                  {/* ミュート */}
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowOverflowMenu(false);
                      handleToggleMute();
                    }}
                    disabled={muteUpdating}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors disabled:opacity-50 ${
                      isMuted ? "text-accent" : "text-foreground"
                    }`}
                  >
                    {isMuted ? (
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    )}
                    {isMuted ? "ミュート解除" : "ミュート"}
                  </button>

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
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted">
              <p className="text-lg font-medium">#{channel.name} へようこそ</p>
              <p className="text-sm mt-1">最初のメッセージを送信しましょう</p>
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
              {(showDecisionsOnly ? messages.filter((m) => m.is_decision) : messages).map((message, index, arr) => {
                const prev = index > 0 ? arr[index - 1] : null;
                // 日付セパレーター: 前のメッセージと日付が異なる場合に表示
                const currentDate = new Date(message.created_at).toDateString();
                const prevDate = prev ? new Date(prev.created_at).toDateString() : null;
                const showDateSeparator = !prev || currentDate !== prevDate;
                // 連続メッセージ判定: 同一ユーザーかつ5分以内
                const isConsecutive =
                  !showDateSeparator &&
                  prev !== null &&
                  prev.user_id === message.user_id &&
                  !prev.deleted_at &&
                  new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;

                return (
                  <div key={message.id}>
                    {showDateSeparator && (
                      <DateSeparator date={message.created_at} />
                    )}
                    <MessageItem
                      message={message}
                      currentUserId={currentUserId}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onOpenThread={handleOpenThread}
                      onReact={handleReact}
                      onDecision={handleDecision}
                      onUpdateDecisionMeta={handleUpdateDecisionMeta}
                      onBookmark={handleBookmark}
                      isBookmarked={bookmarkedIds.has(message.id)}
                      isConsecutive={isConsecutive}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* メッセージ入力 */}
        <MessageInput
          channelName={channel.name}
          onSend={handleSend}
          channelId={channel.id}
          workspaceId={channel.workspace_id}
        />
      </div>

      {/* スレッドパネル */}
      {activeThread && (
        <ThreadPanel
          parentMessage={activeThread}
          currentUserId={currentUserId}
          channelId={channel.id}
          workspaceId={channel.workspace_id}
          myProfile={myProfile}
          onClose={() => setActiveThread(null)}
          onReplyCountChange={handleReplyCountChange}
          onDecision={handleDecision}
          onBookmark={handleBookmark}
          bookmarkedIds={bookmarkedIds}
        />
      )}

      {/* Wikiパネル */}
      {showWiki && !activeThread && (
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
          isPrivate={channel.is_private}
          onClose={() => setShowMembersModal(false)}
        />
      )}

      {/* チャンネル削除確認ダイアログ */}
      {showDeleteChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteChannel(false)}>
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
