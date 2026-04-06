"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  workspaceId: string;
  workspaceSlug: string;
  onClose: () => void;
};

export function CreateChannelModal({ workspaceId, workspaceSlug, onClose }: Props) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: channel, error: err } = await supabase
      .from("channels")
      .insert({
        workspace_id: workspaceId,
        name,
        slug,
        is_private: isPrivate,
        created_by: user.id,
      })
      .select()
      .single();

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    // メンバーに追加
    await supabase.from("channel_members").insert({
      channel_id: channel.id,
      user_id: user.id,
    });

    onClose();
    router.push(`/${workspaceSlug}/${channel.slug}`);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-sidebar border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">チャンネルを作成</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
          )}

          <div>
            <label className="block text-sm text-muted mb-1">チャンネル名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="例: random"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-muted">プライベートチャンネルにする</span>
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {loading ? "作成中..." : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
