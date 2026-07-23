import { registerPlugin, Capacitor } from "@capacitor/core";

// ネイティブ側 VideoCompressorPlugin.swift の戻り値
interface CompressResult {
  path: string; // 圧縮後ファイルのネイティブパス
  size: number; // バイト
  duration: number; // 秒
  name: string; // ファイル名（video_xxxx.mp4）
}

interface VideoCompressorPlugin {
  // 動画を1本選ばせて 1080p / H.264 / MP4 に圧縮し、そのパスを返す
  pickAndCompress(): Promise<CompressResult>;
}

const VideoCompressor = registerPlugin<VideoCompressorPlugin>("VideoCompressor");

/**
 * ネイティブ動画圧縮が使えるか（iOSアプリ かつ プラグインが同梱されたビルド）。
 * ボタンの出し分けに使う。新プラグイン未同梱の旧ビルドでは false になり、ボタンは出さない。
 */
export function isNativeVideoCompressAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "ios" &&
    Capacitor.isPluginAvailable("VideoCompressor")
  );
}

/**
 * ネイティブの動画ピッカーを開き、選択された動画を圧縮した File を返す。
 * ユーザーがキャンセルした場合は null。
 */
export async function pickAndCompressVideo(): Promise<File | null> {
  let res: CompressResult;
  try {
    res = await VideoCompressor.pickAndCompress();
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    if (msg.includes("cancelled")) return null; // キャンセルは正常系
    throw e;
  }

  // ネイティブの一時ファイルを base64 を介さず Blob 化（大容量でもメモリ効率が良い）
  const src = Capacitor.convertFileSrc(res.path);
  const blob = await fetch(src).then((r) => r.blob());
  return new File([blob], res.name || "video.mp4", { type: "video/mp4" });
}
