// アップロード時に URL 末尾に #name=<encoded> を付けて元のファイル名を保持する。
// Supabase Storage のオブジェクトキーは非ASCIIが使えないため、ストレージ側は
// サニタイズ済みの名前で保存しているが、表示だけは元の名前を出したい。
// フラグメント (#) はサーバに送信されないのでストレージ取得には影響しない。

export function appendOriginalFileNameToUrl(url: string, originalName: string): string {
  if (!originalName) return url;
  return `${url}#name=${encodeURIComponent(originalName)}`;
}

// URL から表示用ファイル名を取り出す。
// 優先度:
// 1. #name=<encoded> フラグメント (新しいアップロード)
// 2. パス末尾の `{uuid}-{name}` から name 部分 (旧アップロード)
// 3. パス末尾 そのまま
export function extractDisplayFileName(url: string): string {
  try {
    const hashIdx = url.indexOf("#");
    if (hashIdx >= 0) {
      const frag = url.slice(hashIdx + 1);
      const params = new URLSearchParams(frag);
      const name = params.get("name");
      if (name) return name;
    }
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/");
    const last = segments[segments.length - 1];
    const match = last.match(/^[0-9a-f-]+-(.+)$/);
    return match ? decodeURIComponent(match[1]) : decodeURIComponent(last);
  } catch {
    return "ファイル";
  }
}
