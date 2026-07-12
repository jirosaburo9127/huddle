"use client";

import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

// ============================================================
// TestFlight に上げた「最新の iOS ビルド番号」。
// 新しいビルドを TestFlight に配布したら、この数字を上げてデプロイするだけで、
// 古いビルドを使っているユーザーに「最新版に更新して」バナーが出る。
// （App Store Connect のビルド番号 = CFBundleVersion と一致させる）
// ============================================================
const LATEST_IOS_BUILD = 15;

// TestFlight アプリを開く URL スキーム
const TESTFLIGHT_URL = "itms-beta://";

/**
 * ネイティブ(iOS)アプリで、現在のビルドが最新より古い時に
 * 「最新版にアップデートしてください」バナーを表示する。
 * Web(Safari/PWA)では常に最新のWebを読むので何も表示しない。
 */
export function AppUpdateBanner() {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    try {
      if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      const build = parseInt(info.build, 10);
      setNeedsUpdate(!Number.isNaN(build) && build < LATEST_IOS_BUILD);
    } catch {
      // Web など Capacitor が無い環境では無視
    }
  }, []);

  useEffect(() => {
    check();
    // 復帰時に再チェックし、閉じていても再度促す
    const onResume = () => { setDismissed(false); check(); };
    window.addEventListener("huddle:appResumed", onResume);
    return () => window.removeEventListener("huddle:appResumed", onResume);
  }, [check]);

  if (!needsUpdate || dismissed) return null;

  function openTestFlight() {
    try {
      window.open(TESTFLIGHT_URL, "_system");
    } catch {
      window.location.href = TESTFLIGHT_URL;
    }
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[200]" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center gap-3 bg-accent px-4 py-2.5 shadow-lg">
        <svg className="w-5 h-5 shrink-0 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 3v13m0 0l-4-4m4 4l4-4" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold leading-tight text-white">最新版があります</p>
          <p className="text-[11px] leading-tight text-white/90">TestFlightでHuddleを更新してください</p>
        </div>
        <button
          onClick={openTestFlight}
          className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-accent active:scale-95 transition-transform"
        >
          更新
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="閉じる"
          className="shrink-0 p-1 text-white/80 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
