"use client";

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
  return (
    <main
      className={`
        fixed inset-0 z-50 w-full bg-background flex flex-col min-w-0 transform-gpu
        transition-[transform,padding] duration-200 ease-out
        lg:static lg:z-auto lg:flex-1 lg:translate-x-0 lg:transform-none lg:pb-0
        ${sidebarOpen ? "translate-x-full pointer-events-none lg:pointer-events-auto" : "translate-x-0 pointer-events-auto"}
        ${messageInputFocused ? "pb-0" : "pb-14"}
      }`}
    >
      {children}
    </main>
  );
}
