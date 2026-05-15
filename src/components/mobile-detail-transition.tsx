"use client";

import { useMobileNavStore } from "@/stores/mobile-nav-store";

export function MobileDetailTransition() {
  const pendingDetailOpen = useMobileNavStore((s) => s.pendingDetailOpen);
  const title = useMobileNavStore((s) => s.detailTransitionTitle);

  if (!pendingDetailOpen) return null;

  return (
    <div className="mobile-detail-transition fixed inset-0 z-[60] bg-background lg:hidden">
      <div className="h-14 border-b border-border bg-header flex items-center px-4">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-muted text-lg leading-none">#</span>
          <span className="truncate text-base font-semibold text-foreground">
            {title || "チャンネル"}
          </span>
        </div>
      </div>
      <div className="flex-1 px-4 py-5 space-y-4">
        <div className="h-10 w-3/4 rounded-xl bg-border-subtle/70 animate-pulse" />
        <div className="h-16 rounded-2xl bg-border-subtle/50 animate-pulse" />
        <div className="h-12 w-5/6 rounded-2xl bg-border-subtle/45 animate-pulse" />
      </div>
    </div>
  );
}
