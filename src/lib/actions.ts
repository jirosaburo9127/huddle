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

  // #general チャンネルを自動作成
  const { data: channel } = await supabase
    .from("channels")
    .insert({
      workspace_id: workspace.id,
      name: "general",
      slug: "general",
      created_by: user.id,
    })
    .select()
    .single();

  if (channel) {
    await supabase.from("channel_members").insert({
      channel_id: channel.id,
      user_id: user.id,
    });
  }

  redirect(`/${workspace.slug}/general`);
}

// チャンネル作成
export async function createChannel(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("未認証");

  const name = formData.get("name") as string;
  const workspaceId = formData.get("workspaceId") as string;
  const isPrivate = formData.get("isPrivate") === "true";
  const asciiSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const slug = asciiSlug || `ch-${crypto.randomUUID().slice(0, 8)}`;

  const { data: channel, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: workspaceId,
      name,
      slug,
      is_private: isPrivate,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // 作成者をメンバーに追加
  await supabase.from("channel_members").insert({
    channel_id: channel.id,
    user_id: user.id,
  });

  return channel;
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
