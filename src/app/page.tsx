import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createWorkspace } from "@/lib/actions";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { create } = await searchParams;

  // ユーザーが所属するワークスペース一覧を取得
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(slug, created_at)")
    .eq("user_id", user.id);

  // create=true でなければ、適切なワークスペースにリダイレクト
  if (create !== "true" && memberships && memberships.length > 0) {
    // 所属ワークスペースの slug 一覧
    const slugs = memberships
      .map((m) => (m.workspaces as unknown as { slug: string } | null)?.slug)
      .filter((s): s is string => !!s);

    // 前回開いていたワークスペースを Cookie から取得
    // 所属確認して一致すればそこへ戻る (LastWorkspaceTracker が書き込んでいる)
    const cookieStore = await cookies();
    const lastWsSlug = cookieStore.get("huddle_last_workspace")?.value;

    if (lastWsSlug && slugs.includes(lastWsSlug)) {
      redirect(`/${lastWsSlug}`);
    }

    // Cookie が無い / 所属外なら、所属している中で最も古いワークスペースへ
    // (ユーザーが最初に参加した順で安定した挙動にする)
    if (slugs.length > 0) {
      redirect(`/${slugs[0]}`);
    }
  }

  // ワークスペース作成画面
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-accent">Huddle</h1>
          <p className="mt-2 text-muted">ワークスペースを作成して始めましょう</p>
        </div>

        <form action={createWorkspace} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm text-muted mb-1">
              ワークスペース名
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="例: My Team"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-accent py-2 font-medium text-white hover:bg-accent-hover transition-colors"
          >
            ワークスペースを作成
          </button>
        </form>

        {/* 既存WSがある場合は戻るリンクを表示 */}
        {create === "true" && memberships && memberships.length > 0 && (
          <div className="text-center">
            <a
              href="/"
              className="text-sm text-muted hover:text-accent transition-colors"
            >
              ← ワークスペースに戻る
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
