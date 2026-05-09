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
  return (
    <main
      className={`flex-1 flex flex-col min-w-0 lg:pb-0 transition-[padding] duration-150 ${
        messageInputFocused ? "pb-0" : "pb-14"
      }`}
    >
      {children}
    </main>
  );
}
