import { Suspense } from "react";
import { WorkspaceShell } from "@/components/sidebar-loader";

// サイドバーのスケルトンUI（データ取得中に表示）
function SidebarSkeleton() {
  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-full sm:w-64 bg-sidebar flex-col border-r border-border hidden lg:flex lg:relative">
      {/* ヘッダースケルトン */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="h-8 w-24 bg-white/[0.06] rounded-lg animate-pulse" />
        <div className="h-5 w-36 bg-white/[0.04] rounded-lg animate-pulse mt-1" />
      </div>
      {/* 検索バースケルトン */}
      <div className="px-3 py-2">
        <div className="h-10 bg-white/[0.04] rounded-xl animate-pulse" />
      </div>
      {/* チャンネル一覧スケルトン */}
      <div className="flex-1 overflow-y-auto py-2 space-y-2 px-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 bg-white/[0.04] rounded-xl animate-pulse" />
        ))}
      </div>
    </aside>
  );
}

// ワークスペース全体のフォールバック（サイドバースケルトン + メインコンテンツ領域）
function WorkspaceSkeleton() {
  return (
    <>
      <SidebarSkeleton />
      <main className="flex-1 flex flex-col min-w-0" />
    </>
  );
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;

  return (
    <div className="flex h-full">
      <Suspense fallback={<WorkspaceSkeleton />}>
        <WorkspaceShell workspaceSlug={workspaceSlug}>
          {children}
        </WorkspaceShell>
      </Suspense>
    </div>
  );
}
