"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useReactorProfiles, type ReactorProfile } from "@/lib/use-reactor-names";
import {
  EmojiPicker,
  MobileReactionSheet,
} from "@/app/(workspace)/[workspace]/[channel]/components/emoji-picker";

export type ReactionEntry = { emoji: string; userId: string };

type Props = {
  reactions: ReactionEntry[];
  currentUserId: string;
  /** リアクションを付ける／外す。渡さないと表示だけになる */
  onToggle?: (emoji: string) => void;
  className?: string;
};

// アイコン画像が無い人の背景色（名前から決まる固定色）
const FACE_COLORS = ["#3E8E7E", "#5B7FD1", "#D9825B", "#8A6BBE", "#C2607F", "#4E9BB5"];
// バッジの中に並べる顔の数。これを超えた分は「+N」にまとめる
const MAX_FACES = 3;

function Face({ profile, size, ring }: { profile: ReactorProfile | undefined; size: number; ring?: boolean }) {
  const ringClass = ring ? "ring-2 ring-[var(--color-surface)]" : "";
  if (profile?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.avatarUrl}
        alt=""
        className={`rounded-full object-cover shrink-0 ${ringClass}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const name = profile?.name || "";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className={`rounded-full shrink-0 flex items-center justify-center font-bold text-white ${ringClass}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        // 名前がまだ分からない間は無地の丸にしておく
        background: name ? FACE_COLORS[hash % FACE_COLORS.length] : "var(--color-border)",
      }}
      aria-hidden="true"
    >
      {name.charAt(0)}
    </span>
  );
}

/** 絵文字なら大きめに、短文のリアクションなら文字として出す */
function ReactionLabel({ emoji, large }: { emoji: string; large?: boolean }) {
  return emoji.length <= 2 ? (
    <span className={large ? "text-2xl" : "text-base"}>{emoji}</span>
  ) : (
    <span className={large ? "text-sm font-bold" : "text-xs font-medium"}>{emoji}</span>
  );
}

/**
 * 投稿に付いたリアクションの一覧。
 * バッジの中に押した人の顔を並べ、誰がどのリアクションを付けたかを開かずに分かるようにする。
 * バッジを押すと、全員分をリアクションごとに名前つきで並べた一覧が開く。
 */
export function ReactionBar({ reactions, currentUserId, onToggle, className }: Props) {
  const [detailEmoji, setDetailEmoji] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  // PC 用のピッカーをスマホでも置くと、その「外側を押したら閉じる」判定が
  // スマホ用シートの中のタップを外側扱いして、選ぶ前に閉じてしまう。画面幅でどちらか片方だけ置く
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const userIds = useMemo(() => Array.from(new Set(reactions.map((r) => r.userId))), [reactions]);
  const profiles = useReactorProfiles(userIds);

  // リアクションごとにまとめる（付いた順を保つ）
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of reactions) {
      const list = map.get(r.emoji) || [];
      if (!list.includes(r.userId)) list.push(r.userId);
      map.set(r.emoji, list);
    }
    return Array.from(map.entries()).map(([emoji, ids]) => ({
      emoji,
      userIds: ids,
      mine: ids.includes(currentUserId),
    }));
  }, [reactions, currentUserId]);

  if (groups.length === 0) return null;

  // 一覧では、押したバッジのリアクションを先頭に出す
  const detailGroups = detailEmoji
    ? [...groups.filter((g) => g.emoji === detailEmoji), ...groups.filter((g) => g.emoji !== detailEmoji)]
    : [];

  return (
    <>
      <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
        {groups.map((group) => {
          const names = group.userIds.map((id) => profiles[id]?.name).filter(Boolean) as string[];
          const rest = group.userIds.length - MAX_FACES;
          return (
            <div key={group.emoji} className="relative group/reaction">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetailEmoji(group.emoji);
                }}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={`${group.emoji} ${group.userIds.length}人: ${names.join("、")}`}
                className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-sm cursor-pointer transition-colors select-none ${
                  group.mine
                    ? "bg-[var(--home-accent-soft)] text-[var(--home-accent-ink)] shadow-[inset_0_0_0_1px_var(--home-accent-line)]"
                    : "bg-surface text-muted shadow-[inset_0_0_0_1px_var(--color-border)] hover:text-foreground"
                }`}
              >
                <ReactionLabel emoji={group.emoji} />
                <span className="flex items-center -space-x-1.5">
                  {group.userIds.slice(0, MAX_FACES).map((id) => (
                    <Face key={id} profile={profiles[id]} size={20} ring />
                  ))}
                </span>
                {rest > 0 && <span className="pr-1 text-xs font-bold">+{rest}</span>}
              </button>
              {/* PC: カーソルを乗せると名前を出す */}
              {names.length > 0 && (
                <div className="hidden lg:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium whitespace-nowrap opacity-0 group-hover/reaction:opacity-100 pointer-events-none transition-opacity duration-100 z-20">
                  {names.join("、")}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground" />
                </div>
              )}
            </div>
          );
        })}
        {/* ＋ボタン: 別のリアクションを付ける */}
        {onToggle && (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowPicker((v) => !v);
              }}
              aria-label="リアクションを追加"
              className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-surface text-muted shadow-[inset_0_0_0_1px_var(--color-border)] hover:text-foreground transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            {showPicker && !isDesktop && (
              <MobileReactionSheet
                onSelect={(emoji) => {
                  setShowPicker(false);
                  onToggle(emoji);
                }}
                onClose={() => setShowPicker(false)}
              />
            )}
            {showPicker && isDesktop && (
              <EmojiPicker
                onSelect={(emoji) => {
                  setShowPicker(false);
                  onToggle(emoji);
                }}
                onClose={() => setShowPicker(false)}
                position="above"
              />
            )}
          </div>
        )}
      </div>

      {/* 誰がどのリアクションを付けたかの一覧。スライド用の枠の内側だと下タブに隠れるので body 直下に出す */}
      {detailEmoji &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center"
            onClick={(e) => {
              e.stopPropagation();
              setDetailEmoji(null);
            }}
          >
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="relative w-full sm:max-w-sm max-h-[75vh] flex flex-col sm:rounded-2xl rounded-t-2xl bg-surface border-t sm:border border-border animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 px-5 pt-4">
                <div className="w-10 h-1 rounded-full bg-muted/30 mx-auto mb-4 sm:hidden" />
                <p className="text-base font-bold text-foreground">リアクションした人（{userIds.length}人）</p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
                {detailGroups.map((group) => (
                  <section key={group.emoji} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-2 border-b border-border pb-2">
                      <ReactionLabel emoji={group.emoji} large />
                      <span className="text-xs font-bold text-muted">{group.userIds.length}人</span>
                      {onToggle && (
                        <button
                          type="button"
                          onClick={() => onToggle(group.emoji)}
                          className={`ml-auto shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${
                            group.mine ? "border-border text-muted" : "border-[var(--home-accent-line)] text-[var(--home-accent-ink)]"
                          }`}
                        >
                          {group.mine ? "取り消す" : "自分も付ける"}
                        </button>
                      )}
                    </div>
                    <ul className="mt-2 space-y-2">
                      {group.userIds.map((id) => (
                        <li key={id} className="flex items-center gap-2.5">
                          <Face profile={profiles[id]} size={28} />
                          <span className="min-w-0 truncate text-sm text-foreground">
                            {profiles[id]?.name || "読み込み中…"}
                            {id === currentUserId && <span className="text-muted">（自分）</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
