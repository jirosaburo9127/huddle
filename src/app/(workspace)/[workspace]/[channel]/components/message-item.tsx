"use client";

import { memo, useState, useRef, useEffect, useMemo } from "react";
import type { MessageWithProfile, Reaction } from "@/lib/supabase/types";
import { EmojiPicker } from "./emoji-picker";
import { PollDisplay } from "./poll-display";
import { EventDisplay } from "./event-display";

type Props = {
  message: MessageWithProfile;
  parentMessage?: MessageWithProfile | null;
  currentUserId: string;
  onEdit: (messageId: string, newContent: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onReply?: (message: MessageWithProfile) => void;
  onJumpToMessage?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => Promise<void>;
  onDecision?: (messageId: string, isDecision: boolean) => Promise<void>;
  onStatus?: (messageId: string, status: "in_progress" | "done") => Promise<void>;
  onUpdateDecisionMeta?: (
    messageId: string,
    why: string | null,
    due: string | null
  ) => Promise<void>;
  onBookmark?: (messageId: string) => Promise<void>;
  isBookmarked?: boolean;
  isConsecutive?: boolean;
  hasPoll?: boolean;
  hasEvent?: boolean;
  readCount?: number; // -1: 非表示（他人の投稿）、0以上: 既読数
  memberCount?: number; // 自分以外のメンバー数
};

// Supabase Storage URLかどうか判定
function isStorageFileUrl(content: string): boolean {
  const trimmed = content.trim();
  // 改行を含むテキストは通常メッセージとして扱う
  if (trimmed.includes("\n")) return false;
  return /^https:\/\/.*supabase.*\/storage\/v1\/object\/public\/chat-files\//.test(trimmed);
}

// 画像拡張子かどうか判定
function isImageFile(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url);
}

// 動画拡張子かどうか判定
function isVideoFile(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url);
}

// URLからファイル名を抽出
function extractFileName(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/");
    const lastSegment = segments[segments.length - 1];
    // UUID-filename.ext の形式からファイル名部分を取得
    const match = lastSegment.match(/^[0-9a-f-]+-(.+)$/);
    return match ? decodeURIComponent(match[1]) : decodeURIComponent(lastSegment);
  } catch {
    return "ファイル";
  }
}

// HTMLタグをエスケープ（XSS対策）
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// MarkdownをパースしてHTML文字列に変換（最小対応）
function parseMarkdown(text: string): string {
  // まずHTMLタグをエスケープ
  let html = escapeHtml(text);

  // コードブロック（```...```）
  html = html.replace(/```([\s\S]*?)```/g, (_match, code: string) => {
    return `<pre class="bg-white/[0.06] rounded-lg p-3 my-1 overflow-x-auto"><code class="text-sm font-mono">${code.trim()}</code></pre>`;
  });

  // インラインコード（`...`）
  html = html.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    return `<code class="bg-white/[0.06] px-1.5 py-0.5 rounded text-sm font-mono">${code}</code>`;
  });

  // 太字（**...**）
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // 危険なURLスキームをブロック（javascript:, vbscript:, data:（画像以外））
  html = html.replace(/(?:javascript|vbscript):/gi, "blocked:");
  html = html.replace(/data:(?!image\/)/gi, "blocked:");

  // URLの自動リンク化（コードブロック/インラインコード内を除く）
  // 末尾の句読点・括弧・空白はURLから外す（日本語の句点・読点含む）
  html = html.replace(
    /(?<!["=>])(https?:\/\/[^\s<]+)/g,
    (_m, raw: string) => {
      // 末尾の不要文字を剥がす（日本語句読点・閉じ括弧・記号）
      const trimmed = raw.replace(/[。、．，）\])\}>"'`,.!?;:]+$/u, "");
      const dropped = raw.slice(trimmed.length);
      return (
        `<a href="${trimmed}" target="_blank" rel="noopener noreferrer" ` +
        `class="inline-flex items-center gap-1 text-accent underline underline-offset-2 decoration-accent/50 hover:decoration-accent break-all">` +
        `<svg class="inline-block w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true">` +
        `<path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>` +
        `</svg>` +
        `<span>${trimmed}</span>` +
        `</a>` +
        dropped
      );
    }
  );

  // @メンション: 前後がスペース/行頭行末で囲まれた短い名前のみハイライト。
  // メンション挿入時に「@name 」(末尾スペース付き) で保存されるため、
  // 文中の普通の @ (例: test@example.com, @以降の長文) は反応しない。
  html = html.replace(
    /(^|[\s>])@([\w.\-\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u00A0()（）]{1,30})(?=[\s<]|$)/g,
    (_m, before: string, name: string) => {
      // 旧来の @channel 表記は表示だけ @All に置き換える (DB互換のため)
      const displayName = name === "channel" ? "All" : name.replace(/\u00A0/g, " ");
      return `${before}<span class="text-accent font-semibold">@${displayName}</span><br/>`;
    }
  );

  return html;
}

// Storage URLを行単位で検出して分離する
function splitContentAndFiles(content: string): { textLines: string[]; fileUrls: string[] } {
  const lines = content.split("\n");
  const textLines: string[] = [];
  const fileUrls: string[] = [];
  for (const line of lines) {
    if (isStorageFileUrl(line)) {
      fileUrls.push(line.trim());
    } else {
      textLines.push(line);
    }
  }
  return { textLines, fileUrls };
}

// メッセージ本文のレンダリング（テキスト + ファイルの混在対応）
function MessageContent({
  content,
  imageError,
  onImageError,
  onImageClick,
}: {
  content: string;
  imageError: boolean;
  onImageError: () => void;
  onImageClick?: (url: string) => void;
}) {
  const { textLines, fileUrls } = splitContentAndFiles(content);
  const textContent = textLines.join("\n").trim();

  return (
    <div>
      {/* テキスト部分 */}
      {textContent && (
        <div
          className="text-base leading-[1.65] text-foreground whitespace-pre-wrap break-words [&_pre]:whitespace-pre [&_pre]:my-2"
          dangerouslySetInnerHTML={{ __html: parseMarkdown(textContent) }}
        />
      )}
      {/* ファイル部分 */}
      {fileUrls.map((url, i) => {
        const fileName = extractFileName(url);
        if (isImageFile(url) && !imageError) {
          return (
            <div key={i} className="mt-1">
              <img
                src={url}
                alt={fileName}
                className="max-w-full sm:max-w-xs max-h-80 rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onImageClick?.(url);
                }}
                onError={onImageError}
              />
              <span className="text-xs text-muted mt-1 block">{fileName}</span>
            </div>
          );
        }
        if (isVideoFile(url)) {
          return (
            <div key={i} className="mt-1" onClick={(e) => e.stopPropagation()}>
              {/* PC: MP4はインライン再生、MOVは保存して再生 */}
              <div className="hidden lg:block max-w-full sm:max-w-sm">
                <a
                  href={url}
                  download={fileName}
                  className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-black/70 to-black/90 border border-white/10 py-4 px-5 hover:from-black/60 hover:to-black/80 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-medium text-white">動画を保存して再生</div>
                    <div className="text-xs text-white/50">{fileName}</div>
                  </div>
                </a>
              </div>
              {/* モバイル: タップでネイティブ動画プレーヤー起動（Chatwork方式） */}
              <button
                type="button"
                className="lg:hidden max-w-full sm:max-w-sm rounded-2xl bg-gradient-to-br from-black/70 to-black/90 border border-white/10 flex items-center gap-4 py-4 px-5 w-full"
                onClick={() => {
                  // iOSネイティブ: WKScriptMessageHandlerでAVPlayer起動
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const webkit = (window as any).webkit;
                  if (webkit?.messageHandlers?.playVideo) {
                    webkit.messageHandlers.playVideo.postMessage(url);
                  } else {
                    window.open(url, "_blank");
                  }
                }}
              >
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <div className="text-left min-w-0">
                  <div className="text-sm font-medium text-white">動画を再生</div>
                  <div className="text-xs text-white/50 truncate">{fileName}</div>
                </div>
              </button>
            </div>
          );
        }
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-border/50 hover:border-accent/30 transition-colors"
          >
            <svg className="w-5 h-5 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span className="text-sm text-accent">{fileName}</span>
            <svg className="w-4 h-4 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        );
      })}
    </div>
  );
}

// モバイル絵文字ピッカー用の定数
const QUICK_EMOJIS = [
  { category: "よく使う", emojis: ["👍", "❤️", "😂", "🎉", "🔥", "👀", "💯", "✅"] },
  { category: "表情", emojis: ["😊", "😄", "🤔", "😮", "😢", "😡", "🥳", "😎"] },
  { category: "ジェスチャー", emojis: ["👏", "🙌", "🤝", "💪", "✌️", "🫡", "👋", "🙏"] },
  { category: "記号", emojis: ["⭐", "💡", "📌", "🚀", "⚡", "🎯", "📝", "🔔"] },
  { category: "テキスト", emojis: ["完了しました！", "了解！", "確認中", "対応します", "ありがとう！", "お疲れ様！"] },
];

// リアクションバッジコンポーネント
// タップ: 同じ絵文字を追加/解除（Zoom方式）
// 長押し: 誰がリアクションしたか表示
// ＋ボタン: 絵文字ピッカーを開く（LINE方式）
function ReactionBadges({
  reactions,
  onReact,
}: {
  reactions: Array<{ emoji: string; count: number; reacted: boolean; names: string[] }>;
  onReact?: (emoji: string) => void;
}) {
  const [longPressNames, setLongPressNames] = useState<{ emoji: string; names: string[]; reacted: boolean } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showQuickPicker, setShowQuickPicker] = useState(false);

  // モバイル: タップで誰がリアクションしたかモーダル表示
  function handleTap(emoji: string, names: string[], reacted: boolean) {
    setLongPressNames({ emoji, names, reacted });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {reactions.map(({ emoji, count, reacted, names }) => (
          <div key={emoji} className="relative group/reaction">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (typeof window !== "undefined" && window.innerWidth >= 1024) {
                  // PC: クリックでトグル
                  onReact?.(emoji);
                } else {
                  // モバイル: タップで誰がリアクションしたかモーダル表示
                  handleTap(emoji, names, reacted);
                }
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border cursor-pointer transition-colors select-none ${
                reacted
                  ? "bg-accent/10 border-accent/30 text-accent"
                  : "bg-white/[0.03] border-border/50 text-muted hover:border-accent/30"
              }`}
            >
              {emoji.length <= 2 ? (
                <span className="text-base">{emoji}</span>
              ) : (
                <span className="text-xs font-medium">{emoji}</span>
              )}
              <span>{count}</span>
            </button>
            {/* PC: ホバーツールチップ */}
            {names.length > 0 && (
              <div className="hidden lg:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium whitespace-nowrap opacity-0 group-hover/reaction:opacity-100 pointer-events-none transition-opacity duration-100 z-20">
                {names.join("、")}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground" />
              </div>
            )}
          </div>
        ))}
        {/* ＋ボタン: 新しいリアクションを追加 */}
        {onReact && (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowQuickPicker((v) => !v);
              }}
              className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-border/50 bg-white/[0.03] text-muted hover:text-accent hover:border-accent/30 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            {showQuickPicker && (
              <>
                {/* モバイル: 画面下からスライドアップ（LINE方式） */}
                <div className="fixed inset-0 z-[60] flex items-end lg:hidden" onClick={() => setShowQuickPicker(false)}>
                  <div className="absolute inset-0 bg-black/40" />
                  <div className="relative w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
                    <div className="w-full rounded-t-2xl bg-sidebar border-t border-border shadow-xl p-4 pb-20">
                      {QUICK_EMOJIS.map((group) => (
                        <div key={group.category} className="mb-3">
                          <p className="text-[11px] text-muted font-medium mb-1.5">{group.category}</p>
                          {group.category === "テキスト" ? (
                            <div className="flex flex-wrap gap-1.5">
                              {group.emojis.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => { setShowQuickPicker(false); onReact(emoji); }}
                                  className="px-3 py-2 rounded-xl border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] text-sm font-medium text-foreground transition-colors"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="grid grid-cols-8 gap-1.5">
                              {group.emojis.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => { setShowQuickPicker(false); onReact(emoji); }}
                                  className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/[0.06] text-xl transition-colors"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {/* PC: 上方向に表示 */}
                <div className="hidden lg:block">
                  <EmojiPicker
                    onSelect={(em) => { setShowQuickPicker(false); onReact(em); }}
                    onClose={() => setShowQuickPicker(false)}
                    position="above"
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {/* 長押し: リアクターモーダル */}
      {longPressNames && (
        <div
          className="fixed inset-0 z-[60] flex items-end lg:hidden"
          onClick={() => setLongPressNames(null)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full rounded-t-2xl bg-sidebar border-t border-border px-5 pt-4 pb-20 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-muted/30 mx-auto mb-4" />
            <div className="flex items-center gap-2 mb-3">
              {longPressNames.emoji.length <= 2 ? (
                <span className="text-2xl">{longPressNames.emoji}</span>
              ) : (
                <span className="text-sm font-semibold bg-accent/10 border border-accent/30 rounded-full px-2.5 py-0.5">{longPressNames.emoji}</span>
              )}
              <span className="text-base font-semibold text-foreground">リアクションした人</span>
            </div>
            <div className="space-y-2.5 mb-4">
              {longPressNames.names.map((name) => (
                <div key={name} className="text-sm text-foreground">{name}</div>
              ))}
            </div>
            {onReact && (
              <button
                onClick={() => { onReact(longPressNames.emoji); setLongPressNames(null); }}
                className={`w-full py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                  longPressNames.reacted
                    ? "text-red-400 border-red-400/30 hover:bg-red-400/10"
                    : "text-accent border-accent/30 hover:bg-accent/10"
                }`}
              >
                {longPressNames.reacted ? "取り消す" : "追加する"}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export const MessageItem = memo(function MessageItem({
  message,
  parentMessage,
  currentUserId,
  onEdit,
  onDelete,
  onReply,
  onJumpToMessage,
  onReact,
  onDecision,
  onStatus,
  onUpdateDecisionMeta,
  onBookmark,
  isBookmarked,
  isConsecutive,
  hasPoll,
  hasEvent,
  readCount = -1,
  memberCount = 0,
}: Props) {
  const profile = message.profiles;
  const isOwn = message.user_id === currentUserId;
  // timeZone を固定して SSR/CSR の hydration mismatch を防ぐ
  const time = new Date(message.created_at).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
  const initial = (profile?.display_name || "?")[0].toUpperCase();
  // オンライン判定: last_seen_atが5分以内
  const isOnline = profile?.last_seen_at
    ? Date.now() - new Date(profile.last_seen_at).getTime() < 5 * 60 * 1000
    : false;

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [emojiPickerLocation, setEmojiPickerLocation] = useState<"action" | "inline" | null>(null);
  const [imageError, setImageError] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [mobileEmojiOpen, setMobileEmojiOpen] = useState(false);

  // 他所で「すべてのアクションメニューを閉じて」と言われたら閉じる。
  // スレッドを開いた瞬間にアクションシート/絵文字ピッカーを自動で畳むのに使う。
  useEffect(() => {
    function close() {
      setShowActions(false);
      setMobileEmojiOpen(false);
    }
    window.addEventListener("huddle:closeAllActions", close);
    return () => window.removeEventListener("huddle:closeAllActions", close);
  }, []);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showDecisionMetaModal, setShowDecisionMetaModal] = useState(false);
  const [metaWhyInput, setMetaWhyInput] = useState("");
  const [metaDueInput, setMetaDueInput] = useState("");
  const [metaSaving, setMetaSaving] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // リアクションを絵文字ごとにグループ化
  const groupedReactions = useMemo(() => {
    const reactions = message.reactions || [];
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) {
      const list = map.get(r.emoji) || [];
      list.push(r);
      map.set(r.emoji, list);
    }
    return Array.from(map.entries()).map(([emoji, list]) => ({
      emoji,
      count: list.length,
      reacted: list.some((r) => r.user_id === currentUserId),
      names: list.map((r) => r.display_name || "").filter(Boolean),
    }));
  }, [message.reactions, currentUserId]);

  // 絵文字ピッカーで選択時
  function handleEmojiSelect(emoji: string) {
    setEmojiPickerLocation(null);
    onReact?.(message.id, emoji);
  }

  // 編集モード開始時にフォーカス + 既存コンテンツ長に応じた自動リサイズ
  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      const el = editTextareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      // 既存メッセージが長い場合は開いた瞬間に広げる
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.6) + "px";
    }
  }, [isEditing]);

  // 投票締切・決定登録のシステムメッセージ — 控えめなセンタリング表示
  if (
    message.system_event === "poll_closed" ||
    message.system_event === "decision_marked"
  ) {
    return (
      <div className="flex justify-center my-2">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent/30 bg-accent/5 text-xs text-accent">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="truncate max-w-xs">{message.content}</span>
        </div>
      </div>
    );
  }

  // 削除済みメッセージは完全に非表示 (プレースホルダも出さない)
  if (message.deleted_at) {
    return null;
  }

  async function handleSaveEdit() {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await onEdit(message.id, trimmed);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(false);
    await onDelete(message.id);
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      setIsEditing(false);
      return;
    }
    // 通常投稿と同じ操作: Alt+Enter or Cmd+Enter で保存、Enter は改行
    if (e.key === "Enter" && (e.altKey || e.metaKey)) {
      e.preventDefault();
      handleSaveEdit();
    }
  }

  return (
    <>
      <div
        id={`msg-${message.id}`}
        className={`group relative flex gap-3 px-2 rounded-lg transition-colors ${
          isConsecutive ? "py-1" : "pt-3 pb-1"
        } ${
          message.status === "in_progress"
            ? "bg-blue-400/[0.06] hover:bg-blue-400/[0.1]"
            : "hover:bg-white/[0.02]"
        }`}
        onClick={(e) => {
          // テキストをドラッグ選択した直後の click は無視する
          // （そうしないとコピーのために選択した瞬間にメニューが開く）
          const selection = typeof window !== "undefined" ? window.getSelection() : null;
          if (selection && selection.toString().length > 0) return;
          // クリック対象がリンク(または子孫)の場合はブラウザで URL を開く動作を優先し
          // アクションメニューは出さない
          const target = e.target as HTMLElement | null;
          if (target && target.closest("a")) return;
          // PC ではアクションシートは開かない (lg:hidden なので無効)。
          // モバイルだけトグル。
          if (typeof window !== "undefined" && window.innerWidth >= 1024) return;
          setShowActions((v) => !v);
        }}
      >
        {/* アバター or 左マージン（連続メッセージ時） */}
        {isConsecutive ? (
          <div className="shrink-0 w-9 flex items-center justify-center">
            {/* ホバー時に時刻を表示 */}
            <span className="text-xs text-muted/70 opacity-0 group-hover:opacity-100 transition-opacity select-none">
              {time}
            </span>
          </div>
        ) : (
          <div className="relative shrink-0 w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent text-[13px] font-bold mt-0.5">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.display_name}
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              initial
            )}
            {/* オンラインドット */}
            {isOnline && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-online border-2 border-background" />
            )}
          </div>
        )}

        {/* メッセージ本文 */}
        <div className="min-w-0 flex-1">
          {/* ユーザー名と時刻（先頭メッセージのみ） */}
          {!isConsecutive && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-semibold text-base ${isOwn ? "text-accent" : "text-foreground"}`}>
                {profile?.display_name || "不明なユーザー"}
              </span>
              <span className="text-sm text-muted/70">{time}</span>
              {message.edited_at && (
                <span className="text-sm text-muted/70">(編集済み)</span>
              )}
              {message.is_decision && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-400/15 text-[11px] font-semibold text-red-400">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  決定
                </span>
              )}
              {message.status === "in_progress" && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-400/15 text-[11px] font-semibold text-blue-400">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  進行中
                </span>
              )}
            </div>
          )}

          {isEditing ? (
            <div className="mt-1">
              <textarea
                ref={editTextareaRef}
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  // 入力に応じて高さを自動調整 (最大 60vh まで)
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.6) + "px";
                }}
                onKeyDown={handleEditKeyDown}
                className="w-full resize-none rounded-lg border border-border bg-input-bg px-3 py-2 text-base leading-relaxed text-foreground focus:border-accent focus:outline-none overflow-y-auto"
                style={{ minHeight: "6rem", maxHeight: "60vh" }}
                rows={4}
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editContent.trim()}
                  className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  保存
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="rounded-lg px-3 py-1 text-xs text-muted hover:text-foreground transition-colors"
                >
                  キャンセル
                </button>
                <span className="text-xs text-muted ml-auto">Escでキャンセル</span>
              </div>
            </div>
          ) : (
            <>
              {/* Chatwork風の引用ブロック: 返信メッセージの冒頭に元メッセージを表示 */}
              {message.parent_id && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (parentMessage) onJumpToMessage?.(parentMessage.id);
                  }}
                  className="mt-1 mb-2 w-full text-left rounded-lg bg-accent/[0.06] hover:bg-accent/[0.1] transition-colors overflow-hidden"
                >
                  {parentMessage ? (
                    <>
                      {/* 返信先ヘッダー: アバター + 表示名 + 時刻 */}
                      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                        <svg
                          className="w-3.5 h-3.5 text-accent shrink-0"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                          />
                        </svg>
                        {parentMessage.profiles?.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={parentMessage.profiles.avatar_url}
                            alt={parentMessage.profiles.display_name}
                            className="w-5 h-5 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <span className="shrink-0 w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                            {(parentMessage.profiles?.display_name || "?")[0].toUpperCase()}
                          </span>
                        )}
                        <span className="text-xs font-semibold text-accent truncate">
                          {parentMessage.profiles?.display_name || "元メッセージ"}
                        </span>
                        <span className="text-[11px] text-muted/70 shrink-0">
                          {new Date(parentMessage.created_at).toLocaleTimeString("ja-JP", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Tokyo",
                          })}
                        </span>
                      </div>
                      {/* 返信先本文プレビュー: 改行/連続空白は1個の半角スペースに潰して
                          line-clamp-2 が自然に折り返せるようにする。
                          whitespace-pre-wrap と組み合わせると改行位置で変に途切れるため */}
                      <div className="px-3 pb-2 pl-10 text-[13px] text-muted truncate break-words leading-snug">
                        {parentMessage.deleted_at
                          ? "(削除されたメッセージ)"
                          : isStorageFileUrl(parentMessage.content)
                            ? `📎 ${extractFileName(parentMessage.content.trim())}`
                            : parentMessage.content.replace(/\s+/g, " ").trim()}
                      </div>
                    </>
                  ) : (
                    <div className="px-3 py-2 text-xs text-muted">元メッセージ (読み込み中)</div>
                  )}
                </button>
              )}
              <MessageContent
                content={message.content}
                imageError={imageError}
                onImageError={() => setImageError(true)}
                onImageClick={setLightboxUrl}
              />
              {/* 投票 (message に紐づく polls 行がある時だけ) */}
              {hasPoll && (
                <PollDisplay
                  messageId={message.id}
                  currentUserId={currentUserId}
                  onMarkDecision={(id) => onDecision?.(id, true)}
                />
              )}
              {/* 予定 (message に紐づく events 行がある時だけ) */}
              {hasEvent && (
                <EventDisplay
                  messageId={message.id}
                  currentUserId={currentUserId}
                />
              )}
              {/* 連続メッセージで編集済みの場合、本文の後に表示 */}
              {isConsecutive && message.edited_at && (
                <span className="text-xs text-muted/70">(編集済み)</span>
              )}
            </>
          )}


          {/* 決定事項 Why/Due 編集モーダル */}
          {showDecisionMetaModal && onUpdateDecisionMeta && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
              onClick={() => !metaSaving && setShowDecisionMetaModal(false)}
            >
              <div
                className="w-full max-w-md rounded-2xl bg-sidebar border border-border p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold">決定事項の追記</h3>
                  <button
                    type="button"
                    onClick={() => !metaSaving && setShowDecisionMetaModal(false)}
                    className="text-muted hover:text-foreground"
                    aria-label="閉じる"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase mb-1">
                    Why（理由・背景）
                  </label>
                  <textarea
                    value={metaWhyInput}
                    onChange={(e) => setMetaWhyInput(e.target.value)}
                    placeholder="なぜこの決定に至ったか"
                    rows={3}
                    className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase mb-1">
                    Due（期限・期日）
                  </label>
                  <input
                    type="text"
                    value={metaDueInput}
                    onChange={(e) => setMetaDueInput(e.target.value)}
                    placeholder="例: 2026/05/15 / 月末まで / 次回MTGまで"
                    className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => !metaSaving && setShowDecisionMetaModal(false)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-border text-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    disabled={metaSaving}
                    onClick={async () => {
                      setMetaSaving(true);
                      try {
                        await onUpdateDecisionMeta(
                          message.id,
                          metaWhyInput.trim() || null,
                          metaDueInput.trim() || null
                        );
                        setShowDecisionMetaModal(false);
                      } finally {
                        setMetaSaving(false);
                      }
                    }}
                    className="px-4 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                  >
                    {metaSaving ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* リアクションバッジ */}
          {groupedReactions.length > 0 && !isEditing && (
            <ReactionBadges
              reactions={groupedReactions}
              onReact={onReact ? (emoji: string) => onReact(message.id, emoji) : undefined}
            />
          )}

          {/* 既読表示（LINE方式: 自分の投稿にのみ表示） */}
          {readCount >= 0 && !isEditing && (
            <div className="mt-1 text-right">
              <span className="text-[11px] text-muted/70">
                {readCount > 0
                  ? memberCount <= 1
                    ? "既読"
                    : `既読 ${readCount}`
                  : ""}
              </span>
            </div>
          )}

          {/* PC: アクションバー（ホバーで表示、メッセージ右下） */}
          {!isEditing && (
          <div className="hidden lg:flex absolute -bottom-2 right-3 z-10 transition-opacity items-center gap-0.5 bg-sidebar/95 backdrop-blur-sm border border-border/60 rounded-lg px-1 py-0.5 shadow-lg opacity-0 group-hover:opacity-100">
            {/* 決定ボタン */}
            {onDecision && (
              <button
                onClick={(e) => { e.stopPropagation(); onDecision(message.id, !message.is_decision); }}
                className={`flex items-center gap-1 px-2.5 py-1 text-[13px] font-medium border rounded-md transition-all active:scale-90 ${
                  message.is_decision
                    ? "text-accent border-accent/40 bg-accent/10"
                    : "text-muted hover:text-accent border-transparent hover:border-accent/30 hover:bg-accent/5"
                }`}
              >
                <svg className="w-4 h-4" fill={message.is_decision ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {message.is_decision ? "決定済" : "決定"}
              </button>
            )}
            {/* 進行中ボタン */}
            {onStatus && (
              <button
                onClick={(e) => { e.stopPropagation(); onStatus(message.id, "in_progress"); }}
                className={`flex items-center gap-1 px-2.5 py-1 text-[13px] font-medium border rounded-md transition-all active:scale-90 ${
                  message.status === "in_progress"
                    ? "text-blue-400 border-blue-400/40 bg-blue-400/10"
                    : "text-muted hover:text-blue-400 border-transparent hover:border-blue-400/30 hover:bg-blue-400/5"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {message.status === "in_progress" ? "進行中" : "進行中"}
              </button>
            )}
            <div className="w-px h-4 bg-border/50 mx-0.5" />
            {onReact && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setEmojiPickerLocation((v) => v === "action" ? null : "action"); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  リアクション
                </button>
                {emojiPickerLocation === "action" && (
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={() => setEmojiPickerLocation(null)}
                    position="above"
                  />
                )}
              </div>
            )}
            {onReply && (
              <button
                onClick={(e) => { e.stopPropagation(); onReply(message); }}
                className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                返信
              </button>
            )}
            {/* ブックマーク */}
            {onBookmark && (
              <button
                onClick={(e) => { e.stopPropagation(); onBookmark(message.id); }}
                className={`flex items-center gap-1 px-2 py-0.5 text-[13px] border border-transparent hover:border-border/50 rounded transition-colors ${
                  isBookmarked ? "text-accent" : "text-muted hover:text-accent"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                ブックマーク
              </button>
            )}
            {isOwn && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditContent(message.content); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-accent border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  編集
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsDeleting(true); }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px] text-muted hover:text-mention border border-transparent hover:border-border/50 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  削除
                </button>
              </>
            )}
          </div>
        )}
        </div>
      </div>

      {/* モバイル: Chatwork風アクションモーダル */}
      {showActions && !isEditing && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center lg:hidden"
          onClick={(e) => { e.stopPropagation(); setShowActions(false); }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-sm mx-4 mb-20 rounded-2xl bg-sidebar border border-border p-5 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-3">
              {/* 返信 */}
              {onReply && (
                <button
                  onClick={() => { setShowActions(false); onReply(message); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                  </span>
                  <span className="text-xs text-foreground">返信</span>
                </button>
              )}
              {/* 決定事項トグル（モバイル）— Huddleの推し機能、最も目立つ位置 */}
              {onDecision && (
                <button
                  onClick={() => { setShowActions(false); onDecision(message.id, !message.is_decision); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] active:scale-90 transition-all"
                >
                  <span className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${message.is_decision ? "border-accent bg-accent/15" : "border-muted/40"}`}>
                    <svg className={`w-5 h-5 ${message.is_decision ? "text-accent" : "text-foreground"}`} fill={message.is_decision ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <span className={`text-xs ${message.is_decision ? "text-accent font-semibold" : "text-foreground"}`}>
                    {message.is_decision ? "決定済" : "決定"}
                  </span>
                </button>
              )}
              {/* 進行中トグル（モバイル） */}
              {onStatus && (
                <button
                  onClick={() => { setShowActions(false); onStatus(message.id, "in_progress"); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] active:scale-90 transition-all"
                >
                  <span className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${message.status === "in_progress" ? "border-blue-400 bg-blue-400/15" : "border-muted/40"}`}>
                    <svg className={`w-5 h-5 ${message.status === "in_progress" ? "text-blue-400" : "text-foreground"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </span>
                  <span className={`text-xs ${message.status === "in_progress" ? "text-blue-400 font-semibold" : "text-foreground"}`}>
                    進行中
                  </span>
                </button>
              )}
              {/* リアクション（タップでアクションモーダルを閉じ、絵文字ピッカーを別で開く） */}
              {onReact && (
                <button
                  onClick={() => { setShowActions(false); setMobileEmojiOpen(true); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <span className="text-xs text-foreground">リアクション</span>
                </button>
              )}
              {/* ブックマーク（モバイル） */}
              {onBookmark && (
                <button
                  onClick={() => { setShowActions(false); onBookmark(message.id); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${isBookmarked ? "border-accent/40" : "border-muted/40"}`}>
                    <svg className={`w-5 h-5 ${isBookmarked ? "text-accent" : "text-foreground"}`} fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </span>
                  <span className={`text-xs ${isBookmarked ? "text-accent" : "text-foreground"}`}>ブックマーク</span>
                </button>
              )}
              {/* 編集 */}
              {isOwn && (
                <button
                  onClick={() => { setShowActions(false); setIsEditing(true); setEditContent(message.content); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-muted/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </span>
                  <span className="text-xs text-foreground">編集</span>
                </button>
              )}
              {/* 削除 */}
              {isOwn && (
                <button
                  onClick={() => { setShowActions(false); setIsDeleting(true); }}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-12 h-12 rounded-full border-2 border-mention/40 flex items-center justify-center">
                    <svg className="w-5 h-5 text-mention" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </span>
                  <span className="text-xs text-mention">削除</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}


      {/* 削除確認ダイアログ */}
      {isDeleting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm max-h-[85vh] rounded-xl bg-sidebar border border-border flex flex-col">
            {/* ヘッダー (固定) */}
            <div className="px-6 pt-6 pb-2 shrink-0">
              <h3 className="text-lg font-bold">メッセージを削除</h3>
            </div>
            {/* プレビュー (スクロール領域) */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2">
              <div className="rounded-lg bg-background/50 p-3 text-sm text-muted whitespace-pre-wrap break-words">
                {message.content}
              </div>
              <p className="text-sm text-muted mt-3">このメッセージを削除しますか？</p>
            </div>
            {/* フッターボタン (固定) */}
            <div className="px-6 pt-2 pb-6 shrink-0 flex justify-end gap-2 border-t border-border/50">
              <button
                onClick={() => setIsDeleting(false)}
                className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors mt-4"
              >
                キャンセル
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-mention px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-colors mt-4"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* モバイル: アクションモーダルから開く絵文字ピッカー（下からスライド） */}
      {mobileEmojiOpen && onReact && (
        <div className="fixed inset-0 z-[60] flex items-end lg:hidden" onClick={() => setMobileEmojiOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-full rounded-t-2xl bg-sidebar border-t border-border shadow-xl p-4 pb-20">
              {QUICK_EMOJIS.map((group) => (
                <div key={group.category} className="mb-3">
                  <p className="text-[11px] text-muted font-medium mb-1.5">{group.category}</p>
                  {group.category === "テキスト" ? (
                    <div className="flex flex-wrap gap-1.5">
                      {group.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => { setMobileEmojiOpen(false); onReact(message.id, emoji); }}
                          className="px-3 py-2 rounded-xl border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] text-sm font-medium text-foreground transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-8 gap-1.5">
                      {group.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => { setMobileEmojiOpen(false); onReact(message.id, emoji); }}
                          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/[0.06] text-xl transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 画像ライトボックス（アプリ内フルスクリーン表示） */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          {/* 上部ボタン群 */}
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
            {/* ダウンロードボタン */}
            <a
              href={lightboxUrl}
              download
              onClick={(e) => e.stopPropagation()}
              className="w-12 h-12 rounded-full bg-black/60 border border-white/30 hover:bg-black/80 flex items-center justify-center transition-colors shadow-lg"
              aria-label="ダウンロード"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>
            {/* 閉じるボタン */}
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              className="w-12 h-12 rounded-full bg-black/60 border border-white/30 hover:bg-black/80 flex items-center justify-center transition-colors shadow-lg"
              aria-label="閉じる"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* 画像 — ピンチズーム可能に */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="拡大画像"
            className="max-w-full max-h-full object-contain rounded-lg select-none"
            style={{ touchAction: "pinch-zoom" }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
});
