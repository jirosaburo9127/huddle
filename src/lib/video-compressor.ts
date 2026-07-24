import { Capacitor } from "@capacitor/core";

// このアプリのネイティブ機能は AppDelegate の WKScriptMessageHandler 方式で提供される
// （標準のCapacitorプラグイン自動登録はアプリ直下クラスでは効かないため）。
// compressVideo: 動画ピッカーを開き、選んだ動画を 1080p/H.264/MP4 に圧縮して
// window.webkit.messageHandlers.compressVideo.postMessage({requestId}) で起動、
// 結果は CustomEvent('huddle:nativeVideoCompress') {requestId, paths[], error} で返る。

interface CompressEventDetail {
  requestId: string;
  paths?: string[];
  error?: string;
}

interface WebkitBridge {
  webkit?: { messageHandlers?: { compressVideo?: { postMessage: (msg: unknown) => void } } };
}

function getHandler() {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as WebkitBridge).webkit?.messageHandlers?.compressVideo;
}

/**
 * ネイティブ動画圧縮が使えるか（iOSアプリ かつ compressVideo ハンドラ同梱ビルド）。
 * 未同梱の旧ビルドでは false になり、圧縮ボタンは出さない。
 */
export function isNativeVideoCompressAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "ios" &&
    !!getHandler()
  );
}

/**
 * ネイティブ動画ピッカーを開き、選択された動画を圧縮した File 配列を返す。
 * キャンセル時は空配列。
 */
export async function pickAndCompressVideos(): Promise<File[]> {
  const handler = getHandler();
  if (!handler) throw new Error("compressVideo handler が利用できません");

  const requestId = `vc_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const paths: string[] = await new Promise<string[]>((resolve, reject) => {
    const onResult = (e: Event) => {
      const detail = (e as CustomEvent<CompressEventDetail>).detail;
      if (!detail || detail.requestId !== requestId) return;
      window.removeEventListener("huddle:nativeVideoCompress", onResult);
      if (detail.error && detail.error !== "cancelled") {
        reject(new Error(detail.error));
        return;
      }
      resolve(detail.paths || []);
    };
    window.addEventListener("huddle:nativeVideoCompress", onResult);
    handler.postMessage({ requestId });
  });

  try { window.alert(`【診断v4】paths=${paths.length}\n${paths[0] || "(なし)"}`); } catch { /* noop */ }

  // 圧縮済みファイルを Filesystem 経由で読む。
  // convertFileSrc + fetch は WKWebView のクロススキーム/CSP(connect-src)で "Load failed" に
  // なるため、Capacitor ブリッジ経由の Filesystem.readFile を使う（CSP非依存）。
  const { Filesystem } = await import("@capacitor/filesystem");
  const files: File[] = [];
  for (const p of paths) {
    const readPath = p.startsWith("file://") ? p : `file://${p}`;
    let res: { data: string | Blob };
    try {
      res = await Filesystem.readFile({ path: readPath });
    } catch (e) {
      try { window.alert(`【診断v4】readFile失敗\n${e instanceof Error ? e.message : String(e)}`); } catch { /* noop */ }
      throw e;
    }
    const base64 = typeof res.data === "string" ? res.data : "";
    try { window.alert(`【診断v4】readOK data型=${typeof res.data} base64長=${base64.length}`); } catch { /* noop */ }
    // base64 -> Uint8Array
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const name = `video_${Math.random().toString(36).slice(2)}.mp4`;
    files.push(new File([bytes], name, { type: "video/mp4" }));
  }
  try { window.alert(`【診断v4】files=${files.length} size=${Math.round((files[0]?.size ?? 0) / 1024 / 1024)}MB`); } catch { /* noop */ }
  return files;
}

/** 単数版（チャット投稿用）。キャンセルは null。 */
export async function pickAndCompressVideo(): Promise<File | null> {
  const files = await pickAndCompressVideos();
  return files[0] ?? null;
}
