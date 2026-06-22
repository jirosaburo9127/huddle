// Edge Function: チャンネルの会話からマインドマップを自動生成

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "claude-haiku-4-5-20251001";

Deno.serve(async (req) => {
  try {
    // Authorization ヘッダーからユーザーを認証
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabaseUser.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (!user) return new Response("unauthorized", { status: 401 });

    const { channel_id, channel_name } = await req.json();
    if (!channel_id) return new Response("channel_id required", { status: 400 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // チャンネルメンバーか確認
    const { data: membership } = await supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channel_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return new Response("not a member", { status: 403 });

    // 直近100件のメッセージ取得
    const { data: messages } = await supabase
      .from("messages")
      .select("content, created_at, profiles(display_name)")
      .eq("channel_id", channel_id)
      .is("deleted_at", null)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!messages || messages.length === 0) {
      return Response.json({ nodes: [{ id: "root", label: channel_name || "チャンネル", parent: null, color: null }] });
    }

    const messagesText = (messages as Array<{ content: string; created_at: string; profiles: { display_name: string } | null }>)
      .reverse()
      .map((m) => `${m.profiles?.display_name || "?"}: ${m.content}`)
      .join("\n");

    // Claude APIでマインドマップ構造を生成
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: `あなたはチャット会話をマインドマップ構造に変換するAIです。
以下のJSON配列形式で出力してください。他のテキストは一切含めないでください。

[
  { "id": "root", "label": "チャンネル名", "parent": null, "color": null },
  { "id": "n1", "label": "トピック1", "parent": "root", "color": null },
  { "id": "n1-1", "label": "サブトピック", "parent": "n1", "color": null }
]

ルール:
- ルートノードのlabelはチャンネル名にする
- 主要トピックはルートの子にする
- サブトピック・詳細はその子にする
- 決定事項のcolorは "#22C55E"
- 未解決・課題のcolorは "#F59E0B"
- 重要・緊急のcolorは "#EF4444"
- 通常のノードのcolorは null
- idは "root", "n1", "n1-1", "n2", "n2-1" のように付ける
- 最大30ノード程度に収める
- 必ず有効なJSON配列のみを出力すること`,
        messages: [
          { role: "user", content: `チャンネル名: ${channel_name || "チャンネル"}\n\n会話内容:\n${messagesText}` },
        ],
      }),
    });

    if (!aiRes.ok) {
      console.error("[generate-mindmap] AI failed:", aiRes.status);
      return new Response("AI generation failed", { status: 500 });
    }

    const aiJson = await aiRes.json() as { content: Array<{ type: string; text?: string }> };
    const rawText = aiJson.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("")
      .trim();

    // JSONを抽出（```json ... ``` で囲まれている場合も対応）
    let nodesJson: string;
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      nodesJson = codeBlockMatch[1].trim();
    } else {
      nodesJson = rawText;
    }

    let nodes;
    try {
      nodes = JSON.parse(nodesJson);
    } catch {
      console.error("[generate-mindmap] JSON parse failed:", nodesJson.slice(0, 200));
      // フォールバック: ルートノードのみ
      nodes = [{ id: "root", label: channel_name || "チャンネル", parent: null, color: null }];
    }

    // DBに保存（upsert）
    await supabase.from("mindmaps").upsert({
      channel_id,
      nodes,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "channel_id" });

    return Response.json({ nodes });
  } catch (e) {
    console.error("[generate-mindmap] error:", e);
    return new Response("error", { status: 500 });
  }
});
