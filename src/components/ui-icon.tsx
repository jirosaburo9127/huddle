// 画面の目印に使う線画アイコン。アプリ内では絵文字を使わず、これか文字で表す
// （リアクションの絵文字だけは別）。
export const UI_ICON_PATHS = {
  paperclip:
    "M18.4 10.6l-7.1 7.1a4 4 0 01-5.7-5.7l7.8-7.8a2.7 2.7 0 013.8 3.8l-7.4 7.4a1.3 1.3 0 01-1.9-1.9l6.7-6.7",
  calendar:
    "M7 3v3m10-3v3M4.5 9.5h15M6 5h12a1.5 1.5 0 011.5 1.5v12A1.5 1.5 0 0118 20H6a1.5 1.5 0 01-1.5-1.5v-12A1.5 1.5 0 016 5z",
  clock: "M12 7.5V12l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  checkCircle: "M8.5 12.5l2.5 2.5 4.5-5M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  checkSquare: "M8.5 12.5l2.5 2.5 4.5-5M7 4h10a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V7a3 3 0 013-3z",
  alert: "M12 9v4m0 3.5h.01M10.3 4.3L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z",
  camera:
    "M4 8.5A1.5 1.5 0 015.5 7h2l1.3-2h6.4l1.3 2h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-9zM12 16a3 3 0 100-6 3 3 0 000 6z",
  video: "M15 10l5-3v10l-5-3M5 6.5h8.5A1.5 1.5 0 0115 8v8a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 16V8A1.5 1.5 0 015 6.5z",
  inbox: "M4 13.5l2.5-8h11l2.5 8M4 13.5V18a1.5 1.5 0 001.5 1.5h13A1.5 1.5 0 0020 18v-4.5M4 13.5h4.5a3.5 3.5 0 007 0H20",
  mindmap: "M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM5 5.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm14 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM5 15.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm14 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM6.3 7.8l3.6 2.7m4.2 0l3.6-2.7M6.3 16.2l3.6-2.7m4.2 0l3.6 2.7",
  refresh: "M4.5 12a7.5 7.5 0 0112.8-5.3L19.5 9m0-4.5V9H15M19.5 12a7.5 7.5 0 01-12.8 5.3L4.5 15m0 4.5V15H9",
  key: "M14.5 9.5a4 4 0 11-3.8 5.2L8 17.5v2H6v-2H4v-2l5.3-5.3A4 4 0 0114.5 9.5zm1.5 3h.01",
  crown: "M4 8l3.5 4L12 6l4.5 6L20 8l-1.5 9.5h-13L4 8z",
} as const;

export type UiIconName = keyof typeof UI_ICON_PATHS;

export function UiIcon({ name, size = 16, className = "" }: { name: UiIconName; size?: number; className?: string }) {
  return (
    <svg
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={UI_ICON_PATHS[name]} />
    </svg>
  );
}
