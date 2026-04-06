import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { createWorkspace } from "@/lib/actions";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // ユーザーが所属するワークスペースを取得
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .eq("user_id", user.id)
    .limit(1);

  // ワークスペースがあればリダイレクト
  if (memberships && memberships.length > 0) {
    const workspace = memberships[0].workspaces as unknown as { slug: string };
    if (workspace?.slug) {
      redirect(`/${workspace.slug}/general`);
    }
  }

  // なければワークスペース作成画面
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
      </div>
    </div>
  );
}
