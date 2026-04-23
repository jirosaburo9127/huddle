"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// reactions テーブルに display_name カラムは無いため、
// supabase.from("messages").select("..., reactions(*)") で取ってきた reaction には
// 名前が含まれない（自分の楽観更新のみ例外）。
// user_id → display_name をプロセス全体で一度だけ取得してキャッシュする。

const globalCache = new Map<string, string>();
const inflight = new Set<string>();

export function useReactorNames(userIds: string[]): Record<string, string> {
  // 初期値はキャッシュから同期的に構築（既知分は即表示）
  const [localMap, setLocalMap] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const uid of userIds) {
      const n = globalCache.get(uid);
      if (n) init[uid] = n;
    }
    return init;
  });

  const key = userIds.join(",");
  useEffect(() => {
    // キャッシュから最新を反映
    setLocalMap((prev) => {
      const next: Record<string, string> = {};
      for (const uid of userIds) {
        const n = globalCache.get(uid);
        if (n) next[uid] = n;
      }
      const sameSize = Object.keys(prev).length === Object.keys(next).length;
      if (sameSize && Object.keys(next).every((k) => prev[k] === next[k])) {
        return prev;
      }
      return next;
    });

    // キャッシュにない分を一括フェッチ（進行中のIDは二重リクエストしない）
    const missing = userIds.filter(
      (uid) => !globalCache.has(uid) && !inflight.has(uid)
    );
    if (missing.length === 0) return;
    for (const uid of missing) inflight.add(uid);

    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", missing);
        if (data) {
          for (const p of data as Array<{ id: string; display_name: string | null }>) {
            if (p.display_name) globalCache.set(p.id, p.display_name);
          }
        }
      } finally {
        for (const uid of missing) inflight.delete(uid);
      }
      // フェッチ結果をローカルに反映
      setLocalMap(() => {
        const next: Record<string, string> = {};
        for (const uid of userIds) {
          const n = globalCache.get(uid);
          if (n) next[uid] = n;
        }
        return next;
      });
    })();
    // userIds 配列は render ごとに参照が変わるため join でキーにする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return localMap;
}
