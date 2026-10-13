"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// reactions テーブルに display_name カラムは無いため、
// supabase.from("messages").select("..., reactions(*)") で取ってきた reaction には
// 名前が含まれない（自分の楽観更新のみ例外）。
// user_id → 名前とアイコンをプロセス全体で一度だけ取得してキャッシュする。

export type ReactorProfile = { name: string; avatarUrl: string | null };

const globalCache = new Map<string, ReactorProfile>();
const inflight = new Set<string>();
// キャッシュ更新の通知先。同じユーザーを待っている他のメッセージにも結果を配るために使う。
// （以前は取得を開始したコンポーネントしか更新されず、他は「読み込み中」のまま固まっていた）
const listeners = new Set<() => void>();
// 名前を取得できなかった場合の表示（権限で見えない・未設定など）
const UNKNOWN_NAME = "メンバー";

/** リアクションした人の名前とアイコンを返す（未取得の人は結果に含まれない） */
export function useReactorProfiles(userIds: string[]): Record<string, ReactorProfile> {
  // 初期値はキャッシュから同期的に構築（既知分は即表示）
  const [localMap, setLocalMap] = useState<Record<string, ReactorProfile>>(() => {
    const init: Record<string, ReactorProfile> = {};
    for (const uid of userIds) {
      const p = globalCache.get(uid);
      if (p) init[uid] = p;
    }
    return init;
  });

  const key = userIds.join(",");
  useEffect(() => {
    // キャッシュから最新を反映
    const syncFromCache = () =>
      setLocalMap((prev) => {
        const next: Record<string, ReactorProfile> = {};
        for (const uid of userIds) {
          const p = globalCache.get(uid);
          if (p) next[uid] = p;
        }
        const sameSize = Object.keys(prev).length === Object.keys(next).length;
        if (sameSize && Object.keys(next).every((k) => prev[k] === next[k])) {
          return prev;
        }
        return next;
      });
    syncFromCache();
    // 他のコンポーネントが開始した取得の結果も受け取る
    listeners.add(syncFromCache);
    const unsubscribe = () => {
      listeners.delete(syncFromCache);
    };

    // キャッシュにない分を一括フェッチ（進行中のIDは二重リクエストしない）
    const missing = userIds.filter(
      (uid) => !globalCache.has(uid) && !inflight.has(uid)
    );
    if (missing.length === 0) return unsubscribe;
    for (const uid of missing) inflight.add(uid);

    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", missing);
        if (error) {
          // 通信失敗時はキャッシュしない（次に表示された時に再取得する）
          console.error("[reactor-names] fetch failed:", error.message);
        } else {
          for (const p of (data || []) as Array<{ id: string; display_name: string | null; avatar_url: string | null }>) {
            if (p.display_name) globalCache.set(p.id, { name: p.display_name, avatarUrl: p.avatar_url });
          }
          // 取得は成功したが名前が無い/見えないユーザーは仮の名前で確定させる
          for (const uid of missing) {
            if (!globalCache.has(uid)) globalCache.set(uid, { name: UNKNOWN_NAME, avatarUrl: null });
          }
        }
      } finally {
        for (const uid of missing) inflight.delete(uid);
      }
      // 待っている全コンポーネントへ反映
      for (const notify of [...listeners]) notify();
    })();
    return unsubscribe;
    // userIds 配列は render ごとに参照が変わるため join でキーにする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return localMap;
}

/** 名前だけが要るとき用 */
export function useReactorNames(userIds: string[]): Record<string, string> {
  const profiles = useReactorProfiles(userIds);
  return useMemo(
    () => Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, p.name])),
    [profiles]
  );
}
