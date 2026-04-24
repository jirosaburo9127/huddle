"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  position?: "below" | "above";
};

// よく使う絵文字カテゴリ（外部ライブラリ不要）
// 他所から再利用できるよう export しておく
export const EMOJI_LIST = [
  { category: "よく使う", emojis: ["👍", "❤️", "😂", "🎉", "🔥", "👀", "💯", "✅"] },
  { category: "表情", emojis: ["😊", "😄", "🤔", "😮", "😢", "😡", "🥳", "😎"] },
  { category: "ジェスチャー", emojis: ["👏", "🙌", "🤝", "💪", "✌️", "🫡", "👋", "🙏"] },
  { category: "記号", emojis: ["⭐", "💡", "📌", "🚀", "⚡", "🎯", "📝", "🔔"] },
  { category: "テキスト", emojis: ["完了しました！", "了解しました！", "確認中です", "対応いたします", "ありがとうございます！", "お疲れ様です！"] },
];

export function EmojiPicker({ onSelect, onClose, position = "below" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // マウント時にビューポートから溢れていないかチェックし、必要なら水平方向へオフセットする
  const [xOffset, setXOffset] = useState(0);

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
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let dx = 0;
    if (rect.left < margin) dx = margin - rect.left;
    else if (rect.right > window.innerWidth - margin)
      dx = window.innerWidth - margin - rect.right;
    if (dx !== 0) setXOffset(dx);
  }, []);

  return (
    <div
      ref={ref}
      style={xOffset !== 0 ? { transform: `translateX(${xOffset}px)` } : undefined}
      className={`absolute left-0 w-72 rounded-2xl bg-sidebar border border-border shadow-xl p-3 z-[60] animate-fade-in ${
        position === "above" ? "bottom-full mb-2" : "top-full mt-2"
      }`}
    >
      {EMOJI_LIST.map((group, gi) => (
        <div key={group.category}>
          <p
            className={`text-[11px] text-muted font-medium mb-1 ${gi === 0 ? "" : "mt-2"}`}
          >
            {group.category}
          </p>
          {group.category === "テキスト" ? (
            <div className="flex flex-wrap gap-1">
              {group.emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSelect(emoji)}
                  className="px-2.5 py-1.5 rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] cursor-pointer text-xs font-medium text-foreground transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-8 gap-1">
              {group.emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSelect(emoji)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.06] cursor-pointer text-base transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
