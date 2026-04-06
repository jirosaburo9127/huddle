export default function ChannelLoading() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      {/* ヘッダースケルトン */}
      <header className="flex items-center px-4 py-3 border-b border-border bg-header shrink-0">
        <div className="flex items-center gap-2 pl-10 lg:pl-0">
          <div className="w-4 h-4 bg-border/50 rounded" />
          <div className="w-32 h-5 bg-border/50 rounded" />
        </div>
      </header>

      {/* メッセージスケルトン */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-9 h-9 rounded-full bg-border/30 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-20 h-3 bg-border/40 rounded" />
                <div className="w-12 h-3 bg-border/20 rounded" />
              </div>
              <div className="w-3/4 h-4 bg-border/30 rounded" />
              {i % 3 === 0 && <div className="w-1/2 h-4 bg-border/20 rounded" />}
            </div>
          </div>
        ))}
      </div>

      {/* 入力欄スケルトン */}
      <div className="shrink-0 px-4 pb-4">
        <div className="rounded-xl border border-border bg-input-bg px-3 py-3">
          <div className="w-48 h-4 bg-border/30 rounded" />
        </div>
      </div>
    </div>
  );
}
