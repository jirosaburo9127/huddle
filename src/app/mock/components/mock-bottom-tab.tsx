"use client";

import type { MockTheme } from "../theme";

export type TabId = "home" | "calendar" | "post" | "album" | "more" | "inprogress" | "decision";

const tabs: { id: TabId; label: string; icon: string; badge?: number; avatarUrl?: string; isCenter?: boolean }[] = [
  { id: "home", label: "ホーム", icon: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" },
  { id: "calendar", label: "カレンダー", icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" },
  { id: "post", label: "", icon: "M12 4.5v15m7.5-7.5h-15", isCenter: true },
  { id: "album", label: "アルバム", icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" },
  { id: "more", label: "その他", icon: "", avatarUrl: "https://emfngqketrieioxusuhg.supabase.co/storage/v1/object/public/chat-files/avatars/70b23297-e941-41ef-95b3-3269d6f347b4-1775544887146.jpeg" },
];

export function MockBottomTab({ t, activeTab, onTabChange }: { t: MockTheme; activeTab?: TabId; onTabChange?: (tab: TabId) => void }) {
  return (
    <nav style={{
      width: "100%", background: t.surface,
      flexShrink: 0,
    }}>
      <div style={{ height: 0.75, background: "linear-gradient(90deg, #E96832, #38BDF8)" }} />
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-around",
        padding: "10px 8px 8px",
        height: 56,
      }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange?.(tab.id)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: tab.isCenter ? 0 : 3,
                padding: tab.isCenter ? 0 : "4px 14px",
                borderRadius: tab.isCenter ? "50%" : 10,
                border: "none", cursor: "pointer", position: "relative" as const,
                background: tab.isCenter ? "#38BDF8" : "none",
                color: tab.isCenter ? "#fff" : t.fg,
                width: tab.isCenter ? 36 : undefined,
                height: tab.isCenter ? 36 : undefined,
                justifyContent: tab.isCenter ? "center" : undefined,
                marginTop: tab.isCenter ? -4 : 0,
                boxShadow: tab.isCenter ? "0 1px 4px rgba(56,189,248,0.2)" : "none",
                transition: "all 150ms",
              }}
            >
              <span style={{ position: "relative", display: "inline-flex" }}>
                {tab.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tab.avatarUrl} alt="" style={{
                    width: 23, height: 23, borderRadius: "50%", objectFit: "cover",
                    border: isActive ? `2px solid ${t.fg}` : "2px solid transparent",
                  }} />
                ) : (
                  <svg
                    style={{ width: 23, height: 23 }}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={isActive ? 2 : 1.2}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                  </svg>
                )}
                {tab.badge && tab.badge > 0 && (
                  <span style={{
                    position: "absolute", top: -3, right: -5,
                    minWidth: 14, height: 14, padding: "0 3px", borderRadius: 7,
                    fontSize: 8, fontWeight: 700, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: t.accent,
                  }}>{tab.badge}</span>
                )}
              </span>
              {!tab.isCenter && <span style={{ fontSize: 10.5, fontWeight: 400 }}>{tab.label}</span>}
              {isActive && !tab.isCenter && (
                <span style={{
                  position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
                  width: 16, height: 2, borderRadius: 1, background: t.fg,
                }} />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
