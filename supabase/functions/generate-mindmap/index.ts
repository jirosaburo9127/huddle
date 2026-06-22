// Edge Function: チャンネルの会話からマインドマップを自動生成

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "no token" }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // service role client でトークンからユーザーを取得
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser(token);
    if (authErr || !user) {
      console.error("[generate-mindmap] auth failed:", authErr?.message);
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const body = await req.json();
    const channelId = body.channel_id as string;
    const channelName = (body.channel_name as string) || "チャンネル";
    if (!channelId) {
      return new Response(JSON.stringify({ error: "channel_id required" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // service role で DB 操作
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // メンバーシップ確認
    const { data: membership } = await supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "not a member" }), { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 直近100件のメッセージ取得
    const { data: messages, error: msgErr } = await supabase
      .from("messages")
      .select("content, created_at, profiles(display_name)")
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (msgErr) {
      console.error("[generate-mindmap] messages fetch error:", msgErr);
      return new Response(JSON.stringify({ error: "fetch failed" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (!messages || messages.length === 0) {
      const fallback = [{ id: "root", label: channelName, parent: null, color: null }];
      return new Response(JSON.stringify({ nodes: fallback }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
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
          { role: "user", content: `チャンネル名: ${channelName}\n\n会話内容:\n${messagesText}` },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[generate-mindmap] AI failed:", aiRes.status, errText);
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const aiJson = await aiRes.json() as { content: Array<{ type: string; text?: string }> };
    const rawText = aiJson.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("")
      .trim();

    // JSONを抽出
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
      if (!Array.isArray(nodes)) throw new Error("not array");
    } catch (e) {
      console.error("[generate-mindmap] JSON parse failed:", e, nodesJson.slice(0, 300));
      nodes = [{ id: "root", label: channelName, parent: null, color: null }];
    }

    // DBに保存（upsert）
    const { error: upsertErr } = await supabase.from("mindmaps").upsert({
      channel_id: channelId,
      nodes,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "channel_id" });

    if (upsertErr) {
      console.error("[generate-mindmap] upsert error:", upsertErr);
    }

    return new Response(JSON.stringify({ nodes }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (e) {
    console.error("[generate-mindmap] unexpected error:", e);
    return new Response(JSON.stringify({ error: "unexpected error" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
