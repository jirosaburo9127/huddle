import { cache } from "react";
import { createClient } from "./server";

// リクエスト単位でgetUser()をメモ化（同一リクエスト内で何回呼んでも1回だけ実行）
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
