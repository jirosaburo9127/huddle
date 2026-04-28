"use client";

// 動画ファイルのサムネイル表示。
// canvas キャプチャは iOS WKWebView の crossOrigin/CORS 制約で失敗するため、
// シンプルに <video> タグでメディアフラグメント (#t=0.1) を使い、
// 0.1秒地点のフレームを「ポスター画像」のように表示させる。
// pointer-events: none で親要素のクリックを通すので、サムネ全体を
// クリッカブルなカードにできる。

type Props = {
  url: string;
  className?: string;
  /** 表示するフレームの秒数（既定 0.1） */
  captureAt?: number;
};

export function VideoThumbnail({ url, className, captureAt = 0.1 }: Props) {
  // メディアフラグメントで初期表示フレームを指定。
  // 既に "#" を含む URL（#name=... など）でも壊さないように追記の形で。
  const sep = url.includes("#") ? "&" : "#";
  const srcWithFragment = `${url}${sep}t=${captureAt}`;

  return (
    <video
      src={srcWithFragment}
      muted
      playsInline
      preload="metadata"
      className={className}
      style={{ pointerEvents: "none" }}
      onLoadedMetadata={(e) => {
        // メディアフラグメントが効かないブラウザの保険: 明示的に seek
        const v = e.currentTarget;
        if (v.currentTime === 0) {
          try {
            v.currentTime = captureAt;
          } catch {
            // 失敗時は無視（最初フレームのまま）
          }
        }
      }}
    />
  );
}
