export default function ChannelLoading() {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center px-3 sm:px-4 py-3 lg:py-0 lg:h-14 border-b border-border bg-header shrink-0">
        <div className="h-5 w-28 rounded-md bg-border/20" />
      </header>

      <div className="flex-1 overflow-hidden" />

      <div className="shrink-0 px-3 sm:px-4 pb-3 sm:pb-4">
        <div className="h-12 rounded-xl border border-border/70 bg-input-bg/70" />
      </div>
    </div>
  );
}
