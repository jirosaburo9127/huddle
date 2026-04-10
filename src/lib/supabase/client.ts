import { createBrowserClient } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Realtime に明示的に JWT を渡す。
    // 一部環境（特に iOS Safari/WKWebView）では、createBrowserClient が
    // 自動的に realtime の認証トークンを設定しないことがあり、
    // その場合 RLS で全イベントが弾かれてリアルタイム配信が届かなくなる。
    // 初期化時とセッション変化時の両方で setAuth を呼んで明示的に同期させる。
    const c = client;

    // 起動時に既存セッションがあれば即座に setAuth
    void (async () => {
      const result = await c.auth.getSession();
      const session = result.data.session as Session | null;
      if (session?.access_token) {
        c.realtime.setAuth(session.access_token);
      }
    })();

    // 認証イベント（ログイン・トークン更新・ログアウト）に追従
    c.auth.onAuthStateChange((_event: string, session: Session | null) => {
      if (session?.access_token) {
        c.realtime.setAuth(session.access_token);
      }
    });
  }
  return client;
}
