// 決定事項 PDF エクスポート
//
// 設計方針:
// - pdf-lib + fontkit でベクターPDFを生成（検索・コピー可能、軽量）
// - Noto Sans JP OTF (Regular + Bold) を jsdelivr CDN から取得して日本語描画
// - 初回フェッチのみ重い（約4.7MBx2）。以降はIndexedDBキャッシュで高速化
// - pdf-libの subset=true でPDFには使用グリフのみ埋め込み、出力ファイルは小さい
// - Web: Blob → download、iOS Capacitor: Filesystem書き込み + Share

import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

// --- フォント取得 ------------------------------------------------------------

// BIZ UDPGothic は日本語Universal Design フォントで業務文書に最適。
// google/fonts リポジトリは jsdelivr の size 制限に収まっており、Regular/Bold個別の
// TTFが配布されている（noto-cjk は巨大で jsdelivr からは 403 になる）。
const FONT_REGULAR_URL =
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/bizudpgothic/BIZUDPGothic-Regular.ttf";
const FONT_BOLD_URL =
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/bizudpgothic/BIZUDPGothic-Bold.ttf";

const DB_NAME = "huddle-pdf-cache";
const STORE_NAME = "fonts";
const DB_VERSION = 1;

function openFontDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedFont(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openFontDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () =>
        resolve((req.result as ArrayBuffer) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCachedFont(key: string, buf: ArrayBuffer): Promise<void> {
  try {
    const db = await openFontDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(buf, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // キャッシュ失敗してもPDF生成自体は続行できる
  }
}

async function fetchFont(url: string, cacheKey: string): Promise<ArrayBuffer> {
  const cached = await getCachedFont(cacheKey);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  void setCachedFont(cacheKey, buf);
  return buf;
}

// --- テキストレイアウト ------------------------------------------------------

// 指定フォント・フォントサイズで、幅 maxWidth に収まる位置で折り返す。
// 英語単語はスペース・約物で切り、日本語は任意文字位置で切れる。
function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (!para) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const ch of Array.from(para)) {
      const candidate = current + ch;
      const w = font.widthOfTextAtSize(candidate, fontSize);
      if (w > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) lines.push(current);
  }
  return lines;
}

// --- 決定事項型 --------------------------------------------------------------

export type DecisionForPdf = {
  id: string;
  content: string;
  created_at: string;
  channel_name: string;
  sender_name: string;
};

type ExportContext = {
  workspaceName: string;
  selectedChannelName: string | null;
  decisions: DecisionForPdf[];
};

// --- PDF 生成本体 ------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

export async function generateDecisionsPdf(
  ctx: ExportContext
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // フォントを並列取得
  const [regularBytes, boldBytes] = await Promise.all([
    fetchFont(FONT_REGULAR_URL, "BIZUDPGothic-Regular.ttf"),
    fetchFont(FONT_BOLD_URL, "BIZUDPGothic-Bold.ttf"),
  ]);

  // subset=true で実際に使われたグリフだけPDFに埋める → 出力サイズ最小化
  const fontJp = await doc.embedFont(regularBytes, { subset: true });
  const fontJpBold = await doc.embedFont(boldBytes, { subset: true });
  // Fallback: ベースラインでStandardFontを参照する必要はないが、pdf-lib のAPI噛ませ用
  void StandardFonts.Helvetica;

  // A4 = 595.28 x 841.89 pt
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN_L = 54;
  const MARGIN_R = 54;
  const MARGIN_T = 64;
  const MARGIN_B = 56;
  const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
  const NUMBER_COL_W = 34; // 番号(01,02,...) 専用の左カラム
  const BODY_L = MARGIN_L + NUMBER_COL_W;
  const BODY_W = CONTENT_W - NUMBER_COL_W;

  const COLOR_INK = rgb(0.067, 0.067, 0.067); // #111
  const COLOR_MUTED = rgb(0.4, 0.4, 0.42);
  const COLOR_RULE = rgb(0.88, 0.88, 0.9);
  const COLOR_RULE_STRONG = rgb(0.067, 0.067, 0.067);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let cursorY = PAGE_H - MARGIN_T;

  // --- タイトルブロック ---
  const titleText = `${ctx.workspaceName} — 決定事項`;
  page.drawText(titleText, {
    x: MARGIN_L,
    y: cursorY - 22,
    size: 22,
    font: fontJpBold,
    color: COLOR_INK,
  });
  cursorY -= 30;

  const metaText = [
    ctx.selectedChannelName ? `対象: #${ctx.selectedChannelName}` : "対象: 全チャンネル",
    `${ctx.decisions.length}件`,
    `出力日: ${new Date().toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`,
  ].join("    ");
  page.drawText(metaText, {
    x: MARGIN_L,
    y: cursorY - 12,
    size: 9.5,
    font: fontJp,
    color: COLOR_MUTED,
  });
  cursorY -= 22;

  // タイトル下の太めの区切り線
  page.drawLine({
    start: { x: MARGIN_L, y: cursorY },
    end: { x: PAGE_W - MARGIN_R, y: cursorY },
    thickness: 1.6,
    color: COLOR_RULE_STRONG,
  });
  cursorY -= 18;

  // --- 決定事項ループ ---
  const NUMBER_SIZE = 14;
  const META_SIZE = 9;
  const BODY_SIZE = 11.5;
  const BODY_LINE_GAP = 5; // lineHeight = size + gap

  const ensureSpace = (needed: number) => {
    if (cursorY - needed < MARGIN_B) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      cursorY = PAGE_H - MARGIN_T;
    }
  };

  let idx = 0;
  for (const d of ctx.decisions) {
    idx += 1;

    // 事前にメタ行と本文の必要高さを見積もって、分割するくらいなら新ページに送る
    const bodyLines = wrapText(d.content, fontJp, BODY_SIZE, BODY_W);
    const bodyHeight =
      bodyLines.length * (BODY_SIZE + BODY_LINE_GAP) - BODY_LINE_GAP;
    const needed =
      12 /* 区切り線とパディング */ +
      META_SIZE +
      8 +
      bodyHeight +
      16; /* 下パディング */
    ensureSpace(needed);

    // 項目間の区切り線（最初の項目は描かない）
    if (idx > 1) {
      page.drawLine({
        start: { x: MARGIN_L, y: cursorY + 6 },
        end: { x: PAGE_W - MARGIN_R, y: cursorY + 6 },
        thickness: 0.6,
        color: COLOR_RULE,
      });
    }

    // 番号
    const numStr = String(idx).padStart(2, "0");
    page.drawText(numStr, {
      x: MARGIN_L,
      y: cursorY - NUMBER_SIZE,
      size: NUMBER_SIZE,
      font: fontJpBold,
      color: rgb(0.6, 0.6, 0.62),
    });

    // メタ行: #channel_name 太字、投稿者と日時はmuted
    const channelLabel = `#${d.channel_name}`;
    const channelW = fontJpBold.widthOfTextAtSize(channelLabel, META_SIZE + 1);
    page.drawText(channelLabel, {
      x: BODY_L,
      y: cursorY - META_SIZE - 2,
      size: META_SIZE + 1,
      font: fontJpBold,
      color: COLOR_INK,
    });
    const restMeta = `    ${d.sender_name}    ${formatDate(d.created_at)}`;
    page.drawText(restMeta, {
      x: BODY_L + channelW,
      y: cursorY - META_SIZE - 2,
      size: META_SIZE,
      font: fontJp,
      color: COLOR_MUTED,
    });
    cursorY -= META_SIZE + 12;

    // 本文
    for (const line of bodyLines) {
      ensureSpace(BODY_SIZE + BODY_LINE_GAP);
      page.drawText(line, {
        x: BODY_L,
        y: cursorY - BODY_SIZE,
        size: BODY_SIZE,
        font: fontJp,
        color: COLOR_INK,
      });
      cursorY -= BODY_SIZE + BODY_LINE_GAP;
    }
    cursorY -= 14; // 次項目との間隔
  }

  // フッター（各ページ右下にページ番号を後付け）
  const totalPages = doc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const p = doc.getPage(i);
    const label = `${i + 1} / ${totalPages}`;
    const lw = fontJp.widthOfTextAtSize(label, 9);
    p.drawText(label, {
      x: PAGE_W - MARGIN_R - lw,
      y: 28,
      size: 9,
      font: fontJp,
      color: COLOR_MUTED,
    });
    p.drawText("Huddle — Decision Record", {
      x: MARGIN_L,
      y: 28,
      size: 9,
      font: fontJp,
      color: COLOR_MUTED,
    });
  }

  return await doc.save();
}

// --- プラットフォーム別 保存/共有 -------------------------------------------

export async function savePdf(
  bytes: Uint8Array,
  filename: string
): Promise<void> {
  // Capacitor（ネイティブiOS/Android）判定は動的import で Web実行時のbundle増加を避ける
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");

    // Uint8Array -> base64
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, i + chunkSize)
      );
    }
    const base64 = btoa(binary);

    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: filename,
      url: written.uri,
      dialogTitle: "決定事項PDFを共有",
    });
    return;
  }

  // Web: Blob -> ダウンロード
  // Uint8Array を Blob に入れるとき、Uint8Array<ArrayBufferLike> の型を BlobPart に合わせるため一度 slice する
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
