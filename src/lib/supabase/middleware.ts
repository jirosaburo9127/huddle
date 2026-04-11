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
    // 未認証ユーザーがルートや保護ページに来たら LP(/about) に飛ばす
    // ただし元から /login を明示的に開きに来たアクセスはそのまま通す
    url.pathname = request.nextUrl.pathname === "/" ? "/about" : "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
