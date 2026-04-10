// 日付セパレーターコンポーネント
type Props = { date: string };

export function DateSeparator({ date }: Props) {
  const d = new Date(date);
  // timeZone を明示しないと SSR(UTC) と CSR(JST) で日付がズレて
  // React hydration mismatch (#418) を起こすため Asia/Tokyo を固定
  const label = d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  });

  return (
    <div className="flex items-center gap-4 my-6">
      <div className="flex-1 h-px bg-border/50" />
      <span className="text-[11px] font-medium text-muted bg-background px-3 py-1 rounded-full border border-border/30">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}
