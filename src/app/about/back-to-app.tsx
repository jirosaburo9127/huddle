"use client";

export function BackToAppBar() {
  return (
    <div className="sticky top-0 z-50 bg-[#0f0f1a] text-white text-center py-2 px-4">
      <button
        type="button"
        onClick={() => {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.href = "/";
          }
        }}
        className="text-sm font-medium hover:underline inline-flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        アプリに戻る
      </button>
    </div>
  );
}
