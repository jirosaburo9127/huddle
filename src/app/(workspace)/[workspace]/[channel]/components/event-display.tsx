"use client";

// メッセージに紐づくイベントの表示
// - タイトル・日時・場所を表示
// - 参加者のアバターを表示（最大5人 + 超過分は +N 表示）

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AttendeeProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type EventData = {
  id: string;
  message_id: string;
  channel_id: string;
  created_by: string;
  title: string;
  start_at: string;
  location: string | null;
  attendee_ids: string[];
  created_at: string;
};

type Props = {
  messageId: string;
  currentUserId: string;
};

/** 日本語の曜日名 */
const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

/** 日時を日本語表記にフォーマット（例: 4月23日(水) 14:00） */
function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DAY_NAMES[d.getDay()];
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${month}月${day}日(${dow}) ${h}:${m}`;
}

const MAX_AVATARS = 5;

export function EventDisplay({ messageId, currentUserId }: Props) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [attendees, setAttendees] = useState<AttendeeProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchEvent() {
      const supabase = createClient();

      const { data: eventData, error: eventErr } = await supabase
        .from("events")
        .select("*")
        .eq("message_id", messageId)
        .maybeSingle();

      if (!mounted) return;
      if (eventErr) {
        // eslint-disable-next-line no-console
        console.error("[event] fetch failed:", eventErr);
        setFetchError(eventErr.message);
        setLoading(false);
        return;
      }
      if (!eventData) {
        setEvent(null);
        setLoading(false);
        return;
      }

      const ev = eventData as unknown as EventData;
      setEvent(ev);

      // 参加者プロフィールを取得
      if (ev.attendee_ids && ev.attendee_ids.length > 0) {
        const { data: profilesData, error: profilesErr } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", ev.attendee_ids);

        if (!mounted) return;
        if (profilesErr) {
          // eslint-disable-next-line no-console
          console.error("[event] attendees fetch failed:", profilesErr);
        } else {
          setAttendees((profilesData as AttendeeProfile[]) ?? []);
        }
      }

      setLoading(false);
    }

    fetchEvent();
    return () => { mounted = false; };
  }, [messageId]);

  if (loading) return null;
  if (fetchError) {
    return (
      <div className="mt-2 rounded-xl border border-border bg-surface/50 p-3 text-sm text-muted">
        イベントの読み込みに失敗しました
      </div>
    );
  }
  if (!event) return null;

  const isAttending = event.attendee_ids.includes(currentUserId);
  const isPast = new Date(event.start_at).getTime() < Date.now();
  const overflowCount = attendees.length - MAX_AVATARS;

  return (
    <div
      className="mt-2 rounded-xl border border-border bg-surface/50 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ヘッダーラベル */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">📅</span>
        <span className="text-xs font-semibold text-accent uppercase tracking-wider">
          イベント
        </span>
        {isPast && (
          <span className="text-[10px] text-muted ml-1">終了</span>
        )}
      </div>

      {/* タイトル */}
      <div className="text-sm font-bold text-foreground mb-1">
        {event.title}
      </div>

      {/* 日時 */}
      <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
        <span>🕐</span>
        <span>{formatDateTimeJa(event.start_at)}</span>
      </div>

      {/* 場所 */}
      {event.location && (
        <div className="flex items-center gap-1.5 text-xs text-muted mb-2">
          <span>📍</span>
          <span>{event.location}</span>
        </div>
      )}

      {/* 参加者アバター */}
      {attendees.length > 0 && (
        <div className="flex items-center gap-1 mt-2">
          <div className="flex -space-x-1.5">
            {attendees.slice(0, MAX_AVATARS).map((a) => (
              <div key={a.id} className="relative" title={a.display_name}>
                {a.avatar_url ? (
                  <img
                    src={a.avatar_url}
                    alt={a.display_name}
                    className={`w-6 h-6 rounded-full object-cover border-2 border-sidebar ${
                      a.id === currentUserId ? "ring-1 ring-accent" : ""
                    }`}
                  />
                ) : (
                  <div
                    className={`w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent border-2 border-sidebar ${
                      a.id === currentUserId ? "ring-1 ring-accent" : ""
                    }`}
                  >
                    {a.display_name.charAt(0)}
                  </div>
                )}
              </div>
            ))}
          </div>
          {overflowCount > 0 && (
            <span className="text-[11px] text-muted ml-1">
              +{overflowCount}
            </span>
          )}
          <span className="text-[11px] text-muted ml-1.5">
            {attendees.length}人参加
          </span>
          {isAttending && (
            <span className="text-[10px] text-accent font-medium ml-1">
              (参加中)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
