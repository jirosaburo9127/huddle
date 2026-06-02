"use client";

import { CSSProperties, useState } from "react";
import type { MockTheme } from "../theme";

type MockMessage = {
  id: string;
  user: string;
  avatar: string;
  avatarUrl?: string;
  content: string;
  time: string;
  reactions?: { emoji: string; count: number; mine?: boolean }[];
  isAI?: boolean;
  isDecision?: boolean;
  imageUrls?: string[];
};

const messages: MockMessage[] = [
  {
    id: "1", user: "三藤友喜", avatar: "三",
    avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg",
    content: "紙屋だから言うのではなく、マジで紙を使って勉強したほうがいいと思います。\n国民の三大義務の内の一つ「教育の義務」は私たち親が負う義務で、親が教えて育てる上で、読み書きはマストかつ丁寧に行うべきだと思います。\n読み書きに勉め、頭や心を強くする、これが勉強だと感じています。",
    time: "5/18 11:48",
    imageUrls: ["https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/96ff2273-dcb4-4110-80b1-5cb2e819cc7a-20260518103006708_0001.jpg"],
    reactions: [{ emoji: "✅", count: 1 }, { emoji: "❤️", count: 1, mine: true }],
  },
  {
    id: "2", user: "奥のすみか", avatar: "奥",
    avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg",
    content: "藤木さんと私が作りたいおじさん図鑑\nhttps://iwashiro-ojisan.studio.site/",
    time: "5/19 8:52",
    reactions: [{ emoji: "❤️", count: 1, mine: true }, { emoji: "😊", count: 1 }],
  },
  {
    id: "3", user: "しいめぐみ", avatar: "し",
    avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/74fbbcca-fbca-438b-ab86-8da6002b5ecf-1777350382821.png",
    content: "いいなあ、いいなあ。\nトレカやシールを発行して、ポケモン図鑑みたいに埋めたくなる台紙を持ち、街を巡り会いに行く企画も派生アイデアで💡\n\n大人気、福岡のおじさんトレカ\nhttps://www.sankei.com/article/20250323-KMHMUTNPFBKYXLVOIMTBW365JE/",
    time: "5/19 10:10",
    imageUrls: ["https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/d04ac12c-e840-4216-b9d6-e40db0a063ca-IMG_1776.jpeg"],
    reactions: [{ emoji: "❤️", count: 1 }, { emoji: "✌️", count: 1 }],
  },
  {
    id: "4", user: "みかん", avatar: "🍊", isAI: true,
    content: "📎 Candela、水中翼を採用した世界初の電動船「P-12」がストックホルムでテスト成功。従来の高速船より80％少ないエネルギー消費で、最高速30ノット、最大航続距離50海里を実現し、連続生産に入る。\nhttps://drone.jp/news/2023111718175676450.html\n\n— たむらいすのひととき さんが #常滑・津｜観光商業広域連携 に投稿",
    time: "5/21 8:55",
  },
  {
    id: "5", user: "奥のすみか", avatar: "奥",
    avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg",
    content: "【日本映画界の巨匠・小津安二郎の邸宅が、\n1日1組限定の貸切宿として生まれ変わりました】\nhttps://www.youtube.com/watch?v=_57I2fsFpzA\n\n行きたい",
    time: "5/20 15:43",
  },
  {
    id: "6", user: "三藤友喜", avatar: "三",
    avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg",
    content: "近年、紙業界で出前授業と称して紙の重要性と環境性を訴えることを取り組んでいますが、\n絶対そんなこっち目線の授業より、この記事の授業のほうが生徒さんは興味出るわ！と思ってしまいました・・・\n詐欺メイク授業とかなら僕も参加して実際にどんだけ化けるか見てみたいです（笑）",
    time: "5/20 21:41",
    imageUrls: ["https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/caddcf98-09c9-42dd-906a-79df69ea48eb-20260520205243834_0001.jpg"],
  },
  {
    id: "7", user: "三藤友喜", avatar: "三",
    avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg",
    content: "サブカルの代名詞だった本店。最後に一度行きたいですが・・・",
    time: "5/20 21:36",
    imageUrls: ["https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/557d285c-0a96-449c-a369-8b245e303b22-20260520205142508_0001.jpg"],
    reactions: [{ emoji: "😮", count: 1 }],
  },
  {
    id: "8", user: "たむらいすのひととき", avatar: "た",
    content: "明和町商工会より\n\n【あなたの\"こだわり商品\"を都市部へPRしませんか？🌾✨】\n\n三重県の農山漁村資源を活用した商品づくりに取り組む方向けに、販路開拓や商品展開を学べる実践型講座が開催されます。参加費は無料で、都内出展に係る交通費等の補助制度もあります。定員は10名程度。\n\n■募集締切\n令和８年６月１２日（金）",
    time: "5/18 13:20",
    reactions: [{ emoji: "🚀", count: 1 }],
  },
  {
    id: "9", user: "三藤友喜", avatar: "三",
    avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg",
    content: "アート×街ネタです。最新の記事と少し前の記事です。",
    time: "5/18 11:29",
    imageUrls: [
      "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/c2754ab5-cfc9-414b-b466-85397d404d27-20260518103006708_0002.jpg",
      "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/fd068917-d72d-469c-b3d5-fd5eeaa5bd8a-20251128113433545_0001.jpg",
    ],
  },
];

export function MockMessageList({ t, shell }: { t: MockTheme; shell?: CSSProperties }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [actionSheetMsg, setActionSheetMsg] = useState<string | null>(null);
  const isPC = !!shell;

  return (
    <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", background: t.surface }}>
      <div style={{ ...(shell || { padding: "16px 16px" }), paddingTop: 4, paddingBottom: 80 }}>
        {messages.map((msg, i) => {
          const showHeader = i === 0 || messages[i - 1].user !== msg.user;
          return (
            <div
              key={msg.id}
              style={{
                position: "relative",
                marginTop: showHeader ? 32 : 10,
                padding: "6px 8px",
                borderRadius: 10,
                background: shell && hoveredId === msg.id && !msg.isAI && !msg.isDecision ? "rgba(0,0,0,0.015)" : "transparent",
                transition: "background 120ms",
              }}
              onMouseEnter={() => setHoveredId(msg.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => { if (!isPC) setActionSheetMsg(msg.id); }}
            >
              {/* 決定事項背景 */}
              {msg.isDecision && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 12,
                  margin: "-6px -10px", padding: "6px 10px", maxWidth: 1000,
                  background: "rgba(233,104,50,0.05)",
                  zIndex: 0,
                }} />
              )}

              {/* みかんAI背景 */}
              {msg.isAI && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 12,
                  margin: "-6px -10px", padding: "6px 10px", maxWidth: 1000,
                  background: "linear-gradient(135deg, rgba(233,104,50,0.05), rgba(56,189,248,0.06))",
                  zIndex: 0,
                }} />
              )}

              <div style={{
                position: "relative", display: "flex", gap: 12,
                padding: (msg.isAI || msg.isDecision) ? "10px 16px" : undefined,
                maxWidth: (msg.isAI || msg.isDecision) ? 1000 : undefined,
                zIndex: 1,
              }}>
                {/* アバター */}
                {showHeader ? (
                  msg.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={msg.avatarUrl}
                      alt=""
                      style={{
                        width: 34, height: 34, borderRadius: 17,
                        objectFit: "cover", flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div style={{
                      width: 34, height: 34, borderRadius: 17,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0,
                      background: msg.isAI ? `linear-gradient(135deg, ${t.accent}, ${t.sky})` : t.muted,
                    }}>{msg.avatar}</div>
                  )
                ) : (
                  <div style={{ width: 34, flexShrink: 0 }} />
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  {showHeader && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 680, color: t.fg }}>{msg.user}</span>
                      <span style={{ fontSize: 12, fontWeight: 400, color: t.muted, opacity: 0.7 }}>{msg.time}</span>
                      {msg.isDecision && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                          background: t.accentSoft, color: t.accent, lineHeight: 1,
                        }}>決定事項</span>
                      )}
                    </div>
                  )}

                  {/* 本文 */}
                  <p style={{
                    fontSize: msg.isAI ? 15 : 15.5,
                    fontWeight: msg.isAI ? 500 : 450,
                    lineHeight: 1.7, maxWidth: 780,
                    whiteSpace: "pre-wrap", color: t.fg, margin: 0,
                    wordBreak: "break-word",
                  }}>
                    {msg.content}
                  </p>

                  {/* 画像 */}
                  {msg.imageUrls && msg.imageUrls.length > 0 && (
                    <div style={{
                      display: "flex", gap: 6, marginTop: 8, marginBottom: 4, flexWrap: "wrap",
                    }}>
                      {msg.imageUrls.map((url, idx) => {
                        const w = msg.imageUrls!.length === 1 ? 300 : 200;
                        const h = msg.imageUrls!.length === 1 ? 200 : 150;
                        return (
                          <div key={idx} style={{
                            borderRadius: 10, overflow: "hidden",
                            width: w, height: h, flexShrink: 0,
                            background: t.panel,
                          }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt=""
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* リアクション */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 6, marginBottom: 4 }}>
                      {msg.reactions.map((r) => (
                        <button key={r.emoji} style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          padding: "3px 8px", borderRadius: 999,
                          fontSize: 13, cursor: "pointer", lineHeight: 1.4,
                          background: r.mine ? "rgba(233,104,50,0.12)" : "rgba(17,17,17,0.035)",
                          border: "none",
                          color: t.fg,
                        }}>
                          <span style={{ fontSize: 13 }}>{r.emoji}</span>
                          <span style={{ fontSize: 12, fontWeight: 500, color: r.mine ? t.accent : t.muted }}>{r.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ホバーアクションバー — 投稿右下 */}
              {hoveredId === msg.id && shell && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 2,
                  justifyContent: "flex-end",
                  padding: "4px 0 0",
                  zIndex: 2,
                }}>
                  {[
                    { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", label: "決定" },
                    { icon: "M13 10V3L4 14h7v7l9-11h-7z", label: "進行中" },
                    { icon: "M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z", label: "リアクション" },
                    { icon: "M3 10h10a5 5 0 015 5v4M3 10l6 6M3 10l6-6", label: "返信" },
                    { icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z", label: "ブックマーク" },
                  ].map((action) => (
                    <button key={action.label} style={{
                      display: "flex", alignItems: "center", gap: 3,
                      padding: "4px 8px", height: 28, borderRadius: 6,
                      border: "none", cursor: "pointer",
                      background: "rgba(0,0,0,0.04)", color: t.muted,
                      fontSize: 11, fontWeight: 500,
                      transition: "background 120ms",
                    }}>
                      <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={action.icon} />
                      </svg>
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* モバイル: アクションシート */}
      {actionSheetMsg && !isPC && (() => {
        const msg = messages.find((m) => m.id === actionSheetMsg);
        return (
          <>
            <div onClick={() => setActionSheetMsg(null)} style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 50,
            }} />
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 51,
              background: t.surface, borderRadius: "16px 16px 0 0",
              padding: "8px 16px 28px",
            }}>
              {/* ハンドル */}
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: t.border }} />
              </div>

              {/* 投稿プレビュー */}
              {msg && (
                <div style={{
                  padding: "8px 10px", borderRadius: 8, background: t.bgSoft, marginBottom: 12,
                  display: "flex", gap: 8, alignItems: "flex-start",
                }}>
                  {msg.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={msg.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 24, height: 24, borderRadius: 12, background: t.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{msg.avatar}</span>
                  )}
                  <p style={{ fontSize: 12, lineHeight: 1.4, color: t.muted, margin: 0, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{msg.content}</p>
                </div>
              )}

              {/* クイックリアクション */}
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14 }}>
                {["👍", "❤️", "😊", "🔥", "✅", "👀"].map((emoji) => (
                  <button key={emoji} onClick={() => setActionSheetMsg(null)} style={{
                    width: 40, height: 40, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, border: "none", cursor: "pointer",
                    background: "rgba(0,0,0,0.04)",
                  }}>{emoji}</button>
                ))}
              </div>

              {/* アクション一覧 — 2列 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                {[
                  { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", label: "決定事項にする" },
                  { icon: "M13 10V3L4 14h7v7l9-11h-7z", label: "進行中にする" },
                  { icon: "M3 10h10a5 5 0 015 5v4M3 10l6 6M3 10l6-6", label: "返信する" },
                  { icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z", label: "ブックマーク" },
                  { icon: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z", label: "編集" },
                  { icon: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0", label: "削除", danger: true },
                ].map((action) => (
                  <button key={action.label} onClick={() => setActionSheetMsg(null)} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 10px", borderRadius: 10, border: "none",
                    background: "none", cursor: "pointer",
                    textAlign: "left",
                  }}>
                    <svg style={{ width: 18, height: 18, color: "danger" in action && action.danger ? "#ef4444" : t.fg, opacity: 0.5, flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={action.icon} />
                    </svg>
                    <span style={{ fontSize: 13.5, color: "danger" in action && action.danger ? "#ef4444" : t.fg }}>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
