"use client";

import { useEffect, useRef } from "react";

type Props = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

// よく使う絵文字カテゴリ（外部ライブラリ不要）
const EMOJI_LIST = [
  { category: "よく使う", emojis: ["👍", "❤️", "😂", "🎉", "🔥", "👀", "💯", "✅"] },
  { category: "表情", emojis: ["😊", "😄", "🤔", "😮", "😢", "😡", "🥳", "😎"] },
  { category: "ジェスチャー", emojis: ["👏", "🙌", "🤝", "💪", "✌️", "🫡", "👋", "🙏"] },
  { category: "記号", emojis: ["⭐", "💡", "📌", "🚀", "⚡", "🎯", "📝", "🔔"] },
];

export function EmojiPicker({ onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-2 left-0 w-72 rounded-2xl bg-sidebar border border-border shadow-xl p-3 z-[60] animate-fade-in"
    >
      {EMOJI_LIST.map((group, gi) => (
        <div key={group.category}>
          <p
            className={`text-[11px] text-muted font-medium mb-1 ${gi === 0 ? "" : "mt-2"}`}
          >
            {group.category}
          </p>
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
        </div>
      ))}
    </div>
  );
}
