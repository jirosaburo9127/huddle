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

// プレーンテキスト系（text/*, application/json, application/xml, text/xml, text/csv）は
// マジックバイトが存在しないので内容検証を免除する。代わりに拡張子・MIME ホワイトリスト
// と実行ファイル拡張子ブロックに頼る。
const TEXT_LIKE_MIMES = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
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
