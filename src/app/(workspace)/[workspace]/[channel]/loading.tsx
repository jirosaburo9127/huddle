export default function ChannelLoading() {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center px-3 sm:px-4 py-3 lg:py-0 lg:h-14 border-b border-border bg-header shrink-0">
        <div className="h-5 w-28 rounded-md bg-border/20" />
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px overflow-hidden bg-border/30">
          <div className="h-full w-1/3 animate-[channel-loading_0.9s_ease-in-out_infinite] rounded-full bg-accent/60" />
        </div>
      </div>

      <div className="shrink-0 px-3 sm:px-4 pb-3 sm:pb-4">
        <div className="h-12 rounded-xl border border-border/70 bg-input-bg/70" />
      </div>
    </div>
  );
}
