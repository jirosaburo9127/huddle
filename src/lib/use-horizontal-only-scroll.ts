"use client";

import { useEffect, type RefObject } from "react";

// 横スクロール可能な要素（タブ列など）で、iOSの縦揺れを完全に抑止するためのフック。
// ネイティブの横スクロールを使うと、親コンテナの縦スクロールにもジェスチャーが
// 伝播して上下にブレる。そこで:
//   - 最初の 5px で方向確定
//   - 横優勢なら preventDefault() で親の縦スクロールを殺し、scrollLeft を自分で更新
//   - 縦優勢ならそのまま親に任せる（ページが縦スクロールする）
export function useHorizontalOnlyScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let decided: "x" | "y" | null = null;

    function onTouchStart(e: TouchEvent) {
      if (!el || e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startScrollLeft = el.scrollLeft;
      decided = null;
    }

    function onTouchMove(e: TouchEvent) {
      if (!el || e.touches.length !== 1) return;
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
        // 親の縦スクロールを抑止しつつ、横スクロールは自分で更新
        e.preventDefault();
        el.scrollLeft = startScrollLeft - dx;
      }
      // decided === "y" のときは何もしない（親がそのまま縦スクロール）
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [ref]);
}
