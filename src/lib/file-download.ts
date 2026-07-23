import { Capacitor } from "@capacitor/core";
import { stripFileUrlFragment } from "@/lib/file-name";

/**
 * 元のファイル名を保った状態でファイルをダウンロード/保存する。
 * - Web: Supabase の `?download=<name>` で Content-Disposition を吐かせ、元の名前で保存させる。
 * - ネイティブ(iOS): 取得→Cacheに元名で書き込み→共有シート（「ファイルに保存」等で元名のまま保存）。
 */
export async function downloadFileWithName(url: string, name: string): Promise<void> {
  const base = stripFileUrlFragment(url);
  const safeName = name && name !== "ファイル" ? name : "file";

  const isNative = Capacitor.isNativePlatform();

  // [ネイティブ] 端末に保存して共有シート
  if (
    isNative &&
    Capacitor.isPluginAvailable("Filesystem") &&
    Capacitor.isPluginAvailable("Share")
  ) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const res = await fetch(base);
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);
      const written = await Filesystem.writeFile({
        path: safeName,
        data: base64,
        directory: Directory.Cache,
      });
      await Share.share({ title: safeName, url: written.uri, dialogTitle: safeName });
      return;
    } catch {
      // ↓ Web フォールバックへ
    }
  }

  // [Web] Content-Disposition 付きURLへリンク（サーバが元名を強制）
  const dlUrl = base + (base.includes("?") ? "&" : "?") + "download=" + encodeURIComponent(safeName);
  const a = document.createElement("a");
  a.href = dlUrl;
  a.download = safeName; // Content-Disposition が優先されるが一応付ける
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
