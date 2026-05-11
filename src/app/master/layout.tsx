import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

// /master 配下は is_master = true のユーザだけがアクセス可能。
// 認証ゲートをここで一括処理する。
export default async function MasterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_master, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_master) redirect("/");

  return (
    <div className="min-h-screen bg-background">
      {/* ヘッダー */}
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/master" className="font-bold text-foreground">
            🔑 マスター
          </Link>
          <span className="text-xs text-muted">読み取り専用</span>
          <span className="ml-auto text-xs text-muted truncate">
            {profile.display_name} としてログイン中
          </span>
          <Link
            href="/"
            className="text-xs text-muted hover:text-foreground underline ml-2"
          >
            通常画面に戻る
          </Link>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-4">{children}</main>
    </div>
  );
}
