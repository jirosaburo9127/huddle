"use client";

import { useEffect, useState } from "react";

export function BackToAppBar() {
  // 「アプリに戻る」ボタンを表示すべきか判定
  // - Capacitor ネイティブアプリ内 → 常に表示（アプリに戻りたいに決まっているので）
  // - Web ブラウザ → 履歴がある (history.length > 1) 場合のみ表示
  //   (ブックマークやSNSリンクからの初回着地では「戻る」に意味がないので非表示)
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Capacitor 判定: WebView 環境では window.Capacitor が注入される
    const isCapacitor =
      typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor !== "undefined";
    if (isCapacitor) {
      setShow(true);
      return;
    }
    if (window.history.length > 1) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  // 戻る: 履歴があれば history.back()、無ければ / (アプリトップ) へ
  function handleBack() {
    if (typeof window === "undefined") return;
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/";
    }
  }

  return (
    <div className="sticky top-0 z-50 bg-[#0f0f1a] text-white text-center py-2 px-4">
      <button
        type="button"
        onClick={handleBack}
        className="text-sm font-medium hover:underline inline-flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        アプリに戻る
      </button>
    </div>
  );
}
