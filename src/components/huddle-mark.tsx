// Huddle のロゴ横にある黄色いマーク。みかん（AI）の目印としても使う
export function HuddleMark({ size = 18, className = "" }: { size?: number; className?: string }) {
  const small = Math.round(size / 3);
  const large = Math.round((size * 2) / 3);
  return (
    <span
      className={`inline-block shrink-0 bg-[var(--home-accent)] ${className}`}
      style={{ width: size, height: size, borderRadius: `${small}px ${large}px ${small}px ${large}px` }}
      aria-hidden="true"
    />
  );
}
