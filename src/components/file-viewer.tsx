"use client";

import { useEffect, useState, useCallback } from "react";
import { downloadFileWithName } from "@/lib/file-download";
import { stripFileUrlFragment } from "@/lib/file-name";

// アプリ内ファイルビューア。
// どのコンポーネントからでも openFileViewer(url, name) を呼べば、
// 画面内モーダルで PDF / 画像 / テキスト / 動画 をその場で表示する（新規タブ/外部ブラウザを開かない）。
// ホスト <FileViewerHost /> をワークスペースレイアウトに1つだけマウントする。

interface ViewerReq {
  url: string;
  name: string;
}

const EVENT = "huddle:openFileViewer";

export function openFileViewer(url: string, name: string) {
  window.dispatchEvent(new CustomEvent<ViewerReq>(EVENT, { detail: { url, name } }));
}

type Kind = "pdf" | "image" | "text" | "video" | "other";

function kindOf(name: string, url: string): Kind {
  const s = `${name} ${url}`.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)(\?|#|$)/.test(s)) return "image";
  if (/\.pdf(\?|#|$)/.test(s)) return "pdf";
  if (/\.(txt|md|markdown|csv|json|xml|ya?ml|log)(\?|#|$)/.test(s)) return "text";
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/.test(s)) return "video";
  return "other";
}

export function FileViewerHost() {
  const [req, setReq] = useState<ViewerReq | null>(null);
  const close = useCallback(() => setReq(null), []);

  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<ViewerReq>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, close]);

  if (!req) return null;

  const src = stripFileUrlFragment(req.url);
  const kind = kindOf(req.name, req.url);

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      {/* ヘッダー */}
      <div
        className="flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-medium truncate flex-1" title={req.name}>
          {req.name}
        </span>
        <button
          type="button"
          onClick={() => downloadFileWithName(req.url, req.name)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          title="ダウンロード"
          aria-label="ダウンロード"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        <button
          type="button"
          onClick={close}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          title="閉じる"
          aria-label="閉じる"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 本体 */}
      <div
        className="flex-1 min-h-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={req.name} className="w-full h-full object-contain" />
        ) : kind === "video" ? (
          <video src={src} controls autoPlay playsInline className="w-full h-full object-contain bg-black" />
        ) : kind === "pdf" || kind === "text" ? (
          <iframe src={src} title={req.name} className="w-full h-full rounded-lg bg-white" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-white/90">
            <p className="text-sm">この形式はプレビューできません</p>
            <button
              type="button"
              onClick={() => downloadFileWithName(req.url, req.name)}
              className="px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium"
            >
              ダウンロード
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
