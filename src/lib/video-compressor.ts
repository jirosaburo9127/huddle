import { Capacitor } from "@capacitor/core";

// 動画圧縮は AppDelegate の WKScriptMessageHandler `compressVideo` で提供。
// 動画ピッカー→1080p/H.264圧縮→**ディスクから直接Supabaseへストリーミングアップロード**（URLSession）。
// 巨大ファイルもWKWebViewのメモリに載せずに送れる。結果は公開URL配列で返る。

interface CompressEventDetail {
  requestId: string;
  paths?: string[]; // upload指定時は公開URL配列
  error?: string;
}

interface WebkitBridge {
  webkit?: { messageHandlers?: { compressVideo?: { postMessage: (m: unknown) => void } } };
}

function getHandler() {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as WebkitBridge).webkit?.messageHandlers?.compressVideo;
}

/** ネイティブ動画圧縮が使えるか（iOSアプリ かつ compressVideo ハンドラ同梱ビルド）。 */
export function isNativeVideoCompressAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "ios" &&
    !!getHandler()
  );
}

export interface VideoUploadParams {
  supabaseUrl: string; // 例: https://xxx.supabase.co
  bucket: string; // 例: chat-files
  prefix: string; // 保存パスの接頭辞（channelId 等）
  token: string; // ユーザーのアクセストークン(JWT)
}

/**
 * 動画を選び、1080p圧縮してディスクから直接Supabaseへアップロードし、**公開URL配列**を返す。
 * JS側はファイルの中身を一切メモリに持たないため、巨大な動画でも安定して送れる。
 * キャンセル時は空配列。
 */
export async function pickCompressAndUploadVideos(params: VideoUploadParams): Promise<string[]> {
  const handler = getHandler();
  if (!handler) throw new Error("compressVideo handler が利用できません");

  const requestId = `vc_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const urls: string[] = await new Promise<string[]>((resolve, reject) => {
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
    handler.postMessage({
      requestId,
      upload: {
        url: params.supabaseUrl,
        bucket: params.bucket,
        prefix: params.prefix,
        token: params.token,
      },
    });
  });

  // アップロード対応ビルドのみ http(s) の公開URLが返る（旧ビルドはローカルパスなので除外）
  return urls.filter((u) => /^https?:\/\//.test(u));
}
