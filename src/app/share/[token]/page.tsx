import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

type SharedDashboardData = {
  workspace: { id: string; name: string; slug: string };
  decisions: Array<{
    id: string;
    content: string;
    created_at: string;
    channel_name: string;
    sender_name: string;
    sender_avatar: string | null;
  }>;
  stats: {
    decisions_this_week: number;
    decisions_total: number;
    active_channels: number;
  };
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  // SECURITY DEFINER 関数で RLS をバイパスして取得
  const { data, error } = await supabase.rpc("get_shared_dashboard_data", {
    p_token: token,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[share] rpc error:", error);
    notFound();
  }
  if (!data) {
    // eslint-disable-next-line no-console
    console.log("[share] token not found or expired:", token.slice(0, 8));
    notFound();
  }

  const dashboard = data as SharedDashboardData;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ヘッダー */}
      <header className="border-b border-border bg-header">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-accent">Huddle</h1>
            <span className="text-sm text-muted">進捗共有</span>
          </div>
          <div className="mt-2 text-base text-foreground">
            {dashboard.workspace.name}
          </div>
          <div className="mt-1 text-xs text-muted">
            このページは閲覧専用です。ログインなしで最新の決定事項をご覧いただけます。
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* 集計サマリー */}
        <section className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-border bg-white/[0.02] p-5">
            <div className="text-xs text-muted">今週の決定事項</div>
            <div className="mt-2 text-3xl font-bold text-accent">
              {dashboard.stats.decisions_this_week}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-white/[0.02] p-5">
            <div className="text-xs text-muted">累計</div>
            <div className="mt-2 text-3xl font-bold text-foreground">
              {dashboard.stats.decisions_total}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-white/[0.02] p-5">
            <div className="text-xs text-muted">活動チャンネル数</div>
            <div className="mt-2 text-3xl font-bold text-foreground">
              {dashboard.stats.active_channels}
            </div>
          </div>
        </section>

        {/* 決定事項一覧 */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">
            決定事項タイムライン
          </h2>
          {dashboard.decisions.length === 0 ? (
            <div className="rounded-2xl border border-border bg-white/[0.02] p-8 text-center text-muted">
              まだ決定事項がありません
            </div>
          ) : (
            <div className="space-y-3">
              {dashboard.decisions.map((d) => (
                <div
                  key={d.id}
                  className="rounded-2xl border border-accent/30 bg-accent/[0.03] p-4"
                >
                  <div className="flex items-center gap-2 text-xs text-muted mb-1.5">
                    <span className="text-accent font-semibold">
                      #{d.channel_name}
                    </span>
                    <span>・</span>
                    <span>{d.sender_name}</span>
                    <span>・</span>
                    <span>{formatDate(d.created_at)}</span>
                  </div>
                  <div className="text-base whitespace-pre-wrap break-words text-foreground">
                    {d.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="pt-8 border-t border-border text-center text-xs text-muted">
          Powered by Huddle
        </footer>
      </main>
    </div>
  );
}
