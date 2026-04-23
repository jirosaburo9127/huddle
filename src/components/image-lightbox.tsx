"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  url: string;
  onClose: () => void;
};

// ピンチズーム・パン・ダブルタップでの拡大を備えた画像ライトボックス。
// 保存ボタンは iOS の Share シートに「写真に保存」を出すため、
// 画像を一旦キャッシュに書き出してからファイル URI を渡す。
export function ImageLightbox({ url, onClose }: Props) {
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
    } else if (g.mode === "pan" && e.touches.length === 1 && scale > 1) {
      e.stopPropagation();
      e.preventDefault();
      const dx = e.touches[0].clientX - g.startX;
      const dy = e.touches[0].clientY - g.startY;
      setTx(g.startTx + dx);
      setTy(g.startTy + dy);
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const g = gestureRef.current;
    if (e.touches.length === 0) {
      g.mode = "idle";
      // ズーム1倍に戻ったら位置もリセット
      if (scale <= 1.01) {
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

  // Esc キーで閉じる
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 保存: iOS では画像をキャッシュに書き出して file URI で Share.share することで
  // Share シートに「写真に保存」を表示させる。Web は新規タブで開く。
  const handleSave = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (saving) return;
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) {
          window.open(url, "_blank");
          return;
        }
        setSaving(true);
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
        ]);
        // 画像を取得 → base64
        const res = await fetch(url);
        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const r = reader.result as string;
            // "data:image/png;base64,xxxxx" から後半だけ抜く
            const comma = r.indexOf(",");
            resolve(comma >= 0 ? r.slice(comma + 1) : r);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });

        // 拡張子をURLまたはMIMEから推定
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

        const fileName = `huddle-${Date.now()}.${ext}`;
        const saved = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });

        await Share.share({
          files: [saved.uri],
        });
      } catch (err) {
        // 失敗時は従来のURL共有にフォールバック
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

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4 overflow-hidden"
      onClick={onClose}
    >
      {/* 上部ボタン群 */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-12 h-12 rounded-full bg-black/60 border border-white/30 hover:bg-black/80 flex items-center justify-center transition-colors shadow-lg disabled:opacity-50"
          aria-label="保存"
        >
          {saving ? (
            <svg className="w-5 h-5 text-white animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" strokeOpacity="0.3" />
              <path strokeLinecap="round" d="M21 12a9 9 0 00-9-9" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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
          className="w-12 h-12 rounded-full bg-black/60 border border-white/30 hover:bg-black/80 flex items-center justify-center transition-colors shadow-lg"
          aria-label="閉じる"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 画像本体 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
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
        className="max-w-full max-h-full object-contain rounded-lg select-none"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: gestureRef.current.mode === "idle" ? "transform 0.15s ease-out" : "none",
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      />
    </div>
  );
}
