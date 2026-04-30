<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:sync-anti-pattern -->
# CRITICAL: クライアント蓄積型 state の同期処理は「期間ベースで全件再取得」せよ

## 禁止パターン（過去にメッセージ消失事故を起こした）

クライアント側に蓄積される state（`messages`, `notifications`, `posts` 等）に対して、
サーバ最新分を取得してマージする処理で **以下の組み合わせは絶対に書かない**:

```ts
// ❌ 絶対禁止: 「最新N件取得 + ID重複排除マージ」
const { data } = await supabase
  .from("messages")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(50);                                      // ← 最新側固定で取得
setMessages((prev) => {
  const ids = new Set(prev.map((m) => m.id));
  return [...prev, ...data.filter((m) => !ids.has(m.id))];  // ← ID merge
});
```

## なぜ禁止か

ユーザーが PC ブラウザを開きっぱなしにしてバックグラウンド放置 → その間に他者が
50件超投稿 → 復帰時 `limit(50)` だと「最新50件 = 復帰直前の数日分」しか取らず、
**ローカルに残っている古い分** と **サーバから新しく取った分** の間に欠損が発生する。
ID 重複排除では既存ID以外を追加するだけなので、**中間期間が永久に埋まらない**。

実害事例: 2026-04-30 Huddle で 4/22 までの local state を持つ PC が 4/26 復帰 →
4/23〜25 の 84 件投稿が消えたように見える事象が発生。

## 正しいパターン

期間ベースで毎回全件再取得し ID で重複排除する。`src/lib/sync-fetcher.ts` の
`fetchSincePeriod` を使えば自然と正解になる:

```ts
import { fetchSincePeriod } from "@/lib/sync-fetcher";

const fresh = await fetchSincePeriod({
  supabase,
  table: "messages",
  select: "*, profiles(*), reactions(*)",
  channelId: channel.id,
  sinceDays: 7,        // 直近1週間を毎回フル取得
});
setMessages((prev) => mergeById(prev, fresh));
```

## 触るときのチェックリスト

新規/既存の同期処理に手を入れる前に必ず確認:

- [ ] `.limit(N)` で「最新側から N件」取得していないか？（`order desc` + `limit`）
- [ ] 取得結果をクライアント蓄積型 state に **既存とマージ** していないか？
- [ ] ローカルにない「中間期間」が補完できる構造になっているか？
- [ ] 同じ期間を再取得しても二重表示にならないよう ID で重複排除しているか？

**該当しないケース（OK）**:
- ページマウント毎にゼロから再取得して描画する（dashboard, files など）
- 「もっと古いメッセージを読み込む」のような **境界より厳密に古い側** だけ取る pagination（`.lt("created_at", oldest)`）
- 検索結果・1件だけ取る・DM一覧の最新1件など、**蓄積マージしない**用途の `.limit()`
<!-- END:sync-anti-pattern -->
