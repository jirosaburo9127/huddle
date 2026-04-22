"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * ワークスペース内のページ遷移時に前のコンテンツが一瞬見える問題を防ぐ。
 * pathnameの変化を検知して即座にスケルトンを表示し、
 * 新しいコンテンツが到着したら切り替える。
 */
export default function WorkspaceTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [displayedPath, setDisplayedPath] = useState(pathname);
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    if (pathname !== displayedPath) {
      setShowSkeleton(true);
    }
  }, [pathname, displayedPath]);

  useEffect(() => {
    setDisplayedPath(pathname);
    setShowSkeleton(false);
  }, [children, pathname]);

  if (showSkeleton) {
    return (
      <div className="flex flex-col h-full animate-pulse page-enter">
        <header className="flex items-center px-4 py-3 border-b border-border bg-header shrink-0">
          <div className="flex items-center gap-2 pl-10 lg:pl-0">
            <div className="w-4 h-4 bg-border/50 rounded" />
            <div className="w-32 h-5 bg-border/50 rounded" />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-border/20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
