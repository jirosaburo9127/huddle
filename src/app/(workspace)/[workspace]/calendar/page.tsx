"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";

type CalendarEvent = {
  id: string;
  title: string;
  start_at: string;
  location: string | null;
  channel: { id: string; name: string; slug: string };
  creator: { id: string; display_name: string; avatar_url: string | null };
  attendees: Array<{
    id: string;
    display_name: string;
    avatar_url: string | null;
  }>;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const params = useParams<{ workspace: string }>();
  const router = useRouter();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-indexed
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // カレンダーグリッドの日付を計算
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days: (number | null)[] = [];
    // 月初の空白
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    // 日付
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(d);
    }
    return days;
  }, [year, month]);

  // イベント取得
  useEffect(() => {
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase.rpc("get_workspace_events", {
        p_workspace_slug: params.workspace,
        p_user_id: user.id,
        p_year: year,
        p_month: month,
      });

      if (!error && data && Array.isArray(data)) {
        setEvents(data as CalendarEvent[]);
      } else {
        setEvents([]);
      }
      setLoading(false);
    })();
  }, [params.workspace, year, month]);

  // 月移動
  const prevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
    setSelectedDay(null);
  };

  // 日ごとのイベントマップ
  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.start_at);
      const day = d.getDate();
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(ev);
    }
    return map;
  }, [events]);

  // 選択日のイベント
  const selectedEvents = selectedDay ? (eventsByDay.get(selectedDay) ?? []) : [];

  // 今日かどうか判定
  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear();

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <header className="flex items-center px-6 py-3 border-b border-border bg-header shrink-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden mr-2 p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="戻る"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="mr-2 text-lg">📅</span>
        <h1 className="font-bold text-lg">カレンダー</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-lg mx-auto">
          {/* 月ナビゲーション */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={prevMonth}
              className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-white/[0.06] transition-colors"
              aria-label="前月"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-base font-bold text-foreground">
              {year}年{month}月
            </h2>
            <button
              onClick={nextMonth}
              className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-white/[0.06] transition-colors"
              aria-label="翌月"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((wd, i) => (
              <div
                key={wd}
                className={`text-center text-xs font-medium py-1 ${
                  i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-muted"
                }`}
              >
                {wd}
              </div>
            ))}
          </div>

          {/* カレンダーグリッド */}
          <div className="grid grid-cols-7 gap-px bg-sidebar rounded-xl overflow-hidden border border-border">
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="min-h-[3.5rem] bg-sidebar" />;
              }
              const dayEvents = eventsByDay.get(day) ?? [];
              const isSelected = selectedDay === day;
              const todayFlag = isToday(day);
              const dayOfWeek = new Date(year, month - 1, day).getDay();

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`min-h-[3.5rem] p-1 flex flex-col items-center gap-0.5 transition-colors relative ${
                    isSelected
                      ? "bg-blue-400/15"
                      : "bg-sidebar hover:bg-white/[0.04]"
                  }`}
                >
                  <span
                    className={`text-xs font-medium leading-none mt-1 w-6 h-6 flex items-center justify-center rounded-full ${
                      isSelected
                        ? "bg-accent text-white font-bold"
                        : todayFlag
                          ? "bg-accent text-white font-bold"
                          : dayOfWeek === 0
                            ? "text-red-400"
                            : dayOfWeek === 6
                              ? "text-blue-400"
                              : "text-foreground"
                    }`}
                  >
                    {day}
                  </span>
                  {/* イベントバー（最大2件表示） */}
                  {dayEvents.slice(0, 2).map((ev) => (
                    <div
                      key={ev.id}
                      className={`w-full rounded-sm px-0.5 truncate text-[9px] leading-tight ${
                        isSelected
                          ? "bg-white/30 text-white"
                          : "bg-accent/30 text-accent"
                      }`}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 2 && (
                    <span className={`text-[9px] ${isSelected ? "text-white/70" : "text-muted"}`}>
                      +{dayEvents.length - 2}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 選択日のイベント一覧 */}
          <div className="mt-6 space-y-3">
            {selectedDay && (
              <h3 className="text-sm font-bold text-foreground mb-2">
                {month}/{selectedDay}（{WEEKDAYS[new Date(year, month - 1, selectedDay).getDay()]}）のイベント
              </h3>
            )}

            {loading ? (
              <div className="text-center py-8 text-muted">読み込み中...</div>
            ) : selectedDay && selectedEvents.length === 0 ? (
              <div className="text-center py-8 text-muted">
                <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                <p className="text-sm">イベントはありません</p>
              </div>
            ) : (
              selectedEvents.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => router.push(`/${params.workspace}/${ev.channel.slug}`)}
                  className="block w-full text-left px-4 py-3 rounded-xl border border-border bg-surface hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="text-sm font-mono text-accent shrink-0 mt-0.5">
                      {formatTime(ev.start_at)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground mb-1 truncate">
                        {ev.title}
                      </div>
                      {ev.location && (
                        <div className="text-xs text-muted mb-1 truncate">
                          📍 {ev.location}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        {/* 参加者アバター */}
                        <div className="flex -space-x-1.5">
                          {ev.attendees.slice(0, 5).map((a) =>
                            a.avatar_url ? (
                              <img
                                key={a.id}
                                src={a.avatar_url}
                                alt={a.display_name}
                                className="w-5 h-5 rounded-full border border-surface object-cover"
                              />
                            ) : (
                              <div
                                key={a.id}
                                className="w-5 h-5 rounded-full bg-accent/20 border border-surface flex items-center justify-center"
                              >
                                <span className="text-[8px] font-bold text-accent">
                                  {a.display_name[0]?.toUpperCase()}
                                </span>
                              </div>
                            )
                          )}
                          {ev.attendees.length > 5 && (
                            <div className="w-5 h-5 rounded-full bg-muted/20 border border-surface flex items-center justify-center">
                              <span className="text-[8px] text-muted">+{ev.attendees.length - 5}</span>
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-muted truncate">#{ev.channel.name}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
