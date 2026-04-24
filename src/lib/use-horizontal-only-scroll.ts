"use client";

import { useCallback, useRef } from "react";

// 横スクロール可能な要素（タブ列など）で、iOSの縦揺れを完全に抑止するためのフック。
// 返り値は callback ref なので、条件付きレンダリングで要素が後から出現しても確実に動作する。
//
// 使い方:
//   const tabsRef = useHorizontalOnlyScroll();
//   <div ref={tabsRef} className="overflow-x-auto">...</div>
//
// 挙動:
//   - 最初の 5px で方向確定
//   - 横優勢 → preventDefault で親の縦スクロール伝播を殺し、scrollLeft を自分で更新
//   - 縦優勢 → 何もしない（親が通常通り縦スクロール）
export function useHorizontalOnlyScroll() {
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((el: HTMLElement | null) => {
    // 既存のリスナーを外す（要素が変わった / アンマウント時）
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let decided: "x" | "y" | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startScrollLeft = el.scrollLeft;
      decided = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (decided === null) {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (absX > 5 || absY > 5) {
          decided = absX > absY ? "x" : "y";
        }
      }
      if (decided === "x") {
        e.preventDefault();
        el.scrollLeft = startScrollLeft - dx;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    cleanupRef.current = () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);
}
