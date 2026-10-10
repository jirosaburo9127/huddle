// 予定・アルバムを作ったときにアプリが自動で投稿する本文には、目印として
// 「📅」「📍」「📸」が入っている（DB の関数や みかん も同じ書式で本文を書き換える）。
// 保存されている本文は変えず、表示するときだけ線画アイコンに差し替える。
// 過去の投稿にもそのまま効く。
//
// 対象は「📅」か「📸」で始まる投稿（＝アプリが作った本文）だけ。
// ユーザーが自分で本文中に書いた絵文字には触れない。
import { UI_ICON_PATHS, type UiIconName } from "@/components/ui-icon";

const MARKS: Array<{ emoji: string; icon: UiIconName }> = [
  { emoji: "📅", icon: "calendar" },
  { emoji: "📍", icon: "pin" },
  { emoji: "📸", icon: "camera" },
];

/** アプリが自動で作った本文（予定・アルバムの投稿）かどうか */
export function isSystemPost(content: string): boolean {
  const head = content.trimStart();
  return head.startsWith("📅") || head.startsWith("📸");
}

/** 行頭の目印絵文字が何のアイコンに当たるかを返す（該当しなければ null） */
export function leadingSystemIcon(line: string): { icon: UiIconName; rest: string } | null {
  for (const mark of MARKS) {
    if (line.startsWith(mark.emoji)) {
      return { icon: mark.icon, rest: line.slice(mark.emoji.length).replace(/^️?\s*/, "") };
    }
  }
  return null;
}

function iconHtml(icon: UiIconName): string {
  return (
    `<svg class="inline-block align-[-2px] mr-1 opacity-70" width="15" height="15" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${UI_ICON_PATHS[icon]}"/></svg>`
  );
}

/** HTML 化済みの本文向け: 行頭の目印絵文字を線画アイコンの SVG に差し替える */
export function replaceSystemEmojiInHtml(originalContent: string, html: string): string {
  if (!isSystemPost(originalContent)) return html;
  let out = html;
  for (const mark of MARKS) {
    // 行頭（文字列の先頭・改行・<br> の直後）にあるものだけ
    out = out.replace(
      new RegExp(`(^|\\n|<br\\s*/?>)(\\s*)${mark.emoji}\\uFE0F?\\s*`, "g"),
      (_m, lead: string, space: string) => `${lead}${space}${iconHtml(mark.icon)}`
    );
  }
  return out;
}

/** 1行のプレビューなど文字だけの場所向け: 目印絵文字を取り除く */
export function stripSystemEmoji(content: string): string {
  if (!isSystemPost(content)) return content;
  let out = content;
  for (const mark of MARKS) {
    out = out.replace(new RegExp(`(^|\\n)(\\s*)${mark.emoji}\\uFE0F?\\s*`, "g"), "$1$2");
  }
  return out;
}
