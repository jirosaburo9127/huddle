# src/components/mobile-detail-transition.tsx (2026-05-13T23:03:44)

**種別**: ファイル全体


## 変更前 diff

```
"use client";

import { useMobileNavStore } from "@/stores/mobile-nav-store";

export function MobileDetailTransition() {
  const pendingDetailOpen = useMobileNavStore((s) => s.pendingDetailOpen);
  const title = useMobileNavStore((s) => s.detailTransitionTitle);

  if (!pendingDetailOpen) return null;

  return (
    <div className="mobile-detail-transition fixed inset-0 z-[60] bg-background lg:hidden">
      <div className="h-14 border-b border-border bg-header flex items-center px-4">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-muted text-lg leading-none">#</span>
          <span className="truncate text-base font-semibold text-foreground">
            {title || "チャンネル"}
          </span>
        </div>
      </div>
      <div className="flex-1 px-4 py-5 space-y-4">
        <div className="h-10 w-3/4 rounded-xl bg-border-subtle/70 animate-pulse" />
        <div className="h-16 rounded-2xl bg-border-subtle/50 animate-pulse" />
        <div className="h-12 w-5/6 rounded-2xl bg-border-subtle/45 animate-pulse" />
      </div>
    </div>
  );
}

```


## Codex レビュー

- [優先度: 今すぐ] ルートの `div` に `flex flex-col` がないため、子要素の `flex-1` が効いていません。`className="... bg-background lg:hidden flex flex-col"` にして、スケルトン領域が残り高さを取るようにしてください。

- [優先度: 後で] このオーバーレイは視覚的な遷移用に見えるため、スクリーンリーダーに読み上げさせる意図がなければルートに `aria-hidden="true"` を付けてください。読み上げ対象にするなら `role="status"` / `aria-live` などの設計が必要です。

- [優先度: 後で] テストがない場合は、`pendingDetailOpen=false` で `null`、`true` でタイトル表示、`title` 未設定時に `"チャンネル"` へフォールバックする最低限のレンダリングテストを追加してください。


## 影響分析 (Claude read-only)

- **何が変わるか**: モバイルでチャンネルを開いた瞬間に表示される「読み込み中の仮画面」のレイアウトを直します。中身の縦の伸び縮みが正しく効くようになり、スケルトン（灰色のプレースホルダー）が画面の残り高さをきれいに埋めて表示されます。
- **影響範囲**: `MobileDetailTransition` を grep したところ、参照しているのは sidebar-loader.tsx の1箇所だけで、画面遷移用の overlay として呼ばれているのみです。CSSクラス `mobile-detail-transition` は globals.css のアニメーション定義で使われていますが、今回の変更はクラス名を変えていないので影響しません。修正範囲はこのコンポーネント単体の見た目だけに収まります。
- **LEVEL**: 軽微
- **根拠**: 当コンポーネントは sidebar-loader から呼ばれるのみで、変更内容も内部レイアウト用のクラス追加に限られるため。


## ステータス

ユーザーが『スキップ』選択
