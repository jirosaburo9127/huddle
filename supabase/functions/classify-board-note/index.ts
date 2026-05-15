// Supabase Edge Function: 付箋ノートのカテゴリ自動分類
//
// board_notes テーブルへの INSERT をトリガーに呼ばれる。
// 同一ボードの既存カテゴリ一覧を参照し、Claude Haiku APIで
// 適切なカテゴリを判定して board_notes.category を UPDATE する。
//
// 環境変数:
//   ANTHROPIC_API_KEY        : Anthropic Console で発行する API キー
//   SUPABASE_URL             : 自動設定
//   SUPABASE_SERVICE_ROLE_KEY: 自動設定（RLSバイパスで category を更新）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface NoteRecord {
  id: string;
  board_id: string;
  content: string;
}

Deno.serve(async (req) => {
  try {
    const { record } = (await req.json()) as { record?: NoteRecord };
    if (!record?.id || !record?.board_id || !record?.content) {
      return new Response(JSON.stringify({ skipped: "invalid payload" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 同一ボードの既存カテゴリ一覧を取得
    const { data: existing } = await supabase
      .from("board_notes")
      .select("category")
      .eq("board_id", record.board_id)
      .not("category", "is", null);

    const existingCategories = [
      ...new Set((existing || []).map((r: { category: string }) => r.category)),
    ];

    // Claude Haiku APIでカテゴリを分類
    const systemPrompt = existingCategories.length > 0
      ? `あなたは付箋のカテゴリ分類担当です。ユーザーが投稿した付箋の内容を読んで、最適なカテゴリ名を1つだけ返してください。

既存カテゴリ: ${existingCategories.join("、")}

ルール:
- 既存カテゴリに該当するものがあれば、そのカテゴリ名をそのまま返してください
- 該当するものがなければ、新しいカテゴリ名を短く（2〜4文字程度）作ってください
- カテゴリ名だけを返してください。説明は不要です`
      : `あなたは付箋のカテゴリ分類担当です。ユーザーが投稿した付箋の内容を読んで、最適なカテゴリ名を1つだけ返してください。

ルール:
- カテゴリ名は短く（2〜4文字程度）してください
- カテゴリ名だけを返してください。説明は不要です
- 例: 企画、課題、改善、提案、質問、アイディア、要望、感想`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 30,
        system: systemPrompt,
        messages: [{ role: "user", content: record.content }],
      }),
    });

    if (!response.ok) {
      console.error("Claude API error:", response.status, await response.text());
      return new Response(JSON.stringify({ error: "Claude API failed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const result = await response.json();
    const category = (result.content?.[0]?.text || "").trim().split("\n")[0].trim();

    if (!category) {
      return new Response(JSON.stringify({ skipped: "empty category" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // board_notes.category を更新（service_roleでRLSバイパス）
    const { error } = await supabase
      .from("board_notes")
      .update({ category })
      .eq("id", record.id);

    if (error) {
      console.error("Update failed:", error);
      return new Response(JSON.stringify({ error: "update failed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ classified: category, noteId: record.id }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error("classify-board-note error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
