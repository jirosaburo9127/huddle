"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractDisplayFileName } from "@/lib/file-name";

export type MediaItem = {
  url: string;
  authorName?: string;
  authorAvatar?: string | null;
  timestamp?: string;
};

type Props = {
  // 単一閲覧モード（既存呼び出しとの互換）
  url?: string;
  authorName?: string;
  authorAvatar?: string | null;
  timestamp?: string;
  // 共通: 閉じる
  onClose: () => void;
  // 共通: 上部に表示するチャンネル名 (#channel-name)
  contextLabel?: string;
  // 連続閲覧モード（メディア一覧から起動するとき）
  mediaList?: MediaItem[];
  currentIndex?: number;
  onIndexChange?: (newIndex: number) => void;
};

// "2026年4月22日 11:43" 形式
function formatLightboxTimestamp(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}年${m}月${day}日 ${hh}:${mm}`;
}

// 動画拡張子判定（メディア一覧から動画も渡される可能性があるため）
function isVideoUrl(u: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);
}

// ピンチズーム・パン・ダブルタップ・下スワイプで閉じる + 連続閲覧（mediaList 指定時）対応のライトボックス。
export function ImageLightbox(props: Props) {
  const {
    url: singleUrl,
    onClose,
    authorName: singleAuthorName,
    authorAvatar: singleAuthorAvatar,
    timestamp: singleTimestamp,
    contextLabel,
    mediaList,
    currentIndex = 0,
    onIndexChange,
  } = props;

  const usingList = !!(mediaList && mediaList.length > 0);
  const activeMedia: MediaItem | null = usingList
    ? mediaList![Math.max(0, Math.min(currentIndex, mediaList!.length - 1))]
    : null;
  const url = activeMedia?.url ?? singleUrl ?? "";
  const authorName = activeMedia?.authorName ?? singleAuthorName;
  const authorAvatar = activeMedia?.authorAvatar ?? singleAuthorAvatar;
  const timestamp = activeMedia?.timestamp ?? singleTimestamp;

  const canPrev = usingList && currentIndex > 0;
  const canNext = usingList && currentIndex < (mediaList!.length - 1);

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [saving, setSaving] = useState(false);

  // タッチ状態を ref で保持（レンダー無しで高頻度更新したい）
  const gestureRef = useRef<{
    mode: "idle" | "pan" | "pinch";
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
    startDist: number;
    startScale: number;
    pinchCenterX: number;
    pinchCenterY: number;
    lastTap: number;
  }>({
    mode: "idle",
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
    startDist: 0,
    startScale: 1,
    pinchCenterX: 0,
    pinchCenterY: 0,
    lastTap: 0,
  });

  const resetZoom = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  const goPrev = useCallback(() => {
    if (canPrev && onIndexChange) {
      onIndexChange(currentIndex - 1);
      resetZoom();
    }
  }, [canPrev, currentIndex, onIndexChange, resetZoom]);

  const goNext = useCallback(() => {
    if (canNext && onIndexChange) {
      onIndexChange(currentIndex + 1);
      resetZoom();
    }
  }, [canNext, currentIndex, onIndexChange, resetZoom]);

  function distance(touches: React.TouchList): number {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function onTouchStart(e: React.TouchEvent) {
    e.stopPropagation();
    const g = gestureRef.current;
    if (e.touches.length === 2) {
      g.mode = "pinch";
      g.startDist = distance(e.touches);
      g.startScale = scale;
      g.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      g.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      g.startTx = tx;
      g.startTy = ty;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - g.lastTap < 300) {
        // ダブルタップ: 1x ⇄ 2x トグル
        if (scale > 1) {
          resetZoom();
        } else {
          setScale(2);
        }
        g.lastTap = 0;
        return;
      }
      g.lastTap = now;
      g.mode = "pan";
      g.startX = e.touches[0].clientX;
      g.startY = e.touches[0].clientY;
      g.startTx = tx;
      g.startTy = ty;
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    const g = gestureRef.current;
    if (g.mode === "pinch" && e.touches.length === 2) {
      e.stopPropagation();
      e.preventDefault();
      const d = distance(e.touches);
      const next = Math.max(1, Math.min(5, (d / g.startDist) * g.startScale));
      setScale(next);
    } else if (g.mode === "pan" && e.touches.length === 1) {
      e.stopPropagation();
      e.preventDefault();
      const dx = e.touches[0].clientX - g.startX;
      const dy = e.touches[0].clientY - g.startY;
      if (scale > 1) {
        // ズーム時: 自由にパン
        setTx(g.startTx + dx);
        setTy(g.startTy + dy);
      } else {
        // 等倍時: 下スワイプで閉じる + 横スワイプで前後ナビ（mediaList 指定時のみ）
        // 横と縦のうち、どちらの動きが大きいかで挙動を分岐
        if (Math.abs(dx) > Math.abs(dy) && usingList) {
          // 横方向: 画像を引きずる感じだけ（実際の遷移は touchEnd で判定）
          setTx(g.startTx + dx * 0.5);
          setTy(g.startTy + dy * 0.2);
        } else {
          // 縦方向（dismiss）
          setTx(g.startTx + dx * 0.3);
          setTy(g.startTy + (dy > 0 ? dy : dy * 0.3));
        }
      }
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const g = gestureRef.current;
    if (e.touches.length === 0) {
      g.mode = "idle";
      if (scale <= 1.01) {
        // 下に 100px 以上スワイプされていたら閉じる
        if (ty > 100) {
          onClose();
          return;
        }
        // 横に 80px 以上スワイプされていたら前後にナビ（mediaList 指定時のみ）
        if (usingList && Math.abs(tx) > 80 && Math.abs(tx) > Math.abs(ty) * 1.5) {
          if (tx < 0 && canNext) {
            goNext();
            return;
          }
          if (tx > 0 && canPrev) {
            goPrev();
            return;
          }
        }
        setTx(0);
        setTy(0);
      }
    } else if (e.touches.length === 1 && g.mode === "pinch") {
      // ピンチ→パンへ切替
      g.mode = "pan";
      g.startX = e.touches[0].clientX;
      g.startY = e.touches[0].clientY;
      g.startTx = tx;
      g.startTy = ty;
    }
  }

  // 等倍時の下スワイプ進捗 (0〜1) — 背景と画像の opacity を連動させる
  const dismissProgress = scale <= 1.01 && ty > 0 ? Math.min(1, ty / 250) : 0;

  // Esc / ←→ キー
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  // メディア切替時はズーム位置をリセット
  useEffect(() => {
    resetZoom();
  }, [url, resetZoom]);

  // 保存: iOS では画像をキャッシュに書き出して file URI で Share.share することで
  // Share シートに「写真に保存」を表示させる。Web は blob fetch で即ダウンロード。
  const handleSave = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (saving) return;
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) {
          // PC/Web: blob として fetch して即ダウンロード
          setSaving(true);
          const res = await fetch(url);
          const blob = await res.blob();
          const downloadName = extractDisplayFileName(url) || `huddle-${Date.now()}`;
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = downloadName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          return;
        }
        setSaving(true);
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
        ]);
        const res = await fetch(url);
        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const r = reader.result as string;
            const comma = r.indexOf(",");
            resolve(comma >= 0 ? r.slice(comma + 1) : r);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });

        let fileName = extractDisplayFileName(url);
        if (!fileName || fileName === "ファイル") {
          let ext = "jpg";
          const mime = blob.type || "";
          if (mime.includes("png")) ext = "png";
          else if (mime.includes("gif")) ext = "gif";
          else if (mime.includes("webp")) ext = "webp";
          else if (mime.includes("heic")) ext = "heic";
          else {
            const m = url.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
            if (m) ext = m[1].toLowerCase();
          }
          fileName = `huddle-${Date.now()}.${ext}`;
        }
        const saved = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });

        await Share.share({
          files: [saved.uri],
        });
      } catch (err) {
        try {
          const { Share } = await import("@capacitor/share");
          await Share.share({ url });
        } catch {
          console.error("[image-lightbox] save failed:", err);
        }
      } finally {
        setSaving(false);
      }
    },
    [url, saving]
  );

  const isVideo = isVideoUrl(url);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center pt-16 pb-12 px-4 overflow-hidden"
      style={{ backgroundColor: `rgba(0, 0, 0, ${0.9 - dismissProgress * 0.7})` }}
      onClick={onClose}
    >
      {/* 上部左: 投稿者・時刻・コンテキスト（Slack 風） */}
      {(authorName || contextLabel) && (
        <div
          className="absolute top-4 left-4 right-28 z-10 flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2.5 max-w-full">
            {authorAvatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={authorAvatar}
                alt={authorName || ""}
                className="w-8 h-8 rounded-full object-cover shrink-0"
              />
            ) : authorName ? (
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {authorName[0]?.toUpperCase()}
              </div>
            ) : null}
            <div className="min-w-0 text-white">
              {authorName && (
                <div className="text-sm font-semibold truncate">{authorName}</div>
              )}
              {(timestamp || contextLabel) && (
                <div className="text-xs text-white/70 truncate flex items-center gap-1.5">
                  {timestamp && <span>{formatLightboxTimestamp(timestamp)}</span>}
                  {timestamp && contextLabel && <span>·</span>}
                  {contextLabel && <span>{contextLabel}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 上部右: ボタン群 */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-9 h-9 rounded-full bg-black/60 border border-white/30 hover:bg-black/80 flex items-center justify-center transition-colors shadow-lg disabled:opacity-50"
          aria-label="保存"
        >
          {saving ? (
            <svg className="w-4 h-4 text-white animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" strokeOpacity="0.3" />
              <path strokeLinecap="round" d="M21 12a9 9 0 00-9-9" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="w-9 h-9 rounded-full bg-black/60 border border-white/30 hover:bg-black/80 flex items-center justify-center transition-colors shadow-lg"
          aria-label="閉じる"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 連続閲覧時の前へ/次へボタン */}
      {usingList && canPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          aria-label="前へ"
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/60 border border-white/30 hover:bg-black/80 flex items-center justify-center text-white shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {usingList && canNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          aria-label="次へ"
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/60 border border-white/30 hover:bg-black/80 flex items-center justify-center text-white shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* インデックス表示（連続閲覧時のみ） */}
      {usingList && mediaList && mediaList.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/60 border border-white/20 text-white text-xs">
          {currentIndex + 1} / {mediaList.length}
        </div>
      )}

      {/* メディア本体（画像 or 動画） */}
      {isVideo ? (
        <video
          src={url}
          controls
          autoPlay
          playsInline
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
            opacity: 1 - dismissProgress * 0.4,
            transition:
              gestureRef.current.mode === "idle"
                ? "transform 0.2s ease-out, opacity 0.2s ease-out"
                : "none",
          }}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt="拡大画像"
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (scale > 1) resetZoom();
            else setScale(2);
          }}
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
            opacity: 1 - dismissProgress * 0.4,
            transition:
              gestureRef.current.mode === "idle"
                ? "transform 0.2s ease-out, opacity 0.2s ease-out"
                : "none",
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        />
      )}
    </div>
  );
}
