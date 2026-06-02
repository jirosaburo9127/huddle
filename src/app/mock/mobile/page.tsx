"use client";

import { useState } from "react";
import "../mock-globals.css";
import { themes, type MockTheme } from "../theme";
import { MockBottomTab, type TabId } from "../components/mock-bottom-tab";
import { MockMessageList } from "../components/mock-message-list";
import { MockMessageInput } from "../components/mock-message-input";

type Screen = { tab: TabId } | { tab: "channel"; name: string } | { tab: "dmlist" } | { tab: "dmchat"; name: string } | { tab: "activity" };

type Category = {
  label: string;
  color?: string;
  channels: { name: string; unread: number }[];
};

const categories: Category[] = [
  {
    label: "🔴依頼あり",
    color: "#ef4444",
    channels: [
      { name: "のん旅融資事業計画", unread: 1 },
    ],
  },
  {
    label: "進行中",
    color: "#10b981",
    channels: [
      { name: "エリア516｜20260516開催", unread: 3 },
      { name: "三重ミライ会議", unread: 0 },
      { name: "つ七夕まつり", unread: 2 },
      { name: "SADA｜津市商店街等新店舗誘致奨励金", unread: 0 },
    ],
  },
  {
    label: "アポ決定",
    color: "#f59e0b",
    channels: [
      { name: "中部日本プラスティック｜20260521", unread: 1 },
      { name: "そよら津桜橋｜20260427コンペ", unread: 0 },
      { name: "エリプラ三重大付属中学探求授業", unread: 0 },
    ],
  },
  {
    label: "定期活動",
    color: "#10b981",
    channels: [
      { name: "チームイノベーしよん", unread: 5 },
      { name: "エリプラ", unread: 0 },
      { name: "センパレテナント誘致PJ", unread: 0 },
    ],
  },
  {
    label: "未着手",
    color: "#f59e0b",
    channels: [
      { name: "ドムドムバーガー誘致", unread: 0 },
      { name: "丸之内｜理事会and総会資料", unread: 0 },
    ],
  },
  {
    label: "アイデアメモ",
    color: "#ef4444",
    channels: [
      { name: "インキュベーションアイデア", unread: 0 },
      { name: "イベントネタ", unread: 0 },
    ],
  },
];

export default function MockMobilePage() {
  const t = themes.dawn;
  const [screen, setScreen] = useState<Screen>({ tab: "home" });

  const currentTab = "tab" in screen ? screen.tab : "home";

  const handleTabChange = (tab: TabId) => {
    setScreen({ tab });
  };

  const openChannel = (name: string) => {
    setScreen({ tab: "channel", name });
  };

  return (
    <div style={{
      minHeight: "100vh", background: t.bgSoft, overflowX: "hidden",
      fontFamily: "'Helvetica Neue', 'Hiragino Sans', 'Noto Sans JP', Arial, sans-serif",
      display: "flex", justifyContent: "center", paddingTop: 16,
    }}>
      <div style={{
        width: 390, border: `1px solid ${t.border}`, borderRadius: 24,
        overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
      }}>
        <div style={{
          height: "min(844px, calc(100vh - 72px))", display: "flex", flexDirection: "column",
          overflow: "hidden", background: t.surface, position: "relative",
        }}>
          <StatusBar t={t} />

          {"tab" in screen && screen.tab === "home" && (
            <HomeScreen t={t} onOpenChannel={openChannel} activeTab="home" onTabChange={handleTabChange} onDmTap={() => setScreen({ tab: "dmlist" })} onActivityTap={() => setScreen({ tab: "activity" })} />
          )}
          {"tab" in screen && screen.tab === "channel" && (screen as { tab: "channel"; name: string }).name === "独り言" && (
            <HitorigotoScreen t={t} onBack={() => setScreen({ tab: "home" })} />
          )}
          {"tab" in screen && screen.tab === "channel" && (screen as { tab: "channel"; name: string }).name !== "独り言" && (
            <ChannelScreen t={t} channelName={(screen as { tab: "channel"; name: string }).name} onBack={() => setScreen({ tab: "home" })} activeTab="home" onTabChange={handleTabChange} />
          )}
          {"tab" in screen && screen.tab === "inprogress" && (
            <TabScreen t={t} title="進行中" activeTab="inprogress" onTabChange={handleTabChange}>
              <InProgressScreen t={t} />
            </TabScreen>
          )}
          {"tab" in screen && screen.tab === "decision" && (
            <TabScreen t={t} title="決定事項" activeTab="decision" onTabChange={handleTabChange}>
              <DecisionScreen t={t} />
            </TabScreen>
          )}
          {"tab" in screen && screen.tab === "calendar" && (
            <TabScreen t={t} title="カレンダー" activeTab="calendar" onTabChange={handleTabChange}>
              <CalendarScreen t={t} />
            </TabScreen>
          )}
          {"tab" in screen && screen.tab === "activity" && (
            <ActivityScreen t={t} onBack={() => setScreen({ tab: "home" })} />
          )}
          {"tab" in screen && screen.tab === "dmlist" && (
            <DmListScreen t={t} onOpenDm={(name: string) => setScreen({ tab: "dmchat", name })} onBack={() => setScreen({ tab: "home" })} />
          )}
          {"tab" in screen && screen.tab === "dmchat" && (
            <DmChatScreen t={t} name={(screen as { tab: "dmchat"; name: string }).name} onBack={() => setScreen({ tab: "dmlist" })} />
          )}
          {"tab" in screen && screen.tab === "post" && (
            <QuickPostSheet t={t} onClose={() => setScreen({ tab: "home" })} />
          )}
          {"tab" in screen && screen.tab === "album" && (
            <TabScreen t={t} title="アルバム" activeTab="album" onTabChange={handleTabChange}>
              <AlbumScreen t={t} />
            </TabScreen>
          )}
          {"tab" in screen && screen.tab === "more" && (
            <TabScreen t={t} title="その他" activeTab="more" onTabChange={handleTabChange}>
              <MoreScreen t={t} />
            </TabScreen>
          )}
        </div>
      </div>
    </div>
  );
}

/* ステータスバー */
function StatusBar({ t }: { t: MockTheme }) {
  return (
    <div style={{
      height: 54, display: "flex", alignItems: "flex-end",
      justifyContent: "space-between", padding: "0 24px 8px",
      background: t.surface, flexShrink: 0,
    }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: t.fg }}>9:41</span>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <svg style={{ width: 16, height: 12, color: t.fg }} fill="currentColor" viewBox="0 0 24 16">
          <rect x="0" y="4" width="4" height="12" rx="1" />
          <rect x="6" y="2" width="4" height="14" rx="1" />
          <rect x="12" y="0" width="4" height="16" rx="1" />
          <rect x="18" y="3" width="4" height="13" rx="1" opacity="0.3" />
        </svg>
        <svg style={{ width: 25, height: 12, color: t.fg }} fill="currentColor" viewBox="0 0 25 12">
          <rect x="0" y="0.5" width="21" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />
          <rect x="1.5" y="2" width="16" height="8" rx="1" />
          <rect x="22" y="3.5" width="2.5" height="5" rx="1" opacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

/* ヘッダーアイコン（DM・通知・アバター） */
function HeaderIcons({ t, onDmTap, onActivityTap }: { t: MockTheme; onDmTap?: () => void; onActivityTap?: () => void }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      <button onClick={onDmTap} style={{
        position: "relative", width: 44, height: 44,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 10, background: "none", border: "none", cursor: "pointer", color: t.fg,
        transform: "translateX(10px)",
      }}>
        <svg style={{ width: 23, height: 23, transform: "translateY(-1px)" }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
      </button>
      <button onClick={onActivityTap} style={{
        position: "relative", width: 44, height: 44,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 10, background: "none", border: "none", cursor: "pointer", color: t.fg,
      }}>
        <svg style={{ width: 23, height: 23 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span style={{
          position: "absolute", top: 4, right: 4,
          width: 15, height: 15, borderRadius: "50%",
          fontSize: 9, fontWeight: 700, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: t.accent,
        }}>5</span>
      </button>
    </div>
  );
}

/* ホーム画面 */
function HomeScreen({ t, onOpenChannel, activeTab, onTabChange, onDmTap, onActivityTap }: { t: MockTheme; onOpenChannel: (name: string) => void; activeTab: TabId; onTabChange: (tab: TabId) => void; onDmTap?: () => void; onActivityTap?: () => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  return (
    <>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", padding: "8px 16px", height: 48,
          background: t.surface,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 17, fontWeight: 650, color: t.fg, whiteSpace: "nowrap" }}>お津会</span>
            <button style={{
              background: "none", border: "none", cursor: "pointer",
              color: t.muted, padding: 2, display: "flex", alignItems: "center",
            }}>
              <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          {/* ステータスチップ */}
          <div style={{ display: "flex", gap: 4, marginLeft: "auto", marginRight: 2 }}>
            <button onClick={() => onTabChange("inprogress")} style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "4px 10px", height: 28,
              borderRadius: 999, border: "none", cursor: "pointer",
              background: "#EAF8FF",
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: t.fg }}>進行中</span>
              <span style={{
                fontSize: 9, fontWeight: 700, color: t.sky,
                width: 16, height: 16, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#fff",
              }}>4</span>
            </button>

            <button onClick={() => onTabChange("decision")} style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "4px 10px", height: 28,
              borderRadius: 999, border: "none", cursor: "pointer",
              background: "#FFF1EA",
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: t.fg }}>決定</span>
              <span style={{
                fontSize: 9, fontWeight: 700, color: t.accent,
                width: 16, height: 16, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#fff",
              }}>3</span>
            </button>
          </div>

          <HeaderIcons t={t} onDmTap={onDmTap} onActivityTap={onActivityTap} />
        </div>
        <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 8px" }}>

        {/* 独り言 — ポストカード型横スクロール */}
        <div style={{ display: "flex", alignItems: "center", padding: "2px 10px 4px" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: t.muted, opacity: 0.75, flex: 1 }}>独り言</span>
          <button
            onClick={() => onOpenChannel("独り言")}
            style={{ fontSize: 11, color: t.muted, opacity: 0.6, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >もっと見る</button>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "2px 10px 8px", overflowX: "auto" }}>
          {[
            { content: "田村大明神ご利益", time: "10時間前", name: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", imageUrl: null },
            { content: "こちらが藤木の脳内。これを見つけた時しっくりきた。", time: "昨日", name: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", imageUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/f181205f-a508-4b5a-8f05-d96d93f6b92d/e020f07f-3223-4db6-a5f0-c1d5f60179e2-IMG_1473.jpeg" },
            { content: "そもそもゴミ袋にお金払ってるワイは何？税金払ってゴミ袋買って…。", time: "昨日", name: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", imageUrl: null },
          ].map((note, i) => (
            <button key={i} onClick={() => onOpenChannel("独り言")} style={{
              minWidth: 200, maxWidth: 210, padding: "8px 10px",
              borderRadius: 12, border: "none", cursor: "pointer",
              background: t.bgSoft, textAlign: "left",
              display: "flex", gap: 10, flexShrink: 0, alignItems: "center",
              height: 80,
            }}>
              {/* 左: アバター + テキスト */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={note.avatarUrl} alt="" style={{
                    width: 20, height: 20, borderRadius: 10, objectFit: "cover", flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 11, color: t.fg, fontWeight: 600 }}>{note.name}</span>
                  <span style={{ fontSize: 10, color: t.muted, marginLeft: "auto" }}>{note.time}</span>
                </div>
                <p style={{
                  fontSize: 12, lineHeight: 1.45, color: t.fg, margin: 0,
                  overflow: "hidden", display: "-webkit-box",
                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                }}>{note.content}</p>
              </div>
              {/* 右: サムネイル（あれば） */}
              {note.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={note.imageUrl} alt="" style={{
                  width: 52, height: 52, borderRadius: 8,
                  objectFit: "cover", flexShrink: 0,
                }} />
              )}
            </button>
          ))}
        </div>

        {categories.map((cat, catIdx) => {
          const isCollapsed = collapsed.has(cat.label);
          const totalUnread = cat.channels.reduce((s, c) => s + c.unread, 0);
          return (
            <div key={cat.label}>
              <button
                onClick={() => toggle(cat.label)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 10px 3px", border: "none", background: "none", cursor: "pointer",
                  marginTop: catIdx === 0 ? 2 : 6, position: "relative", zIndex: 2,
                }}
              >
                <svg style={{
                  width: 14, height: 14, color: cat.color || t.muted, opacity: 0.7,
                  transition: "transform 150ms",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.muted, opacity: 0.75, flex: 1, textAlign: "left" }}>{cat.label}</span>
                {isCollapsed && totalUnread > 0 && (
                  <span style={{
                    width: 16, height: 16, borderRadius: "50%",
                    fontSize: 9, fontWeight: 700, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: t.accent, opacity: 0.85,
                  }}>{totalUnread}</span>
                )}
              </button>
              {!isCollapsed && cat.channels.map((ch) => (
                <button
                  key={ch.name}
                  onClick={() => onOpenChannel(ch.name)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "0 10px 0 28px", height: 34, borderRadius: 8,
                    border: "none", cursor: "pointer", marginBottom: 0,
                    background: "none", position: "relative", zIndex: 1,
                    color: ch.unread > 0 ? t.fg : t.muted,
                    fontWeight: ch.unread > 0 ? 700 : 500,
                    fontSize: ch.unread > 0 ? 15 : 14.5, textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 15, color: t.muted, opacity: ch.unread > 0 ? 0.7 : 0.2 }}>#</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</span>
                  {ch.unread > 0 && (
                    <span style={{
                      width: 16, height: 16, borderRadius: "50%",
                      fontSize: 9, fontWeight: 700, color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: t.accent, opacity: 0.85, flexShrink: 0, marginLeft: "auto",
                    }}>{ch.unread}</span>
                  )}
                </button>
              ))}
            </div>
          );
        })}

      </div>

      <MockBottomTab t={t} activeTab={activeTab} onTabChange={onTabChange} />
    </>
  );
}

/* チャンネル画面 */
function ChannelScreen({ t, channelName, onBack, activeTab, onTabChange }: { t: MockTheme; channelName: string; onBack: () => void; activeTab: TabId; onTabChange: (tab: TabId) => void }) {
  const [showMenu, setShowMenu] = useState(false);

  const members = [
    { name: "奥のすみか", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", role: "オーナー", online: true },
    { name: "三藤友喜", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg", role: "メンバー", online: false },
    { name: "しいめぐみ", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/74fbbcca-fbca-438b-ab86-8da6002b5ecf-1777350382821.png", role: "メンバー", online: true },
    { name: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", role: "メンバー", online: true },
    { name: "たむらいすのひととき", avatarUrl: null, role: "メンバー", online: false },
  ];

  return (
    <>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center",
          padding: "6px 8px", height: 48, background: t.surface,
        }}>
          <button onClick={onBack} style={{ color: t.fg, background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <span style={{ color: t.sky, fontWeight: 600 }}># </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: t.fg }}>{channelName}</span>
          </div>
          <button onClick={() => setShowMenu(true)} style={{ color: t.fg, background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </button>
        </div>
        <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
      </div>
      <MockMessageList t={t} />
      <MockMessageInput t={t} />
      <MockBottomTab t={t} activeTab={activeTab} onTabChange={onTabChange} />

      {/* 三点メニューシート */}
      {showMenu && (
        <>
          <div onClick={() => setShowMenu(false)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 50,
          }} />
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 51,
            background: t.surface, borderRadius: "16px 16px 0 0",
            padding: "8px 16px 28px", maxHeight: "75%", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: t.border }} />
            </div>

            {/* チャンネル情報 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: t.fg, marginBottom: 4 }}># {channelName}</div>
              <span style={{ fontSize: 13, color: t.muted }}>{members.length}人のメンバー</span>
            </div>

            {/* メンバー一覧 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 650, color: t.fg, opacity: 0.7, marginBottom: 8 }}>メンバー</div>
              {members.map((m, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                }}>
                  <span style={{ position: "relative", display: "inline-flex" }}>
                    {m.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: 18, objectFit: "cover" }} />
                    ) : (
                      <span style={{ width: 36, height: 36, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", background: t.muted }}>{m.name.charAt(0)}</span>
                    )}
                    {m.online && (
                      <span style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, background: t.online, border: `2px solid ${t.surface}` }} />
                    )}
                  </span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: t.fg }}>{m.name}</span>
                  </div>
                  <span style={{ fontSize: 11, color: t.muted }}>{m.role}</span>
                </div>
              ))}
            </div>

            {/* アクション */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                { icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z", label: "メンバーを招待" },
                { icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.38.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z", label: "チャンネル設定" },
                { icon: "M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9", label: "チャンネルを退出", danger: true },
              ].map((action) => (
                <button key={action.label} onClick={() => setShowMenu(false)} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 8px", borderRadius: 10, border: "none",
                  background: "none", cursor: "pointer", width: "100%", textAlign: "left",
                }}>
                  <svg style={{ width: 20, height: 20, color: "danger" in action && action.danger ? "#ef4444" : t.fg, opacity: 0.5, flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={action.icon} />
                  </svg>
                  <span style={{ fontSize: 15, color: "danger" in action && action.danger ? "#ef4444" : t.fg }}>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* 汎用タブ画面（ヘッダー+BottomTab付き） */
function TabScreen({ t, title, activeTab, onTabChange, children }: { t: MockTheme; title: string; activeTab: TabId; onTabChange: (tab: TabId) => void; children: React.ReactNode }) {
  return (
    <>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", padding: "8px 16px", height: 48,
          background: t.surface,
        }}>
          <span style={{ fontSize: 19, fontWeight: 650, color: t.fg, flex: 1 }}>{title}</span>
          <HeaderIcons t={t} />
        </div>
        <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {children}
      </div>
      <MockBottomTab t={t} activeTab={activeTab} onTabChange={onTabChange} />
    </>
  );
}

/* 進行中画面 */
function InProgressScreen({ t }: { t: MockTheme }) {
  const items = [
    { title: "UIリデザイン Phase 2", channel: "チームイノベーしよん", assignee: "奥のすみか", assigneeAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", days: 3, status: "進行中" },
    { title: "エリア516 出店者リスト確定", channel: "エリア516｜20260516開催", assignee: "三藤友喜", assigneeAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg", days: 5, status: "進行中" },
    { title: "そよら津桜橋 企画書提出", channel: "そよら津桜橋｜20260427コンペ", assignee: "しいめぐみ", assigneeAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/74fbbcca-fbca-438b-ab86-8da6002b5ecf-1777350382821.png", days: 2, status: "進行中" },
    { title: "プレミアム商品券 登録フォーム", channel: "プレミアム商品券登録", assignee: "たむらいすのひととき", assigneeAvatar: null, days: 7, status: "未着手" },
  ];
  return (
    <div style={{ padding: "8px 16px" }}>
      {items.map((item, i) => (
        <div key={i} style={{
          padding: "12px 14px", marginBottom: 6, borderRadius: 12,
          background: t.bgSoft,
          display: "flex", gap: 12, alignItems: "flex-start",
        }}>
          {/* アバター */}
          {item.assigneeAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.assigneeAvatar} alt="" style={{ width: 32, height: 32, borderRadius: 16, objectFit: "cover", flexShrink: 0, marginTop: 2 }} />
          ) : (
            <span style={{ width: 32, height: 32, borderRadius: 16, background: t.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 2 }}>
              {item.assignee.charAt(0)}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 650, color: t.fg, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, color: t.sky,
                padding: "2px 8px", borderRadius: 999,
                background: "rgba(56,189,248,0.1)", flexShrink: 0,
              }}>{item.status}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: t.muted }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}># {item.channel}</span>
              <span style={{ marginLeft: "auto", flexShrink: 0 }}>{item.days}日前</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* 決定事項画面 */
function DecisionScreen({ t }: { t: MockTheme }) {
  const groups = [
    {
      label: "今日",
      items: [
        { aiTitle: "UIカラーをオレンジ×水色に決定", content: "オレンジ × 水色のアクセント、決定でお願いします。実装はPhase 1から順にやっていきましょう。", channel: "チームイノベーしよん", user: "鈴木一郎", userAvatar: null, time: "10:30" },
      ],
    },
    {
      label: "昨日",
      items: [
        { aiTitle: "エリア516 出店ブース10区画確定", content: "エリア516の出店ブースは10区画で確定。追加枠は次回検討。", channel: "エリア516｜20260516開催", user: "奥のすみか", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", time: "15:20" },
        { aiTitle: "そよら津桜橋コンペ 締切5/27に延長", content: "そよら津桜橋のコンペ提出期限は5/27に延長。", channel: "そよら津桜橋｜20260427コンペ", user: "三藤友喜", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg", time: "11:45" },
      ],
    },
    {
      label: "5/18",
      items: [
        { aiTitle: "三重ミライ会議 次回6/5に決定", content: "三重ミライ会議の次回日程は6/5（木）14:00〜で確定。場所は前回と同じ。", channel: "三重ミライ会議", user: "たむらいすのひととき", userAvatar: null, time: "09:10" },
      ],
    },
  ];
  return (
    <div style={{ padding: "8px 12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {groups.flatMap((group) => group.items.map((item) => ({ ...item, date: group.label }))).map((item, i) => (
          <div key={i} style={{
            padding: "14px 12px", borderRadius: 4,
            background: t.bgSoft,
            display: "flex", flexDirection: "column",
            aspectRatio: "1", overflow: "hidden",
          }}>
            {/* 上部: チャンネル */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: t.muted, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>#{item.channel}</span>
            </div>
            {/* AIタイトル */}
            <div style={{ fontSize: 13, fontWeight: 650, color: t.fg, lineHeight: 1.35, marginBottom: 3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
              {item.aiTitle}
            </div>
            {/* 本文 — 1行省略 */}
            <p style={{
              fontSize: 11, lineHeight: 1.4, color: t.muted, margin: "0 0 auto",
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
            }}>{item.content}</p>
            {/* 下部: アバター + ユーザー + 時間 */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}>
              {item.userAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.userAvatar} alt="" style={{ width: 20, height: 20, borderRadius: 10, objectFit: "cover" }} />
              ) : (
                <span style={{ width: 20, height: 20, borderRadius: 10, background: t.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#fff" }}>
                  {item.user.charAt(0)}
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 500, color: t.fg }}>{item.user}</span>
              <span style={{ fontSize: 10, color: t.muted, marginLeft: "auto" }}>{item.date} {item.time}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* カレンダー画面 */
function CalendarScreen({ t }: { t: MockTheme }) {
  const today = 21;
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const events = [
    { day: 21, title: "中部日本プラスティック打合せ", time: "14:00", channel: "中部日本プラスティック" },
    { day: 23, title: "エリア516 出店者説明会", time: "10:00", channel: "エリア516" },
    { day: 27, title: "そよら津桜橋コンペ締切", time: "終日", channel: "そよら津桜橋" },
  ];
  return (
    <div style={{ padding: "12px 16px" }}>
      {/* ミニカレンダー */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: t.fg, marginBottom: 10 }}>2026年 5月</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
          {days.map((d) => (
            <span key={d} style={{ fontSize: 10, color: t.muted, padding: "4px 0" }}>{d}</span>
          ))}
          {/* 5月は金曜始まり（オフセット5） */}
          {Array.from({ length: 4 }, (_, i) => <span key={`e${i}`} />)}
          {Array.from({ length: 31 }, (_, i) => {
            const day = i + 1;
            const hasEvent = events.some((e) => e.day === day);
            const isToday = day === today;
            return (
              <span key={day} style={{
                fontSize: 12, padding: "6px 0", borderRadius: 8,
                color: isToday ? "#fff" : t.fg,
                background: isToday ? t.accent : "none",
                fontWeight: isToday ? 700 : 400,
                position: "relative",
              }}>
                {day}
                {hasEvent && !isToday && (
                  <span style={{
                    position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)",
                    width: 4, height: 4, borderRadius: 2, background: t.accent,
                  }} />
                )}
              </span>
            );
          })}
        </div>
      </div>
      {/* 予定リスト */}
      <div style={{ fontSize: 13, fontWeight: 600, color: t.muted, marginBottom: 8 }}>今後の予定</div>
      {events.map((ev, i) => (
        <div key={i} style={{
          padding: "12px 14px", marginBottom: 6, borderRadius: 10,
          background: t.bgSoft,
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <span style={{
            fontSize: 18, fontWeight: 700, color: t.accent, minWidth: 28, textAlign: "center",
          }}>{ev.day}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.fg }}>{ev.title}</div>
            <div style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>{ev.time} · #{ev.channel}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* その他画面 */
function MoreScreen({ t }: { t: MockTheme }) {
  const items = [
    { label: "検索", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
    { label: "独り言", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
    { label: "ファイル", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
    { label: "アルバム", icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" },
    { label: "ブックマーク", icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" },
    { label: "メンバー", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
    { label: "設定", icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.38.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  ];
  return (
    <div style={{ padding: "16px 16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {items.map((item) => (
          <button key={item.label} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            padding: "16px 8px", borderRadius: 12, border: "none", cursor: "pointer",
            background: t.bgSoft,
          }}>
            <svg style={{ width: 24, height: 24, color: t.fg }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: t.fg }}>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* クイック投稿シート */
function QuickPostSheet({ t, onClose }: { t: MockTheme; onClose: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const recentChannels = [
    "独り言", "チームイノベーしよん", "エリア516｜20260516開催", "みんなでお勉強",
  ];
  const canSend = selected !== null && text.length > 0;

  return (
    <>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 10,
      }} />
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 11,
        background: t.surface, borderRadius: "20px 20px 0 0",
        padding: "12px 16px 24px",
        maxHeight: "80%", display: "flex", flexDirection: "column",
      }}>
        {/* ハンドル */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: t.border }} />
        </div>

        {/* 投稿先 */}
        <button style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
          borderRadius: 10, border: "none", cursor: "pointer", marginBottom: 10, width: "100%",
          background: selected ? "rgba(56,189,248,0.08)" : t.bgSoft,
        }}>
          <span style={{ fontSize: 13, color: t.muted }}>投稿先:</span>
          {selected ? (
            <span style={{ fontSize: 14, fontWeight: 650, color: t.fg }}># {selected}</span>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 600, color: t.accent }}>チャンネルを選択</span>
          )}
          <svg style={{ width: 14, height: 14, color: t.muted, marginLeft: "auto" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* 最近使ったチャンネル + 検索 */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: t.muted, opacity: 0.75, flex: 1 }}>最近使ったチャンネル</span>
            <button style={{
              display: "flex", alignItems: "center", gap: 3,
              fontSize: 11, color: t.muted, opacity: 0.6, background: "none", border: "none", cursor: "pointer", padding: 0,
            }}>
              <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              検索
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {recentChannels.map((ch) => (
              <button key={ch} onClick={() => setSelected(ch)} style={{
                padding: "5px 12px", borderRadius: 999, border: "none", cursor: "pointer",
                background: selected === ch ? "rgba(56,189,248,0.12)" : t.bgSoft,
                fontSize: 12, color: selected === ch ? t.sky : t.fg, fontWeight: selected === ch ? 600 : 500,
              }}>
                # {ch}
              </button>
            ))}
          </div>
        </div>

        {/* 入力欄 */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="メッセージを入力..."
          style={{
            flex: 1, padding: "10px 12px", borderRadius: 12,
            background: t.bgSoft, minHeight: 72, marginBottom: 12,
            fontSize: 14, color: t.fg, border: "none", resize: "none",
            outline: "none", fontFamily: "inherit",
          }}
        />

        {/* 下部ツールバー */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={{
            width: 36, height: 36, borderRadius: 18, border: "none",
            background: "none", cursor: "pointer", color: t.muted,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg style={{ width: 22, height: 22 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </button>
          <button style={{
            width: 36, height: 36, borderRadius: 18, border: "none",
            background: "none", cursor: "pointer", color: t.muted,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg style={{ width: 22, height: 22 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          </button>
          <div style={{ flex: 1 }} />
          <button style={{
            padding: "8px 20px", borderRadius: 999, border: "none",
            background: canSend ? t.accent : t.panel,
            color: canSend ? "#fff" : t.muted,
            fontSize: 13, fontWeight: 600,
            cursor: canSend ? "pointer" : "default",
            opacity: canSend ? 1 : 0.6,
          }}>
            送信
          </button>
        </div>
      </div>
    </>
  );
}

/* アルバム画面 */
function AlbumScreen({ t }: { t: MockTheme }) {
  const albums = [
    { title: "エリア516 準備", count: 12, thumb: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/80e626cf-baae-459a-b32a-0358374a6e8f-20250510_183216.jpg" },
    { title: "チームイノベーしよん", count: 8, thumb: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/c2754ab5-cfc9-414b-b466-85397d404d27-20260518103006708_0002.jpg" },
    { title: "そよら津桜橋", count: 5, thumb: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/d04ac12c-e840-4216-b9d6-e40db0a063ca-IMG_1776.jpeg" },
    { title: "みんなでお勉強", count: 23, thumb: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/1d3cb7bc-ea93-4b55-9f39-edac9c64be62/96ff2273-dcb4-4110-80b1-5cb2e819cc7a-20260518103006708_0001.jpg" },
  ];
  return (
    <div style={{ padding: "12px 16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        {albums.map((album, i) => (
          <button key={i} style={{
            borderRadius: 10, border: "none", cursor: "pointer",
            overflow: "hidden", background: t.bgSoft, textAlign: "left", padding: 0,
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={album.thumb} alt="" style={{
              width: "100%", height: 100, objectFit: "cover", display: "block",
            }} />
            <div style={{ padding: "8px 10px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.fg }}>{album.title}</div>
              <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>{album.count}枚</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* DM一覧画面 */
function DmListScreen({ t, onOpenDm, onBack }: { t: MockTheme; onOpenDm: (name: string) => void; onBack: () => void }) {
  const dmList = [
    { name: "たむらいすのひととき", avatarUrl: null, lastMsg: "暑い中、どうもありがとうございました！^_^", time: "今日", unread: 1 },
    { name: "奥のすみか", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", lastMsg: "小久保商店さん", time: "5/1", unread: 0 },
    { name: "しいめぐみ", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/74fbbcca-fbca-438b-ab86-8da6002b5ecf-1777350382821.png", lastMsg: "面白いですね！活用例みせていただきありがとうございます！", time: "4/17", unread: 0 },
    { name: "h.okamoto", avatarUrl: null, lastMsg: "いえいえ、何かとお忙しい中ありがとうございます", time: "5/9", unread: 0 },
    { name: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", lastMsg: "了解です！", time: "5/15", unread: 0 },
  ];

  return (
    <>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center",
          padding: "6px 8px", height: 48, background: t.surface,
        }}>
          <button onClick={onBack} style={{ color: t.fg, background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span style={{ flex: 1, fontSize: 17, fontWeight: 650, color: t.fg, textAlign: "center" }}>メッセージ</span>
          <button style={{ color: t.fg, background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
            </svg>
          </button>
        </div>
        <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {dmList.map((dm, i) => (
          <button key={i} onClick={() => onOpenDm(dm.name)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "12px 16px", border: "none", cursor: "pointer",
            background: "none", textAlign: "left",
          }}>
            {dm.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dm.avatarUrl} alt="" style={{ width: 44, height: 44, borderRadius: 22, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <span style={{
                width: 44, height: 44, borderRadius: 22, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, fontWeight: 700, color: "#fff", background: t.muted,
              }}>{dm.name.charAt(0)}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 14.5, fontWeight: dm.unread > 0 ? 700 : 500, color: t.fg }}>{dm.name}</span>
                <span style={{ fontSize: 11, color: t.muted, marginLeft: "auto", flexShrink: 0 }}>{dm.time}</span>
              </div>
              <p style={{
                fontSize: 13, color: dm.unread > 0 ? t.fg : t.muted, margin: 0,
                fontWeight: dm.unread > 0 ? 600 : 400,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{dm.lastMsg}</p>
            </div>
            {dm.unread > 0 && (
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                fontSize: 10, fontWeight: 700, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: t.accent, flexShrink: 0,
              }}>{dm.unread}</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

/* DMチャット画面 */
function DmChatScreen({ t, name, onBack }: { t: MockTheme; name: string; onBack: () => void }) {
  return (
    <>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center",
          padding: "6px 8px", height: 48, background: t.surface,
        }}>
          <button onClick={onBack} style={{ color: t.fg, background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: t.fg }}>{name}</span>
          </div>
          <div style={{ width: 36 }} />
        </div>
        <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px", background: t.surface }}>
        {/* 相手 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 16, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#fff", background: t.muted,
          }}>{name.charAt(0)}</span>
          <div>
            <span style={{ fontSize: 12, color: t.muted, marginBottom: 3, display: "block" }}>{name}</span>
            <div style={{
              padding: "10px 14px", borderRadius: "4px 14px 14px 14px",
              background: t.bgSoft, fontSize: 14.5, lineHeight: 1.6, color: t.fg,
            }}>
              暑い中、どうもありがとうございました！^_^
            </div>
            <span style={{ fontSize: 10, color: t.muted, marginTop: 4, display: "block" }}>19:01</span>
          </div>
        </div>

        {/* 自分 */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <div>
            <div style={{
              padding: "10px 14px", borderRadius: "14px 4px 14px 14px",
              background: "rgba(56,189,248,0.12)", fontSize: 14.5, lineHeight: 1.6, color: t.fg,
            }}>
              こちらこそありがとうございます！また来週よろしくお願いします。
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: t.muted }}>既読</span>
              <span style={{ fontSize: 10, color: t.muted }}>19:05</span>
            </div>
          </div>
        </div>

        {/* 相手 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 16, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#fff", background: t.muted,
          }}>{name.charAt(0)}</span>
          <div>
            <div style={{
              padding: "10px 14px", borderRadius: "4px 14px 14px 14px",
              background: t.bgSoft, fontSize: 14.5, lineHeight: 1.6, color: t.fg,
            }}>
              はい！よろしくお願いします 😊
            </div>
            <span style={{ fontSize: 10, color: t.muted, marginTop: 4, display: "block" }}>19:06</span>
          </div>
        </div>
      </div>

      <MockMessageInput t={t} />
    </>
  );
}

/* アクティビティ画面 */
function ActivityScreen({ t, onBack }: { t: MockTheme; onBack: () => void }) {
  const activities = [
    { type: "reaction", emoji: "❤️", user: "しいめぐみ", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/74fbbcca-fbca-438b-ab86-8da6002b5ecf-1777350382821.png", content: "トレカやシールを発行して、ポケモン図鑑みたいに埋めたくなる台紙を持ち...", channel: "みんなでお勉強", time: "2時間前" },
    { type: "reply", user: "奥のすみか", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", content: "藤木さんと私が作りたいおじさん図鑑", channel: "みんなでお勉強", time: "3時間前" },
    { type: "mention", user: "三藤友喜", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg", content: "@奥のすみか 松菱の件、ご意見聞きたいです", channel: "チームイノベーしよん", time: "5時間前" },
    { type: "reaction", emoji: "✅", user: "🤏ふじきんとき🤏", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", content: "紙屋だから言うのではなく、マジで紙を使って勉強したほうがいいと思います...", channel: "みんなでお勉強", time: "昨日" },
    { type: "reply", user: "たむらいすのひととき", userAvatar: null, content: "明和町商工会より 【あなたの\"こだわり商品\"を都市部へPRしませんか？】", channel: "みんなでお勉強", time: "昨日" },
    { type: "decision", user: "奥のすみか", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", content: "エリア516の出店ブースは10区画で確定", channel: "エリア516", time: "2日前" },
  ];

  const typeLabel = (type: string) => {
    switch (type) {
      case "reaction": return "リアクション";
      case "reply": return "返信";
      case "mention": return "メンション";
      case "decision": return "決定事項";
      default: return "";
    }
  };
  const typeColor = (type: string) => {
    switch (type) {
      case "mention": return t.sky;
      case "decision": return t.accent;
      default: return t.muted;
    }
  };

  return (
    <>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center",
          padding: "6px 8px", height: 48, background: t.surface,
        }}>
          <button onClick={onBack} style={{ color: t.fg, background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span style={{ flex: 1, fontSize: 17, fontWeight: 650, color: t.fg, textAlign: "center" }}>アクティビティ</span>
          <div style={{ width: 36 }} />
        </div>
        <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {activities.map((item, i) => (
          <div key={i} style={{
            display: "flex", gap: 12, padding: "12px 16px",
            borderBottom: `1px solid ${t.border}`,
            background: i === 0 ? "rgba(233,104,50,0.03)" : "none",
          }}>
            {/* アバター */}
            {item.userAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.userAvatar} alt="" style={{ width: 36, height: 36, borderRadius: 18, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <span style={{
                width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: "#fff", background: t.muted,
              }}>{item.user.charAt(0)}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* ユーザー + アクション + 時間 */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: t.fg }}>{item.user}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: typeColor(item.type),
                  padding: "1px 6px", borderRadius: 999,
                  background: item.type === "mention" ? "rgba(56,189,248,0.1)" : item.type === "decision" ? "rgba(233,104,50,0.08)" : "rgba(0,0,0,0.04)",
                }}>
                  {"type" in item && item.type === "reaction" ? item.emoji : ""} {typeLabel(item.type)}
                </span>
                <span style={{ fontSize: 11, color: t.muted, marginLeft: "auto", flexShrink: 0 }}>{item.time}</span>
              </div>
              {/* 本文 */}
              <p style={{
                fontSize: 13, lineHeight: 1.5, color: t.muted, margin: "0 0 3px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{item.content}</p>
              {/* チャンネル */}
              <span style={{ fontSize: 11, color: t.muted, opacity: 0.6 }}># {item.channel}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* 独り言画面 */
function HitorigotoScreen({ t, onBack }: { t: MockTheme; onBack: () => void }) {
  const posts = [
    { user: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", content: "田村大明神ご利益", time: "今日 10:28", reactions: [{ emoji: "😊", count: 2 }] },
    { user: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", content: "あ、これ名張市に対してだから！津市のことじゃな（ry", time: "昨日 22:34", reactions: [] },
    { user: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", content: "そもそもゴミ袋にお金払ってるワイは何？\n税金払ってゴミ袋買って…。\nゴミ回収の事業設計が失敗したミスを認めて欲しい。", time: "昨日 22:32", reactions: [{ emoji: "👀", count: 1 }] },
    { user: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", content: "聞こえているか！イーサン！", time: "昨日 22:19", reactions: [{ emoji: "😂", count: 3 }] },
    { user: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", content: "こちらが藤木の脳内。これを見つけた時しっくりきた。", time: "昨日 22:02", imageUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/f181205f-a508-4b5a-8f05-d96d93f6b92d/e020f07f-3223-4db6-a5f0-c1d5f60179e2-IMG_1473.jpeg", reactions: [{ emoji: "❤️", count: 2 }] },
    { user: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", content: "たむけんのベロンベロンを見てみたい", time: "昨日 21:42", reactions: [] },
    { user: "たむらいすのひととき", avatarUrl: null, content: "ジャンプ", time: "昨日 21:42", reactions: [{ emoji: "😮", count: 1 }] },
  ];

  return (
    <>
      {/* ヘッダー */}
      <div style={{ flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center",
          padding: "6px 8px", height: 48, background: t.surface,
        }}>
          <button onClick={onBack} style={{ color: t.fg, background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: t.fg }}>独り言</span>
          </div>
          <div style={{ width: 36 }} />
        </div>
        <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
      </div>

      {/* 投稿一覧 — SNSフィード風 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {posts.map((post, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, padding: "12px 16px",
              borderBottom: `1px solid ${t.border}`,
            }}>
              {/* アバター */}
              {post.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.avatarUrl} alt="" style={{ width: 38, height: 38, borderRadius: 19, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <span style={{ width: 38, height: 38, borderRadius: 19, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", background: t.muted }}>{post.user.charAt(0)}</span>
              )}
              {/* コンテンツ */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* 名前 + 時間 */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: t.fg }}>{post.user}</span>
                  <span style={{ fontSize: 12, color: t.muted }}>· {post.time}</span>
                </div>
                {/* 本文 */}
                <p style={{ fontSize: 15, lineHeight: 1.55, color: t.fg, margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{post.content}</p>
                {/* 画像 */}
                {"imageUrl" in post && post.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.imageUrl} alt="" style={{ width: "100%", borderRadius: 12, marginBottom: 6, objectFit: "cover", maxHeight: 200 }} />
                )}
              </div>
            </div>
        ))}
      </div>

      {/* 入力欄 */}
      <MockMessageInput t={t} />
    </>
  );
}
