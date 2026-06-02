"use client";

import { CSSProperties, useState } from "react";
import "./mock-globals.css";
import { themes, type MockTheme } from "./theme";
import { MockSidebar } from "./components/mock-sidebar";
import { MockBottomTab } from "./components/mock-bottom-tab";
import { MockMessageList } from "./components/mock-message-list";
import { MockMessageInput } from "./components/mock-message-input";

type ThemeKey = "dawn" | "midnight" | "warm";

const contentShell: CSSProperties = {
  maxWidth: 1080,
  margin: "0 auto",
  padding: "0 24px",
  width: "100%",
};

type PcPanel = "chat" | "dm" | "activity";

export default function MockPage() {
  const [themeKey] = useState<ThemeKey>("dawn");
  const [view] = useState<"desktop" | "mobile">("desktop");
  const [panel, setPanel] = useState<PcPanel>("chat");
  const t = themes[themeKey];

  return (
    <div style={{
      minHeight: "100vh", background: t.bg, overflowX: "hidden",
      fontFamily: "'Helvetica Neue', 'Hiragino Sans', 'Noto Sans JP', Arial, sans-serif",
    }}>
      {/* === デスクトップビュー === */}
      {view === "desktop" && (
        <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          {/* 統合ヘッダーバー */}
          <TopBar t={t} panel={panel} setPanel={setPanel} />

          {/* サイドバー + メイン */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <div style={{
              width: 264, flexShrink: 0,
              background: t.bgSoft,
              display: "flex", flexDirection: "column",
            }}>
              <MockSidebar t={t} />
            </div>

            <div style={{
              flex: 1, minWidth: 0, maxWidth: "100%",
              background: t.surface,
              display: "flex", flexDirection: "column",
            }}>
              {panel === "chat" && (
                <>
                  <MockMessageList t={t} shell={contentShell} />
                  <MockMessageInput t={t} shell={contentShell} />
                </>
              )}
              {panel === "dm" && <PcDmPanel t={t} shell={contentShell} />}
              {panel === "activity" && <PcActivityPanel t={t} shell={contentShell} />}
            </div>
          </div>
        </div>
      )}

      {/* === モバイルビュー === */}
      {view === "mobile" && (
        <div style={{ maxWidth: 390, margin: "0 auto", border: `1px solid ${t.border}`, borderRadius: 20, overflow: "hidden" }}>
          <div style={{ height: 844, display: "flex", flexDirection: "column", overflow: "hidden", background: t.bg }}>
            {/* ステータスバー */}
            <div style={{
              height: 50, display: "flex", alignItems: "flex-end",
              justifyContent: "space-between", padding: "0 24px 6px",
              background: t.bg,
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: t.fg }}>9:41</span>
            </div>
            {/* モバイルヘッダー */}
            <div style={{
              display: "flex", alignItems: "center",
              padding: "8px 12px", height: 48,
              background: t.bg,
            }}>
              <button style={{ color: t.muted, background: "none", border: "none", cursor: "pointer", padding: 6 }}>
                <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
              <div style={{ flex: 1, textAlign: "center" }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: t.fg }}># general</span>
              </div>
              <div style={{ display: "flex", gap: 2 }}>
                <button style={{ color: t.muted, background: "none", border: "none", cursor: "pointer", padding: 6 }}>
                  <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                <button style={{ color: t.muted, background: "none", border: "none", cursor: "pointer", padding: 6, position: "relative" }}>
                  <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <span style={{
                    position: "absolute", top: 2, right: 2,
                    width: 16, height: 16, borderRadius: "50%",
                    fontSize: 9, fontWeight: 700, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: t.accent,
                  }}>5</span>
                </button>
              </div>
            </div>
            <MockMessageList t={t} />
            <MockMessageInput t={t} />
            <MockBottomTab t={t} />
          </div>
        </div>
      )}
    </div>
  );
}

/** 統合ヘッダー: ロゴ(サイドバー幅) + チャンネル名(メイン側contentShell揃え) + ツール */
function TopBar({ t, panel, setPanel }: { t: MockTheme; panel: PcPanel; setPanel: (p: PcPanel) => void }) {
  const icons = [
    { label: "検索", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z", badge: 0, action: undefined as PcPanel | undefined },
    { label: "DM", icon: "M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5", badge: 0, action: "dm" as PcPanel },
    { label: "通知", icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9", badge: 5, action: "activity" as PcPanel },
  ];
  const panelTitle = panel === "dm" ? "メッセージ" : panel === "activity" ? "アクティビティ" : "# みんなでお勉強";
  const panelSub = panel === "chat" ? "8人のメンバー" : "";

  return (
    <div style={{
      display: "flex", alignItems: "center",
      height: 56, flexShrink: 0,
      background: t.bgSoft,
    }}>
      <div style={{
        width: 264, flexShrink: 0, padding: "0 16px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="Huddle" style={{ width: 28, height: 28, borderRadius: 7 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: t.fg }}>お津会</span>
        <div style={{ display: "flex", alignItems: "center", gap: 1, marginLeft: "auto" }}>
          {icons.map((item) => (
            <button key={item.label} title={item.label} onClick={() => {
              if (item.action) setPanel(panel === item.action ? "chat" : item.action);
            }} style={{
              width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 8, background: panel === item.action ? "rgba(0,0,0,0.06)" : "none",
              border: "none", cursor: "pointer", color: panel === item.action ? t.fg : t.muted,
              position: "relative",
            }}>
              <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" strokeWidth={panel === item.action ? 2 : 1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.badge > 0 && (
                <span style={{
                  position: "absolute", top: 1, right: 0,
                  width: 14, height: 14, borderRadius: "50%",
                  fontSize: 8, fontWeight: 700, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: t.accent,
                }}>{item.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* メイン側: チャンネル名 + ツール — contentShellと同じpadding */}
      <div style={{ flex: 1, minWidth: 0, padding: "0 24px", display: "flex", alignItems: "center", background: t.surface, height: "100%" }}>
          {/* パネルタイトル */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 720, color: t.fg }}>{panelTitle}</span>
            {panelSub && <span style={{ fontSize: 13, fontWeight: 400, color: t.muted, opacity: 0.65 }}>{panelSub}</span>}
          </div>
        </div>
    </div>
  );
}

/* PC版 DM一覧+チャットパネル */
function PcDmPanel({ t, shell }: { t: MockTheme; shell: CSSProperties }) {
  const [selectedDm, setSelectedDm] = useState<string | null>(null);
  const dmList = [
    { name: "たむらいすのひととき", avatarUrl: null, lastMsg: "暑い中、どうもありがとうございました！^_^", time: "今日", unread: 1 },
    { name: "奥のすみか", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", lastMsg: "小久保商店さん", time: "5/1", unread: 0 },
    { name: "しいめぐみ", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/74fbbcca-fbca-438b-ab86-8da6002b5ecf-1777350382821.png", lastMsg: "面白いですね！活用例みせていただきありがとうございます！", time: "4/17", unread: 0 },
    { name: "h.okamoto", avatarUrl: null, lastMsg: "いえいえ、何かとお忙しい中ありがとうございます", time: "5/9", unread: 0 },
    { name: "🤏ふじきんとき🤏", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", lastMsg: "了解です！", time: "5/15", unread: 0 },
  ];

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* DM一覧（左） */}
      <div style={{ width: 320, flexShrink: 0, borderRight: `1px solid ${t.border}`, overflowY: "auto" }}>
        {dmList.map((dm, i) => (
          <button key={i} onClick={() => setSelectedDm(dm.name)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "12px 20px", border: "none", cursor: "pointer",
            background: selectedDm === dm.name ? t.bgSoft : "none", textAlign: "left",
          }}>
            {dm.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dm.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: 20, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <span style={{ width: 40, height: 40, borderRadius: 20, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff", background: t.muted }}>{dm.name.charAt(0)}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 14, fontWeight: dm.unread > 0 ? 700 : 500, color: t.fg }}>{dm.name}</span>
                <span style={{ fontSize: 11, color: t.muted, marginLeft: "auto", flexShrink: 0 }}>{dm.time}</span>
              </div>
              <p style={{ fontSize: 13, color: dm.unread > 0 ? t.fg : t.muted, margin: 0, fontWeight: dm.unread > 0 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dm.lastMsg}</p>
            </div>
            {dm.unread > 0 && (
              <span style={{ width: 18, height: 18, borderRadius: "50%", fontSize: 10, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", background: t.accent, flexShrink: 0 }}>{dm.unread}</span>
            )}
          </button>
        ))}
      </div>

      {/* チャット（右） */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {selectedDm ? (
          <>
            <div style={{ ...shell, padding: "16px 24px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: t.fg }}>{selectedDm}</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <span style={{ width: 32, height: 32, borderRadius: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", background: t.muted }}>{selectedDm.charAt(0)}</span>
                <div>
                  <span style={{ fontSize: 12, color: t.muted, display: "block", marginBottom: 3 }}>{selectedDm}</span>
                  <div style={{ padding: "10px 14px", borderRadius: "4px 14px 14px 14px", background: t.bgSoft, fontSize: 14.5, lineHeight: 1.6, color: t.fg, maxWidth: 480 }}>暑い中、どうもありがとうございました！^_^</div>
                  <span style={{ fontSize: 10, color: t.muted, marginTop: 4, display: "block" }}>19:01</span>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
                <div>
                  <div style={{ padding: "10px 14px", borderRadius: "14px 4px 14px 14px", background: "rgba(56,189,248,0.12)", fontSize: 14.5, lineHeight: 1.6, color: t.fg, maxWidth: 480 }}>こちらこそありがとうございます！また来週よろしくお願いします。</div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: t.muted }}>既読</span>
                    <span style={{ fontSize: 10, color: t.muted }}>19:05</span>
                  </div>
                </div>
              </div>
            </div>
            <MockMessageInput t={t} shell={shell} />
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: t.muted, fontSize: 14 }}>
            メッセージを選択してください
          </div>
        )}
      </div>
    </div>
  );
}

/* PC版 アクティビティパネル */
function PcActivityPanel({ t, shell }: { t: MockTheme; shell: CSSProperties }) {
  const activities = [
    { type: "reaction", emoji: "❤️", user: "しいめぐみ", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/74fbbcca-fbca-438b-ab86-8da6002b5ecf-1777350382821.png", content: "トレカやシールを発行して、ポケモン図鑑みたいに埋めたくなる台紙を持ち...", channel: "みんなでお勉強", time: "2時間前", unread: true },
    { type: "reply", user: "奥のすみか", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", content: "藤木さんと私が作りたいおじさん図鑑", channel: "みんなでお勉強", time: "3時間前", unread: true },
    { type: "mention", user: "三藤友喜", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/b9e28595-6543-4df9-a114-2984e5baf314-1779092913852.jpg", content: "@奥のすみか 松菱の件、ご意見聞きたいです", channel: "チームイノベーしよん", time: "5時間前", unread: true },
    { type: "reaction", emoji: "✅", user: "🤏ふじきんとき🤏", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/7d4daad3-006a-48ec-8dbf-bda51f17283d-1776075963251.jpeg", content: "紙屋だから言うのではなく、マジで紙を使って勉強したほうがいいと思います...", channel: "みんなでお勉強", time: "昨日", unread: false },
    { type: "reply", user: "たむらいすのひととき", userAvatar: null, content: "明和町商工会より 【あなたの\"こだわり商品\"を都市部へPRしませんか？】", channel: "みんなでお勉強", time: "昨日", unread: false },
    { type: "decision", user: "奥のすみか", userAvatar: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg", content: "エリア516の出店ブースは10区画で確定", channel: "エリア516", time: "2日前", unread: false },
  ];

  const typeLabel = (type: string) => {
    switch (type) { case "reaction": return "リアクション"; case "reply": return "返信"; case "mention": return "メンション"; case "decision": return "決定事項"; default: return ""; }
  };
  const typeColor = (type: string) => {
    switch (type) { case "mention": return t.sky; case "decision": return t.accent; default: return t.muted; }
  };
  const typeBg = (type: string) => {
    switch (type) { case "mention": return "rgba(56,189,248,0.1)"; case "decision": return "rgba(233,104,50,0.08)"; default: return "rgba(0,0,0,0.04)"; }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ ...shell, paddingTop: 8, paddingBottom: 8 }}>
        {activities.map((item, i) => (
          <div key={i} style={{
            display: "flex", gap: 14, padding: "14px 0",
            borderBottom: `1px solid ${t.border}`,
            cursor: "pointer",
            opacity: item.unread ? 1 : 0.55,
          }}>
            {item.userAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.userAvatar} alt="" style={{ width: 38, height: 38, borderRadius: 19, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <span style={{ width: 38, height: 38, borderRadius: 19, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", background: t.muted }}>{item.user.charAt(0)}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                {item.unread && <span style={{ width: 6, height: 6, borderRadius: 3, background: t.accent, flexShrink: 0 }} />}
                <span style={{ fontSize: 14, fontWeight: item.unread ? 700 : 500, color: t.fg }}>{item.user}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: typeColor(item.type), padding: "2px 8px", borderRadius: 999, background: typeBg(item.type) }}>
                  {"emoji" in item ? `${item.emoji} ` : ""}{typeLabel(item.type)}
                </span>
                <span style={{ fontSize: 12, color: t.muted, marginLeft: "auto", flexShrink: 0 }}>{item.time}</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: t.muted, margin: "0 0 4px", maxWidth: 600 }}>{item.content}</p>
              <span style={{ fontSize: 12, color: t.muted, opacity: 0.6 }}># {item.channel}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
