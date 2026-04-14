import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // 認証不要ページの判定（これらのページではgetUserを呼ばない）
  const isAuthPage =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup");
  const isInvitePage = request.nextUrl.pathname.startsWith("/invite");
  // 共有ダッシュボード（伴走マイスター向け）はログイン不要
  const isSharePage = request.nextUrl.pathname.startsWith("/share/");
  // LP / マーケティングページ
  const isMarketingPage = request.nextUrl.pathname === "/about";
  const isStaticAsset =
    request.nextUrl.pathname.startsWith("/_next") ||
    request.nextUrl.pathname.startsWith("/favicon") ||
    request.nextUrl.pathname.startsWith("/icon") ||
    request.nextUrl.pathname.startsWith("/apple-icon");

  // 静的アセットはそのまま通す
  if (isStaticAsset) return supabaseResponse;

  // 認証不要ページではSupabaseクライアント生成もスキップして即座にレスポンス
  if (isAuthPage || isInvitePage || isSharePage || isMarketingPage) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 認証が必要なページのみgetUserを呼ぶ
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // 認証チェック失敗時は未認証として扱う
  }

  if (!user) {
    const url = request.nextUrl.clone();
    // 未認証ユーザーは常に /login へ
    // (/about はLP専用の公開ページとして別途アクセス可能にしてあるが、
    //  未認証リダイレクト先にすると Capacitor アプリでログインに戻れなくなるため /login に固定)
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 最後に開いたワークスペースを Cookie に保存。
  // クライアントから document.cookie で書くと iOS WKWebView で
  // 再起動をまたいで消える既知問題があるので、サーバ側で Set-Cookie する。
  // 予約パス以外の /<slug> / を拾う。
  const RESERVED_ROOT_SEGMENTS = new Set([
    "login",
    "signup",
    "invite",
    "about",
    "share",
    "api",
  ]);
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    const first = segments[0];
    if (!RESERVED_ROOT_SEGMENTS.has(first)) {
      supabaseResponse.cookies.set("huddle_last_workspace", first, {
        path: "/",
        maxAge: 31536000, // 1 年
        sameSite: "lax",
        httpOnly: false,
      });
    }
  }

  return supabaseResponse;
}
