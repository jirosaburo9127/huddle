// ============================================================================
// クライアント蓄積型 state の安全な同期取得ユーティリティ
//
// なぜこれが存在するか:
//   過去に「最新N件取得 + ID重複排除マージ」というアンチパターンで、
//   バックグラウンド放置からの復帰時にメッセージが中抜け表示される
//   重大事故が発生した（2026-04-30 / 詳細は AGENTS.md 参照）。
//
// 同期処理を書く時は必ずこのファイルの fetchSincePeriod / mergeById を使う。
// 直接 .order(desc).limit(N) で最新側を取って setState((prev) => ...) で
// マージすることは禁止（中抜けが原理的に発生する）。
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = { id: string; created_at: string };

interface FetchSincePeriodArgs<T extends Row> {
  supabase: SupabaseClient;
  table: string;
  select: string;
  /**
   * 等値で絞り込む条件（例: `{ channel_id: "xxx" }`）。
   * 多くの同期処理は「特定チャンネル」「特定ユーザー」など eq フィルタが必須。
   */
  eq: Record<string, string | number | boolean>;
  /**
   * 直近何日分を毎回フル取得するか。チャンネルの予想投稿密度 × 安全係数で決める。
   * 目安: 通常チャンネル 7日、超活発チャンネル 3日、低頻度チャンネル 30日。
   */
  sinceDays: number;
  /**
   * 1ページあたりの取得件数の上限。デフォルト 500（Supabase 推奨上限）。
   */
  pageSize?: number;
  /**
   * cursor ループの最大回数（暴走防止）。デフォルト 20（= 最大 1万件）。
   */
  maxPages?: number;
  /**
   * 中断シグナル。コンポーネントアンマウント時などに true を返す関数を渡す。
   */
  isCancelled?: () => boolean;
  /**
   * `deleted_at IS NULL` で論理削除を除外するか。デフォルト false（全件取得）。
   */
  excludeDeleted?: boolean;
}

/**
 * 「直近N日分を全件再取得」する安全な同期 fetcher。
 *
 * 仕組み:
 *   - `created_at >= now() - sinceDays` で範囲指定
 *   - 昇順で pageSize 件ずつ cursor ループ
 *   - 同タイムスタンプ重複を避けるため cursor を `last + 1ms` で進める
 *   - 0件 or pageSize 未満で終了
 *
 * これにより「ローカル state に欠けがある中間期間」も含めて毎回フル取得され、
 * mergeById で重複排除すれば**原理的に中抜けが発生しない**。
 */
export async function fetchSincePeriod<T extends Row>(
  args: FetchSincePeriodArgs<T>
): Promise<T[]> {
  const {
    supabase,
    table,
    select,
    eq,
    sinceDays,
    pageSize = 500,
    maxPages = 20,
    isCancelled,
    excludeDeleted = false,
  } = args;

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const collected: T[] = [];
  let cursor = since;

  for (let i = 0; i < maxPages; i++) {
    if (isCancelled?.()) return collected;

    let query = supabase
      .from(table)
      .select(select)
      .gte("created_at", cursor)
      .order("created_at", { ascending: true })
      .limit(pageSize);

    for (const [key, value] of Object.entries(eq)) {
      query = query.eq(key, value);
    }
    if (excludeDeleted) {
      query = query.is("deleted_at", null);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;

    const rows = data as unknown as T[];
    collected.push(...rows);
    if (rows.length < pageSize) break;

    // 同タイムスタンプの行を二重取りしないよう +1ms で進める
    const last = new Date(rows[rows.length - 1].created_at).getTime() + 1;
    cursor = new Date(last).toISOString();
  }

  return collected;
}

/**
 * 既存配列に新しい配列を ID 重複排除しながらマージし、created_at 昇順で返す。
 * `fetchSincePeriod` の結果を `setState((prev) => mergeById(prev, fresh))` で
 * 既存 state にマージする時に使う。
 */
export function mergeById<T extends Row>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const existingIds = new Set(prev.map((m) => m.id));
  const additions = incoming.filter((m) => !existingIds.has(m.id));
  if (additions.length === 0) return prev;
  const merged = [...prev, ...additions];
  merged.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return merged;
}
