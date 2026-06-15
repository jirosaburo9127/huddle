"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { ThemeSelector } from "@/components/theme-selector";
import { signOut } from "@/lib/actions";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const params = useParams<{ workspace: string }>();
  const supabase = createClient();

  const [currentEmail, setCurrentEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [archivedChannels, setArchivedChannels] = useState<Array<{ id: string; name: string }>>([]);

  // メールアドレス + アーカイブ済みチャンネル取得
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setCurrentEmail(user.email);
      // ワークスペースID取得 → アーカイブ済みチャンネル
      const { data: ws } = await supabase
        .from("workspaces")
        .select("id")
        .eq("slug", params.workspace)
        .maybeSingle();
      if (ws) {
        const { data } = await supabase
          .from("channels")
          .select("id, name")
          .eq("workspace_id", ws.id)
          .eq("is_archived", true)
          .eq("is_dm", false)
          .order("name");
        if (data) setArchivedChannels(data);
      }
    })();
  }, [supabase, params.workspace]);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <header className="flex items-center px-6 py-3 border-b border-border bg-header shrink-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden mr-2 p-1 text-muted hover:text-foreground rounded transition-colors"
          aria-label="戻る"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="font-bold text-lg">設定</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-xl">
        {/* テーマ設定 */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">テーマ</h2>
          <ThemeSelector />
        </section>

        {/* アーカイブ済みチャンネル */}
        {archivedChannels.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-3">アーカイブ済みチャンネル</h2>
            <div className="space-y-1">
              {archivedChannels.map((ch) => (
                <div key={ch.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-border/50">
                  <span className="text-sm text-muted flex-1 truncate"># {ch.name}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      const { error } = await supabase.rpc("set_channel_archived", {
                        p_channel_id: ch.id,
                        p_archived: false,
                      });
                      if (error) {
                        alert("解除に失敗しました: " + error.message);
                        return;
                      }
                      setArchivedChannels((prev) => prev.filter((c) => c.id !== ch.id));
                    }}
                    className="shrink-0 px-3 py-1 text-xs font-medium text-accent border border-accent/30 rounded-lg hover:bg-accent/10 transition-colors"
                  >
                    解除
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* アカウント */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">アカウント</h2>

          {/* メールアドレス変更 */}
          <div className="mb-4 space-y-2">
            <label className="text-xs text-muted">メールアドレス</label>
            <p className="text-sm text-foreground">{currentEmail || "読み込み中..."}</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => { setNewEmail(e.target.value); setEmailMsg(null); }}
                placeholder="新しいメールアドレス"
                className="flex-1 rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={emailSaving || !newEmail.trim() || newEmail.trim() === currentEmail}
                onClick={async () => {
                  setEmailSaving(true);
                  setEmailMsg(null);
                  const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
                  if (error) {
                    setEmailMsg({ type: "error", text: "変更に失敗しました: " + error.message });
                  } else {
                    setEmailMsg({ type: "success", text: "確認メールを送信しました。新しいメールアドレスに届いたリンクをクリックして変更を完了してください。" });
                    setNewEmail("");
                  }
                  setEmailSaving(false);
                }}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {emailSaving ? "送信中..." : "変更"}
              </button>
            </div>
            {emailMsg && (
              <div className={`rounded-lg px-3 py-2 text-sm ${emailMsg.type === "error" ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
                {emailMsg.text}
              </div>
            )}
          </div>

          {/* ログアウト */}
          <form action={signOut}>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-xl border border-mention/30 text-mention hover:bg-mention/10 transition-colors"
            >
              ログアウト
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
