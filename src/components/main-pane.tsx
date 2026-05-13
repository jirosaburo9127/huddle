"use client";

import { useEffect, useRef, useState } from "react";
import { useMobileNavStore } from "@/stores/mobile-nav-store";

/**
 * ワークスペース main 領域のクライアント側ラッパー。
 * モバイルでは下部 BottomTabBar の高さ分の padding (pb-14) を確保するが、
 * メッセージ入力欄フォーカス中はバーが画面外にスライドするので padding も解除して
 * 余白が残らないようにする。
 */
export function MainPane({ children }: { children: React.ReactNode }) {
  const messageInputFocused = useMobileNavStore((s) => s.messageInputFocused);
  const sidebarOpen = useMobileNavStore((s) => s.sidebarOpen);
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const detailEnterVersion = useMobileNavStore((s) => s.detailEnterVersion);
  const [playingDetailEnter, setPlayingDetailEnter] = useState(false);
  const seenEnterVersionRef = useRef(0);

  useEffect(() => {
    if (detailEnterVersion === 0 || detailEnterVersion === seenEnterVersionRef.current) return;
    seenEnterVersionRef.current = detailEnterVersion;
    setPlayingDetailEnter(true);
    // アニメーション完了後にsidebarを閉じる（translate-x-0に確定）
    const timer = setTimeout(() => {
      setPlayingDetailEnter(false);
      setSidebarOpen(false);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [detailEnterVersion, setSidebarOpen]);

  // animation再生中はsidebarOpenのtranslateクラスを無視して
  // keyframe animationのtransformに完全に任せる
  const translateClass = playingDetailEnter
    ? "pointer-events-auto"
    : sidebarOpen
      ? "translate-x-full pointer-events-none lg:pointer-events-auto"
      : "translate-x-0 pointer-events-auto";

  return (
    <main
      className={`
        fixed inset-0 z-50 w-full bg-background flex flex-col min-w-0 transform-gpu
        lg:static lg:z-auto lg:flex-1 lg:translate-x-0 lg:transform-none lg:pb-0
        ${playingDetailEnter ? "animate-mobile-detail-enter" : "transition-[transform,padding] duration-200 ease-out"}
        ${translateClass}
        ${messageInputFocused ? "pb-0" : "pb-14"}
      `}
    >
      {children}
    </main>
  );
}
