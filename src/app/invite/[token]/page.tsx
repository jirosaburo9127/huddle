"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type InvitationInfo = {
  workspace_name: string;
  workspace_slug: string;
};

export default function InvitePage() {
  const params = useParams();
  const token = params.token as string;
  const supabase = createClient();

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // 招待情報と認証状態を取得
  useEffect(() => {
    async function load() {
      try {
        // 認証状態チェック
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setIsAuthenticated(!!user);

        // 招待情報を取得
        const { data, error: rpcError } = await supabase.rpc(
          "get_invitation_info",
          { p_token: token }
        );

        if (rpcError) {
          setError("招待情報の取得に失敗しました");
          return;
        }

        if (data?.error) {
          setError("この招待リンクは無効または期限切れです");
          return;
        }

        setInfo({
          workspace_name: data.workspace_name,
          workspace_slug: data.workspace_slug,
        });
      } catch {
        setError("エラーが発生しました");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [token, supabase]);

  // ワークスペースに参加
  async function handleJoin() {
    setJoining(true);
    setError("");

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "accept_invitation",
        { p_token: token }
      );

      if (rpcError) {
        setError("参加に失敗しました");
        setJoining(false);
        return;
      }

      if (data?.error) {
        setError("この招待リンクは無効または期限切れです");
        setJoining(false);
        return;
      }

      // リダイレクト前にslugを検証（不正なslugによるオープンリダイレクト防止）
      const isValidSlug = /^[a-z0-9\-]+$/.test(data.workspace_slug);
      if (!isValidSlug) {
        setError("無効なワークスペースです");
        setJoining(false);
        return;
      }
      // 参加成功 → ワークスペースのgeneralチャンネルにリダイレクト
      window.location.href = `/${data.workspace_slug}/general`;
    } catch {
      setError("参加処理中にエラーが発生しました");
      setJoining(false);
    }
  }

  // ローディング
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-accent">Huddle</h1>
          <p className="mt-4 text-muted">読み込み中...</p>
        </div>
      </div>
    );
  }

  // エラー（無効なトークン等）
  if (error && !info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-3xl font-bold text-accent">Huddle</h1>
          <div className="rounded-lg bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
          <a
            href="/login"
            className="inline-block text-sm text-accent hover:underline"
          >
            ログインページへ
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold text-accent">Huddle</h1>
          <p className="mt-4 text-lg text-foreground">
            <span className="font-semibold">{info?.workspace_name}</span>{" "}
            に招待されています
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {isAuthenticated ? (
          // 認証済み: 参加ボタン
          <button
            onClick={handleJoin}
            disabled={joining}
            className="w-full rounded-xl bg-accent py-2 px-6 font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {joining ? "参加中..." : "参加する"}
          </button>
        ) : (
          // 未認証: サインアップ/ログインボタン
          <div className="space-y-3">
            <a
              href={`/signup?invite=${token}`}
              className="block w-full rounded-xl bg-accent py-2 px-6 font-medium text-white hover:bg-accent-hover transition-colors text-center"
            >
              サインアップして参加
            </a>
            <a
              href={`/login?invite=${token}`}
              className="block w-full rounded-xl border border-border py-2 px-6 font-medium text-foreground hover:bg-white/[0.04] transition-colors text-center"
            >
              ログインして参加
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
