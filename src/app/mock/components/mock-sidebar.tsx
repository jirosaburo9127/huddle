"use client";

import { useState } from "react";
import type { MockTheme } from "../theme";

type Category = {
  slug: string;
  label: string;
  color?: string;
  channels: { name: string; unread: number; active: boolean }[];
};

const categories: Category[] = [
  {
    slug: "urgent",
    label: "🔴依頼あり",
    color: "#ef4444",
    channels: [
      { name: "のん旅融資事業計画", unread: 1, active: false },
    ],
  },
  {
    slug: "in_progress",
    label: "進行中",
    color: "#10b981",
    channels: [
      { name: "エリア516｜20260516開催", unread: 3, active: false },
      { name: "三重ミライ会議", unread: 0, active: false },
      { name: "つ七夕まつり", unread: 2, active: false },
      { name: "SADA｜津市商店街等新店舗誘致奨励金", unread: 0, active: false },
    ],
  },
  {
    slug: "appointed",
    label: "アポ決定",
    color: "#f59e0b",
    channels: [
      { name: "中部日本プラスティック｜20260521", unread: 1, active: false },
      { name: "そよら津桜橋｜20260427コンペ", unread: 0, active: false },
      { name: "エリプラ三重大付属中学探求授業", unread: 0, active: false },
    ],
  },
  {
    slug: "regular",
    label: "定期活動",
    color: "#10b981",
    channels: [
      { name: "チームイノベーしよん", unread: 5, active: false },
      { name: "エリプラ", unread: 0, active: false },
      { name: "センパレテナント誘致PJ", unread: 0, active: false },
    ],
  },
  {
    slug: "study",
    label: "学び",
    channels: [
      { name: "みんなでお勉強", unread: 0, active: true },
      { name: "みかんの使い方とアプデ情報", unread: 0, active: false },
    ],
  },
  {
    slug: "todo",
    label: "未着手",
    color: "#f59e0b",
    channels: [
      { name: "ドムドムバーガー誘致", unread: 0, active: false },
      { name: "丸之内｜理事会and総会資料", unread: 0, active: false },
    ],
  },
  {
    slug: "idea",
    label: "アイデアメモ",
    color: "#ef4444",
    channels: [
      { name: "インキュベーションアイデア", unread: 0, active: false },
      { name: "イベントネタ", unread: 0, active: false },
    ],
  },
];

const dms = [
  { name: "奥のすみか", avatar: "奥", online: true, unread: 2 },
  { name: "三藤友喜", avatar: "三", online: false, unread: 0 },
  { name: "しいめぐみ", avatar: "し", online: true, unread: 0 },
  { name: "🤏ふじきんとき🤏", avatar: "ふ", online: true, unread: 0 },
  { name: "たむらいすのひととき", avatar: "た", online: false, unread: 0 },
];

export function MockSidebar({ t }: { t: MockTheme }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["appointed", "regular", "todo", "idea"]));

  const toggle = (slug: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflowY: "auto", padding: "4px 12px",
    }}>
      {/* 進行中 / 決定事項チップ */}
      <div style={{ display: "flex", gap: 6, padding: "8px 4px 8px", flexShrink: 0 }}>
        <button style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "6px 0", height: 34,
          borderRadius: 10, border: "none", cursor: "pointer",
          background: "rgba(56,189,248,0.15)", fontSize: 13, fontWeight: 650, color: t.fg,
        }}>
          進行中
          <span style={{
            fontSize: 11, fontWeight: 700, color: t.sky,
            width: 18, height: 18, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#fff",
          }}>4</span>
        </button>
        <button style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "6px 0", height: 34,
          borderRadius: 10, border: "none", cursor: "pointer",
          background: "rgba(233,104,50,0.12)", fontSize: 13, fontWeight: 650, color: t.fg,
        }}>
          決定
          <span style={{
            fontSize: 11, fontWeight: 700, color: t.accent,
            width: 18, height: 18, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#fff",
          }}>3</span>
        </button>
      </div>

      {/* 独り言プレビュー */}
      <div style={{ display: "flex", alignItems: "center", padding: "6px 8px 4px", flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 650, color: t.fg, opacity: 0.7, flex: 1 }}>独り言</span>
        <span style={{ fontSize: 11, color: t.muted, cursor: "pointer" }}>もっと見る</span>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "2px 4px 10px", overflowX: "auto", minHeight: 56, flexShrink: 0 }}>
        {[
          { content: "田村大明神ご利益", time: "10h", name: "ふじきんとき", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg" },
          { content: "こちらが藤木の脳内。しっくりきた。", time: "昨日", name: "ふじきんとき", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg" },
        ].map((note, i) => (
          <div key={i} style={{
            minWidth: 160, padding: "6px 8px",
            borderRadius: 8, background: "#FFFFFF",
            display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={note.avatarUrl} alt="" style={{
              width: 18, height: 18, borderRadius: 9, objectFit: "cover", flexShrink: 0, marginTop: 1,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: t.fg }}>{note.name}</span>
                <span style={{ fontSize: 9, color: t.muted, marginLeft: "auto" }}>{note.time}</span>
              </div>
              <p style={{
                fontSize: 10.5, lineHeight: 1.35, color: t.muted, margin: "2px 0 0",
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              }}>{note.content}</p>
            </div>
          </div>
        ))}
      </div>

      {/* チャンネル一覧（カテゴリ別） */}
      {categories.map((cat, catIdx) => {
        const isCollapsed = collapsed.has(cat.slug);
        const totalUnread = cat.channels.reduce((sum, ch) => sum + ch.unread, 0);

        return (
          <div key={cat.slug} style={{ marginBottom: 2 }}>
            {/* カテゴリヘッダー */}
            <button
              onClick={() => toggle(cat.slug)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 6,
                padding: "8px 8px 4px", border: "none", background: "none",
                cursor: "pointer", marginTop: catIdx === 0 ? 0 : 10,
              }}
            >
              <svg
                style={{
                  width: 14, height: 14, color: t.muted, flexShrink: 0,
                  transition: "transform 150ms",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                }}
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              <span style={{
                fontSize: 12, fontWeight: 650, color: t.fg, opacity: 0.7,
                flex: 1, textAlign: "left",
              }}>
                {cat.label}
              </span>
              {isCollapsed && totalUnread > 0 && (
                <span style={{
                  width: 20, height: 20, borderRadius: "50%",
                  fontSize: 10, fontWeight: 700, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: t.accent,
                }}>{totalUnread}</span>
              )}
            </button>

            {/* チャンネル行 */}
            {!isCollapsed && cat.channels.map((ch) => (
              <div
                key={ch.name}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "0 10px", height: 36, borderRadius: 8,
                  cursor: "pointer", position: "relative", marginBottom: 1,
                  background: "transparent",
                  color: ch.unread > 0 || ch.active ? t.fg : t.muted,
                  fontWeight: ch.active ? 700 : ch.unread > 0 ? 700 : 500,
                }}
              >
                {ch.active && (
                  <div style={{
                    position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
                    width: 3, height: 26, borderRadius: 999, background: t.sky,
                  }} />
                )}
                <span style={{ fontSize: 16, color: ch.active ? t.sky : t.muted }}>#</span>
                <span style={{
                  fontSize: 14, flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
                }}>
                  {ch.name}
                </span>
                {ch.unread > 0 && (
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%",
                    fontSize: 10, fontWeight: 700, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: t.accent,
                  }}>{ch.unread}</span>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {/* DM */}
      <div style={{ padding: "16px 8px 6px" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: t.muted, opacity: 0.75 }}>
          ダイレクトメッセージ
        </span>
      </div>
      {dms.map((dm) => (
        <div
          key={dm.name}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "0 10px", height: 38, borderRadius: 8,
            cursor: "pointer", marginBottom: 1,
            color: dm.unread > 0 ? t.fg : t.muted,
            fontWeight: dm.unread > 0 ? 700 : 500,
          }}
        >
          <span style={{ position: "relative", display: "inline-flex" }}>
            <span style={{
              width: 28, height: 28, borderRadius: 14,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "#fff", background: t.muted,
            }}>{dm.avatar}</span>
            {dm.online && (
              <span style={{
                position: "absolute", bottom: -1, right: -1,
                width: 10, height: 10, borderRadius: 5,
                border: `2px solid ${t.bgSoft}`, background: t.online,
              }} />
            )}
          </span>
          <span style={{ fontSize: 14, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
            {dm.name}
          </span>
          {dm.unread > 0 && (
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              fontSize: 10, fontWeight: 700, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: t.accent,
            }}>{dm.unread}</span>
          )}
        </div>
      ))}

    </div>
  );
}
