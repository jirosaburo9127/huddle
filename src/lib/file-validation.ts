// ファイル内容の整合性チェック（マジックバイト検証）
// クライアントが申告した MIME type だけでなく、ファイル先頭のバイトを読み、
// 拡張子や type を偽装した実行ファイル混入を阻止する。
// 本格的なウイルススキャンではないが、「exe を jpg にリネーム」レベルは確実に弾ける。

type MagicSignature = {
  mime: string;
  // バイト列の先頭から比較する。null はワイルドカード（任意バイト）
  signature: Array<number | null>;
  // 先頭からのオフセット（デフォルト 0）
  offset?: number;
};

const SIGNATURES: MagicSignature[] = [
  // JPEG (FF D8 FF)
  { mime: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  // PNG (89 50 4E 47 0D 0A 1A 0A)
  { mime: "image/png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // GIF (GIF87a / GIF89a)
  { mime: "image/gif", signature: [0x47, 0x49, 0x46, 0x38] },
  // WebP (RIFF....WEBP)
  { mime: "image/webp", signature: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
  // PDF (%PDF-)
  { mime: "application/pdf", signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // ZIP (PK\x03\x04) — MS Office .docx/.xlsx/.pptx もこの形式
  { mime: "application/zip", signature: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/x-zip-compressed", signature: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signature: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", signature: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", signature: [0x50, 0x4b, 0x03, 0x04] },
  // 古い MS Office (D0 CF 11 E0 A1 B1 1A E1)
  { mime: "application/msword", signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { mime: "application/vnd.ms-excel", signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { mime: "application/vnd.ms-powerpoint", signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
];

// マジックバイト検証を免除する MIME 集合。
//
// 含まれるもの:
//  1. プレーンテキスト系 (text/* / json / xml / yaml / markdown / kml / gpx 等)
//     → そもそもマジックバイトが存在しない
//  2. 音声系 / iWork / 圧縮 (RAR/7z/tar/gz) / 電子書籍 / HEIC/BMP/TIFF など
//     → SIGNATURES に登録しても良いが、Office (ZIP) と被ったり offset 計算が
//       入ったり整備コストが見合わないため検証免除。代わりに ALLOWED_MIME_TYPES
//       と BLOCKED_EXTENSIONS (.exe/.sh/.bat 等) で実害を防ぐ。
const TEXT_LIKE_MIMES = new Set([
  // プレーンテキスト
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
  "application/x-yaml",
  "text/yaml",
  "text/calendar",
  "application/vnd.google-earth.kml+xml",
  "application/gpx+xml",
  // 音声 (バリエーション豊富で SIGNATURES での厳格検証コストが見合わない)
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  // 画像系の追加分
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
  // Apple iWork (中身は ZIP だが既存 ZIP magic と完全に被るので個別検証しない)
  "application/vnd.apple.pages",
  "application/vnd.apple.numbers",
  "application/vnd.apple.keynote",
  // 圧縮の追加分
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
  // 電子書籍
  "application/epub+zip",
  "application/x-mobipocket-ebook",
]);

function matchesSignature(bytes: Uint8Array, sig: MagicSignature): boolean {
  const offset = sig.offset ?? 0;
  if (bytes.length < offset + sig.signature.length) return false;
  for (let i = 0; i < sig.signature.length; i++) {
    const expected = sig.signature[i];
    if (expected === null) continue;
    if (bytes[offset + i] !== expected) return false;
  }
  return true;
}

/**
 * ファイルの先頭バイトが申告された MIME type と一致するか検証する。
 * 一致しない場合は false を返し、呼び出し側でアップロードを拒否する。
 */
export async function verifyFileMagicBytes(
  file: File,
  declaredMime: string
): Promise<boolean> {
  // テキスト系はマジックバイト検証をスキップ
  if (TEXT_LIKE_MIMES.has(declaredMime)) return true;

  // 先頭 32 バイトだけ読めば判定できる（WebP は 12 バイト、その他は 8 バイト以下）
  const slice = file.slice(0, 32);
  const buffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 該当する署名のうち 1 つでも一致すれば OK
  const candidates = SIGNATURES.filter((s) => s.mime === declaredMime);
  if (candidates.length === 0) {
    // ホワイトリスト外 MIME → 既に MIME フィルタで弾かれているはずだが念のため拒否
    return false;
  }
  return candidates.some((s) => matchesSignature(bytes, s));
}
