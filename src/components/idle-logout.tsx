"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// 非アクティブ時の自動サインアウト（セッション侵害の時間窓を狭める）
// 4時間操作がなかったら自動でサインアウトしてログイン画面に戻す。
// チャットアプリとしての使い勝手を壊さない程度の妥協ライン。
const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 時間

export function IdleLogout() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const supabase = createClient();

    async function logout() {
      try {
        await supabase.auth.signOut();
      } catch {
        // サインアウト失敗でも強制リダイレクトして画面は閉じる
      }
      window.location.href = "/login?reason=idle";
    }

    function reset() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, IDLE_TIMEOUT_MS);
    }

    // 最初に1本タイマーをセット
    reset();

    // ユーザー操作で都度リセット。passive:true でスクロール遅延させない
    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "keydown",
      "touchstart",
      "scroll",
      "click",
    ];
    for (const ev of events) {
      window.addEventListener(ev, reset, { passive: true });
    }

    // visibilitychange: 画面復帰でも再スタート（バックグラウンドに置かれた長時間タブ対策）
    function onVisible() {
      if (document.visibilityState === "visible") reset();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const ev of events) {
        window.removeEventListener(ev, reset);
      }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
