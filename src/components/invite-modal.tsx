"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  workspaceId: string;
  onClose: () => void;
};

export function InviteModal({ workspaceId, onClose }: Props) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();

  // 招待リンクを生成
  async function handleGenerate() {
    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("認証エラーが発生しました");
        return;
      }

      const { data, error: insertError } = await supabase
        .from("workspace_invitations")
        .insert({
          workspace_id: workspaceId,
          created_by: user.id,
        })
        .select("token")
        .single();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      setInviteUrl(`${window.location.origin}/invite/${data.token}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "招待リンクの生成に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }

  // クリップボードにコピー
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("コピーに失敗しました");
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-sidebar border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">メンバーを招待</h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <p className="text-sm text-muted">
          招待リンクを生成して、メンバーに共有しましょう。
        </p>

        {error && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {!inviteUrl ? (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full rounded-lg bg-accent py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "生成中..." : "招待リンクを生成"}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="flex-1 rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground select-all"
              />
              <button
                onClick={handleCopy}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
              >
                {copied ? "コピーしました!" : "コピー"}
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
