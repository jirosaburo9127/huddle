"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// ワークスペース作成
export async function createWorkspace(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("未認証");

  const name = formData.get("name") as string;
  const asciiSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const slug = asciiSlug || `ws-${crypto.randomUUID().slice(0, 8)}`;

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .insert({ name, slug })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // 作成者をownerとして追加
  await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner",
  });

  // #general チャンネルを自動作成（作成者を自動でメンバー追加）
  // NOTE: 012以降 channels_select が招待制になったため、普通の .insert().select() は
  // 挿入直後のSELECTが RLS に弾かれて null を返し、作成者が channel_members に
  // 追加されないまま general にリダイレクトされて詰む。atomic RPC でまとめて処理する。
  const { error: channelErr } = await supabase.rpc("create_channel_with_member", {
    p_workspace_id: workspace.id,
    p_name: "general",
    p_slug: "general",
    p_is_private: false,
  });

  if (channelErr) {
    throw new Error(`generalチャンネル作成失敗: ${channelErr.message}`);
  }

  redirect(`/${workspace.slug}/general`);
}

// メッセージ送信
export async function sendMessage(channelId: string, content: string, parentId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("未認証");

  const { data, error } = await supabase
    .from("messages")
    .insert({
      channel_id: channelId,
      user_id: user.id,
      content,
      parent_id: parentId || null,
    })
    .select("*, profiles(*)")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ログアウト
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
