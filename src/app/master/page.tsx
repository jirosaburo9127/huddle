import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  member_count: number;
  channel_count: number;
  message_count: number;
  latest_message_at: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}日前`;
  return new Date(iso).toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  });
}

export default async function MasterRoot() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("master_list_workspaces");
  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
        ワークスペース一覧を取得できませんでした: {error.message}
      </div>
    );
  }
  const workspaces = (data || []) as Workspace[];

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold text-foreground">全ワークスペース</h1>
        <p className="text-xs text-muted">
          {workspaces.length} 件 / クリックでチャンネル一覧へ
        </p>
      </div>
      <ul className="space-y-2">
        {workspaces.map((w) => (
          <li key={w.id}>
            <Link
              href={`/master/ws/${w.id}`}
              className="block rounded-xl border border-border bg-input-bg px-4 py-3 hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground truncate">
                    {w.name}
                  </div>
                  <div className="text-[11px] text-muted truncate">
                    slug: {w.slug} / 作成: {new Date(w.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </div>
                </div>
                <div className="text-right text-[11px] text-muted shrink-0">
                  <div>{w.member_count} 名</div>
                  <div>{w.channel_count} ch</div>
                  <div>{w.message_count.toLocaleString()} msg</div>
                  <div className="text-[10px] mt-0.5">
                    最終: {relativeTime(w.latest_message_at)}
                  </div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
