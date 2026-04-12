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

// --- 画像URL判定 & PNGバイト取得 ---------------------------------------------

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;
function isImageUrl(content: string): boolean {
  const trimmed = content.trim();
  if (!/^https?:\/\//.test(trimmed)) return false;
  return IMAGE_EXT_RE.test(trimmed);
}

type LoadedImage = {
  pngBytes: Uint8Array;
  width: number;
  height: number;
};

// URL で指定された画像を HTMLImageElement 経由で読み込み、canvas で PNGに再エンコードする。
// これにより png/jpg/webp/gif/svg 等どのフォーマットでも一律 pdf-lib の embedPng に渡せる。
async function loadImageAsPng(url: string): Promise<LoadedImage> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`image load failed: ${url}`));
    el.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(img, 0, 0);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))), "image/png");
  });
  const buf = await blob.arrayBuffer();
  return {
    pngBytes: new Uint8Array(buf),
    width: canvas.width,
    height: canvas.height,
  };
}

// --- 決定事項型 --------------------------------------------------------------

export type DecisionForPdf = {
  id: string;
  content: string;
  created_at: string;
  channel_name: string;
  sender_name: string;
  decision_why: string | null;
  decision_due: string | null;
};

type ExportContext = {
  workspaceName: string;
  selectedChannelName: string | null;
  rangeLabel?: string | null;
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

  // NOTE: pdf-lib の subset エンコーダーは一部 CJK フォントで文字を取りこぼす。
  // 特に BIZ UDPGothic のような DSIG / 複雑な OpenType テーブルを持つフォントで
  // 顕著（2026-04-11 に「rk」「H ddl」のような文字列のフラグメント化を確認）。
  // subset: false で全グリフ埋め込みにするとファイルサイズは大きくなるが確実に動く。
  const fontJp = await doc.embedFont(regularBytes, { subset: false });
  const fontJpBold = await doc.embedFont(boldBytes, { subset: false });
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
    `期間: ${ctx.rangeLabel ?? "全期間"}`,
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

  // 画像決定を先に並列で読み込む（pdf-lib の embedPng は非同期なので後で順序通り使う）
  const imageCache = new Map<string, LoadedImage>();
  const imagePromises: Promise<void>[] = [];
  for (const d of ctx.decisions) {
    if (isImageUrl(d.content)) {
      imagePromises.push(
        loadImageAsPng(d.content)
          .then((img) => {
            imageCache.set(d.id, img);
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn("[pdf-export] image load failed:", d.content, err);
            // 失敗した画像決定はテキスト(URL)として残る
          })
      );
    }
  }
  await Promise.all(imagePromises);

  let idx = 0;
  for (const d of ctx.decisions) {
    idx += 1;

    const isImage = isImageUrl(d.content);
    const loadedImage = isImage ? imageCache.get(d.id) : undefined;

    // レイアウト見積もり
    const MAX_IMAGE_H = 260; // 画像決定の最大高（A4中盤に1つ載る程度）
    const ANNOTATION_SIZE = 10; // Why / Due の本文サイズ
    const ANNOTATION_GAP = 4;
    const ANNOTATION_LABEL_W = 36; // "WHY" / "DUE" ラベル幅
    const ANNOTATION_BODY_W = BODY_W - ANNOTATION_LABEL_W;

    let bodyHeight = 0;
    let bodyLines: string[] = [];
    let imageDisplayW = 0;
    let imageDisplayH = 0;

    if (loadedImage) {
      const scaleW = BODY_W / loadedImage.width;
      const scaleH = MAX_IMAGE_H / loadedImage.height;
      const scale = Math.min(scaleW, scaleH, 1);
      imageDisplayW = loadedImage.width * scale;
      imageDisplayH = loadedImage.height * scale;
      bodyHeight = imageDisplayH;
    } else {
      bodyLines = wrapText(d.content, fontJp, BODY_SIZE, BODY_W);
      bodyHeight =
        bodyLines.length * (BODY_SIZE + BODY_LINE_GAP) - BODY_LINE_GAP;
    }

    // Why / Due の事前折り返しと高さ計算
    const whyLines = d.decision_why
      ? wrapText(d.decision_why, fontJp, ANNOTATION_SIZE, ANNOTATION_BODY_W)
      : [];
    const dueLines = d.decision_due
      ? wrapText(d.decision_due, fontJp, ANNOTATION_SIZE, ANNOTATION_BODY_W)
      : [];
    const annotationHeight =
      (whyLines.length + dueLines.length) *
        (ANNOTATION_SIZE + ANNOTATION_GAP) +
      (whyLines.length > 0 || dueLines.length > 0 ? 8 /* 区切り線 */ : 0);

    const needed =
      12 /* 区切り線とパディング */ +
      META_SIZE +
      8 +
      bodyHeight +
      annotationHeight +
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

    if (loadedImage) {
      // 画像を埋め込み
      const embedded = await doc.embedPng(loadedImage.pngBytes);
      page.drawImage(embedded, {
        x: BODY_L,
        y: cursorY - imageDisplayH,
        width: imageDisplayW,
        height: imageDisplayH,
      });
      cursorY -= imageDisplayH;
    } else {
      // 本文テキスト
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
    }

    // Why / Due セクション
    if (whyLines.length > 0 || dueLines.length > 0) {
      cursorY -= 6;
      // 区切り線（薄い）
      page.drawLine({
        start: { x: BODY_L, y: cursorY },
        end: { x: PAGE_W - MARGIN_R, y: cursorY },
        thickness: 0.4,
        color: rgb(0.85, 0.85, 0.88),
      });
      cursorY -= 8;

      const drawAnnotation = (label: string, lines: string[]) => {
        if (lines.length === 0) return;
        let first = true;
        for (const line of lines) {
          ensureSpace(ANNOTATION_SIZE + ANNOTATION_GAP);
          if (first) {
            page.drawText(label, {
              x: BODY_L,
              y: cursorY - ANNOTATION_SIZE,
              size: ANNOTATION_SIZE - 1,
              font: fontJpBold,
              color: COLOR_MUTED,
            });
            first = false;
          }
          page.drawText(line, {
            x: BODY_L + ANNOTATION_LABEL_W,
            y: cursorY - ANNOTATION_SIZE,
            size: ANNOTATION_SIZE,
            font: fontJp,
            color: COLOR_INK,
          });
          cursorY -= ANNOTATION_SIZE + ANNOTATION_GAP;
        }
      };

      drawAnnotation("WHY", whyLines);
      drawAnnotation("DUE", dueLines);
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
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: "application/pdf",
  });

  const { Capacitor } = await import("@capacitor/core");
  const isNative = Capacitor.isNativePlatform();

  // [Path A] Capacitor ネイティブ + Filesystem/Share プラグインが両方存在するビルド
  // これが本命ルート。次回TestFlightビルド以降はここに乗る。
  if (
    isNative &&
    Capacitor.isPluginAvailable("Filesystem") &&
    Capacitor.isPluginAvailable("Share")
  ) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");

      // Uint8Array -> base64
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[pdf-export] native save failed, falling back:", err);
      // ↓ フォールバックへ
    }
  }

  // [Path B] Web Share API (Level 2) で File を渡す。
  // iOS Capacitor の古いビルドでのみ使用（ネイティブプラグイン未登録時のフォールバック）。
  // macOS Safari/Chrome もnavigator.shareをサポートするが、デスクトップでは共有シートより
  // ファイルダウンロード（Path C）の方がユーザー体験が良いため、モバイル限定。
  const isMobileDevice =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobileDevice) {
    try {
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: {
          files?: File[];
          title?: string;
          text?: string;
        }) => Promise<void>;
      };
      if (typeof nav.share === "function") {
        const file = new File([blob], filename, { type: "application/pdf" });
        if (!nav.canShare || nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: filename });
          return;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      // eslint-disable-next-line no-console
      console.warn("[pdf-export] web share failed, falling back:", err);
    }
  }

  // [Path C] 最後の手段: Blob URL から <a download> で保存。
  // デスクトップブラウザはここに到達。
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // iOS WebView で download 属性が効かない場合に備えて target も付ける
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
