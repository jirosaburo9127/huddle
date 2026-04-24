"use client";

import { useEffect, useState } from "react";

// 画面上部に固定表示するデバッグバナー。
// window.dispatchEvent(new CustomEvent("huddle:debug", { detail: "..." })) でログ追加。
// 本番でユーザー実機のイベントフローを可視化するための一時的な手段。
export function DebugBanner() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    function onLog(e: Event) {
      const ce = e as CustomEvent<string>;
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
      setLines((prev) => [`${ts} ${ce.detail}`, ...prev].slice(0, 12));
    }
    window.addEventListener("huddle:debug", onLog);
    // pathname 変化は navigation 成功の確実な印
    let lastPath = window.location.pathname;
    const pathChecker = setInterval(() => {
      if (window.location.pathname !== lastPath) {
        window.dispatchEvent(
          new CustomEvent("huddle:debug", {
            detail: `[URL] ${lastPath} → ${window.location.pathname}`,
          })
        );
        lastPath = window.location.pathname;
      }
    }, 100);
    // 初回の URL ログ
    window.dispatchEvent(new CustomEvent("huddle:debug", { detail: `[INIT] ${lastPath}` }));
    return () => {
      window.removeEventListener("huddle:debug", onLog);
      clearInterval(pathChecker);
    };
  }, []);

  if (lines.length === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[999] bg-black/85 text-green-300 text-[10px] font-mono leading-tight p-1 pointer-events-none max-h-[45vh] overflow-hidden"
      aria-hidden
    >
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? "text-yellow-300" : ""}>{l}</div>
      ))}
    </div>
  );
}
