"use client";

import type { CSSProperties } from "react";
import type { MockTheme } from "../theme";

const tools = [
  { label: "ファイルを添付", icon: "M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" },
  { label: "メンション", icon: "M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 10-2.636 6.364M16.5 12V8.25" },
  { label: "投票", icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" },
  { label: "カレンダー", icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" },
  { label: "決定", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", hasLabel: true },
];

export function MockMessageInput({ t, shell }: { t: MockTheme; shell?: CSSProperties }) {
  const isPC = !!shell;

  return (
    <div style={{
      background: t.surface, flexShrink: 0,
    }}>
      <div style={{ ...(shell || { padding: "0 16px" }), paddingTop: isPC ? 4 : 12, paddingBottom: 12 }}>
        {/* PC: ツールバー */}
        {isPC && (
          <div style={{ display: "flex", gap: 2, padding: "0 2px 6px" }}>
            {tools.map((tool) => (
              "hasLabel" in tool && tool.hasLabel ? (
                <button key={tool.label} title={tool.label} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", height: 30, borderRadius: 6,
                  border: `1px solid ${t.border}`, background: "none", cursor: "pointer",
                  color: t.muted, fontSize: 12, fontWeight: 500,
                }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={tool.icon} />
                  </svg>
                  {tool.label}
                </button>
              ) : (
                <button key={tool.label} title={tool.label} style={{
                  width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 6, border: "none", background: "none", cursor: "pointer",
                  color: t.muted, opacity: 0.7,
                }}>
                  <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={tool.icon} />
                  </svg>
                </button>
              )
            ))}
          </div>
        )}

        {/* 入力欄 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 6px 6px 14px", borderRadius: 14,
          background: t.bgSoft, border: `1px solid ${t.border}`,
        }}>
          {/* モバイル: +ボタン */}
          {!isPC && (
            <button style={{
              width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 14, border: "none", background: "none", cursor: "pointer",
              color: t.muted, flexShrink: 0,
            }}>
              <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          )}

          {/* テキスト入力 */}
          <div style={{ flex: 1, fontSize: 15, padding: "8px 0", color: t.muted }}>
            メッセージを入力...
          </div>

          {/* 送信ボタン */}
          <button style={{
            width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 17, border: "none", cursor: "pointer", flexShrink: 0,
            background: t.accent, color: "#FFFFFF",
          }}>
            <svg style={{ width: 16, height: 16 }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
