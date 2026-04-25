"use client";

import { useEffect, useState } from "react";

export function DebugBanner() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    function onLog(e: Event) {
      const ce = e as CustomEvent<string>;
      const now = new Date();
      const ts = `${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
      setLines((prev) => [`${ts} ${ce.detail}`, ...prev].slice(0, 15));
    }
    window.addEventListener("huddle:debug", onLog);
    return () => window.removeEventListener("huddle:debug", onLog);
  }, []);

  if (lines.length === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[999] bg-black/85 text-green-300 text-[10px] font-mono leading-tight p-1 pointer-events-none max-h-[40vh] overflow-hidden"
      aria-hidden
    >
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? "text-yellow-300" : ""}>{l}</div>
      ))}
    </div>
  );
}
