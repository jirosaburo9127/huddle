"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  loadReactionPrefs,
  saveReactionPrefs,
  getCachedReactionPrefs,
  type ReactionPrefs,
} from "@/lib/reaction-prefs";

type Props = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  position?: "below" | "above";
};

// よく使う絵文字カテゴリ（外部ライブラリ不要）
// 他所から再利用できるよう export しておく
// kind: "text" は短文定型文（ボタン表示）、"emoji" は通常の絵文字グリッド表示
export type EmojiGroup = { kind: "emoji" | "text"; category: string; emojis: string[] };

export const EMOJI_LIST: EmojiGroup[] = [
  { kind: "emoji", category: "よく使う", emojis: ["👍", "❤️", "😂", "🎉", "🔥", "👀", "💯", "✅", "🚀"] },
  { kind: "emoji", category: "表情", emojis: ["😊", "😄", "🤔", "😮", "😢", "😡", "🥳", "😎"] },
  { kind: "emoji", category: "ジェスチャー", emojis: ["👏", "🙌", "🤝", "💪", "✌️", "🫡", "👋", "🙏"] },
  { kind: "text", category: "テキスト", emojis: ["承知いたしました！", "よろしくお願いいたします！", "完了しました！", "了解しました！", "確認中です", "対応いたします", "ありがとうございます！", "お疲れ様です！", "禿同", "かしこ", "m9", "それな", "あざます", "orz"] },
];

export function EmojiPicker({ onSelect, onClose, position = "below" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // マウント時にビューポートから溢れていないかチェックし、必要なら水平方向へオフセットする
  const [xOffset, setXOffset] = useState(0);

  // ユーザー個別のリアクション設定（追加した自分用候補 / 非表示にしたプリセット）
  const [prefs, setPrefs] = useState<ReactionPrefs>(() => getCachedReactionPrefs());
  const [editing, setEditing] = useState(false);
  const [newReaction, setNewReaction] = useState("");

  useEffect(() => {
    let alive = true;
    loadReactionPrefs().then((p) => {
      if (alive) setPrefs(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 外側クリックで閉じる
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // 次のtickで登録（開いたクリックで即閉じないように）
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // マウント直後に画面内に収まるよう水平位置を補正（左右どちらにはみ出しても対応）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let dx = 0;
    if (rect.left < margin) dx = margin - rect.left;
    else if (rect.right > window.innerWidth - margin)
      dx = window.innerWidth - margin - rect.right;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (dx !== 0) setXOffset(dx);
  }, []);

  function persist(next: ReactionPrefs) {
    setPrefs(next);
    saveReactionPrefs(next);
  }

  function removeReaction(emoji: string, isCustom: boolean) {
    if (isCustom) {
      persist({ ...prefs, custom: prefs.custom.filter((e) => e !== emoji) });
    } else {
      // プリセットは「非表示」に追加（他人には影響しない）
      persist({ ...prefs, hidden: prefs.hidden.includes(emoji) ? prefs.hidden : [...prefs.hidden, emoji] });
    }
  }

  function addReaction() {
    const v = newReaction.trim();
    if (!v) return;
    if (!prefs.custom.includes(v)) {
      persist({ custom: [...prefs.custom, v], hidden: prefs.hidden.filter((h) => h !== v) });
    }
    setNewReaction("");
  }

  // 表示するグループ: マイリアクション(custom) + プリセット(非表示を除外)
  const customGroup: EmojiGroup = { kind: "text", category: "マイリアクション", emojis: prefs.custom };
  const presetGroups = EMOJI_LIST
    .map((g) => ({ ...g, emojis: g.emojis.filter((e) => !prefs.hidden.includes(e)) }))
    .filter((g) => g.emojis.length > 0);
  const groups: EmojiGroup[] =
    prefs.custom.length > 0 || editing ? [customGroup, ...presetGroups] : presetGroups;

  return (
    <div
      ref={ref}
      style={xOffset !== 0 ? { transform: `translateX(${xOffset}px)` } : undefined}
      className={`absolute left-0 w-72 rounded-2xl bg-surface border border-border shadow-xl p-3 z-[60] animate-fade-in ${
        position === "above" ? "bottom-full mb-2" : "top-full mt-2"
      }`}
    >
      {/* ヘッダー: 編集トグル */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-muted font-medium">リアクション</p>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="text-[11px] font-medium text-accent px-1.5 py-0.5 rounded hover:bg-white/[0.06] transition-colors"
        >
          {editing ? "完了" : "編集"}
        </button>
      </div>

      {editing && (
        <div className="flex gap-1 mb-2">
          <input
            value={newReaction}
            onChange={(e) => setNewReaction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addReaction();
              }
            }}
            placeholder="絵文字や短文を追加"
            maxLength={40}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-border/50 text-xs text-foreground outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={addReaction}
            className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium shrink-0"
          >
            追加
          </button>
        </div>
      )}

      {groups.map((group, gi) => (
        <div key={group.category}>
          <p className={`text-[11px] text-muted font-medium mb-1 ${gi === 0 ? "" : "mt-2"}`}>
            {group.category}
          </p>
          <div className={group.kind === "text" ? "flex flex-wrap gap-1" : "grid grid-cols-8 gap-1"}>
            {group.emojis.map((emoji) => {
              const isCustom = prefs.custom.includes(emoji);
              const chipClass =
                group.kind === "text"
                  ? "px-2.5 py-1.5 rounded-lg border border-border/50 bg-white/[0.03] text-xs font-medium text-foreground"
                  : "w-8 h-8 flex items-center justify-center rounded-lg text-base";
              return (
                <span key={emoji} className="relative inline-flex">
                  <button
                    type="button"
                    onClick={() => {
                      if (!editing) onSelect(emoji);
                    }}
                    className={`${chipClass} ${editing ? "opacity-90" : "hover:bg-white/[0.06] cursor-pointer"} transition-colors`}
                  >
                    {emoji}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      onClick={() => removeReaction(emoji, isCustom)}
                      aria-label="削除"
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-mention text-white text-[11px] leading-none flex items-center justify-center shadow"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
            {editing && group.category === "マイリアクション" && group.emojis.length === 0 && (
              <span className="text-[11px] text-muted py-1">上の欄から自分用の候補を追加できます</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
