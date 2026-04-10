"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";

// 安全なランダムトークン生成（URLセーフ・推測困難）
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createShareToken(
  workspaceId: string,
  label: string
): Promise<{ ok: boolean; token?: string; error?: string }> {
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const supabase = await createClient();
  const token = generateToken();

  const { error } = await supabase.from("share_tokens").insert({
    workspace_id: workspaceId,
    token,
    label: label.trim() || "無題",
    created_by: user.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/`, "layout");
  return { ok: true, token };
}

export async function revokeShareToken(
  tokenId: string,
  workspaceSlug: string
): Promise<{ ok: boolean; error?: string }> {
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("share_tokens")
    .update({ is_active: false })
    .eq("id", tokenId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${workspaceSlug}/dashboard`);
  return { ok: true };
}
