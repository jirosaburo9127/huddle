// 外部カレンダー (Apple / Google / Outlook) からの購読用エンドポイント。
// URL に埋め込まれた token を検証し、該当ユーザの予定を .ics 形式で返す。
//
// 例: https://huddle-sigma-flax.vercel.app/api/calendar/<token>.ics
//
// token は user_calendar_tokens テーブルで管理。漏洩時は本人が rotate して
// 古い token を破棄できる。get_events_by_calendar_token RPC が SECURITY DEFINER
// で動くので、anon key で呼んでも RLS をバイパスして該当ユーザの予定を取得できる。

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  title: string;
  start_at: string;
  location: string | null;
  created_at: string;
  channel_name: string | null;
  creator_name: string | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  // 末尾の .ics を許容 (Google/Apple は拡張子付き URL を好む)
  const cleaned = token.replace(/\.ics$/i, "");

  if (!cleaned || cleaned.length < 32) {
    return new Response("invalid token", { status: 404 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase.rpc("get_events_by_calendar_token", {
    p_token: cleaned,
  });

  if (error || data === null) {
    return new Response("invalid token", { status: 404 });
  }

  const events = (data as EventRow[]) ?? [];
  const ics = buildIcs(events);

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // 5 分間 CDN にキャッシュさせて連続アクセスを軽減
      // (Apple/Google の同期間隔自体は数時間〜1日)
      "Cache-Control": "public, max-age=300",
    },
  });
}

function buildIcs(events: EventRow[]): string {
  const dtstamp = formatIcsDate(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Huddle//Calendar//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Huddle",
    "X-WR-TIMEZONE:Asia/Tokyo",
  ];

  for (const e of events) {
    const start = new Date(e.start_at);
    // Huddle の予定は終了時刻を持っていないため 1 時間として扱う
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@huddle`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcs(e.title)}`
    );
    if (e.location) lines.push(`LOCATION:${escapeIcs(e.location)}`);

    const descParts: string[] = [];
    if (e.channel_name) descParts.push(`チャンネル: #${e.channel_name}`);
    if (e.creator_name) descParts.push(`作成者: ${e.creator_name}`);
    if (descParts.length > 0) {
      lines.push(`DESCRIPTION:${escapeIcs(descParts.join("\n"))}`);
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 に従い CRLF で連結
  return lines.join("\r\n") + "\r\n";
}

function formatIcsDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
