import { createClient } from "@/lib/supabase/client";

// リアクション候補のユーザー個別設定。
// custom: 自分だけの追加候補 / hidden: 非表示にしたプリセット。他人には影響しない。
export interface ReactionPrefs {
  custom: string[];
  hidden: string[];
}

const EMPTY: ReactionPrefs = { custom: [], hidden: [] };

// セッション内キャッシュ（ピッカーを開くたびに毎回フェッチしないため）
let cache: ReactionPrefs | null = null;
let loading: Promise<ReactionPrefs> | null = null;

function normalize(raw: unknown): ReactionPrefs {
  const p = (raw || {}) as Partial<ReactionPrefs>;
  return {
    custom: Array.isArray(p.custom) ? p.custom.filter((x) => typeof x === "string") : [],
    hidden: Array.isArray(p.hidden) ? p.hidden.filter((x) => typeof x === "string") : [],
  };
}

export function getCachedReactionPrefs(): ReactionPrefs {
  return cache ?? EMPTY;
}

export async function loadReactionPrefs(): Promise<ReactionPrefs> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return EMPTY;
      const { data } = await supabase
        .from("profiles")
        .select("reaction_prefs")
        .eq("id", user.id)
        .single();
      cache = normalize((data as { reaction_prefs?: unknown } | null)?.reaction_prefs);
      return cache;
    } catch {
      return EMPTY;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function saveReactionPrefs(next: ReactionPrefs): Promise<void> {
  cache = next; // 楽観的にキャッシュ更新
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ reaction_prefs: next }).eq("id", user.id);
  } catch {
    // 保存失敗時もキャッシュは維持（次回リロードでサーバ値に戻る）
  }
}
