"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

/** ログイン後のワークスペースリダイレクト処理 */
async function redirectToWorkspace(
  supabase: ReturnType<typeof createClient>,
  inviteToken: string | null
) {
  if (inviteToken) {
    window.location.href = `/invite/${inviteToken}`;
    return;
  }

  // 所属WSを取得して直接遷移（"/"経由のリダイレクトを省略）
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .limit(1);

  if (memberships && memberships.length > 0) {
    const ws = memberships[0].workspaces as unknown as { slug: string };
    if (ws?.slug && /^[a-z0-9\-]+$/.test(ws.slug)) {
      // ロビー（一覧画面）に着地。いきなり general を開かない。
      window.location.href = `/${ws.slug}`;
      return;
    }
  }
  window.location.href = "/";
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const supabase = createClient();

  // MFAチャレンジ用state
  const [showMfaChallenge, setShowMfaChallenge] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaVerifying, setMfaVerifying] = useState(false);

  // クライアントサイドRate Limiting用state
  const [failCount, setFailCount] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Rate Limiting: ロック中は試行を拒否
    if (Date.now() < lockUntil) {
      setError("しばらくしてからお試しください");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // 汎用エラーメッセージ（Supabaseの詳細を隠す）
        setError("メールアドレスまたはパスワードが正しくありません");

        // 連続失敗カウント更新
        setFailCount((prev) => {
          const newCount = prev + 1;
          if (newCount >= 5) {
            setLockUntil(Date.now() + 15000); // 15秒ロック
            setError("ログイン試行回数が上限に達しました。しばらくしてからお試しください");
            return 0;
          }
          return newCount;
        });
        return;
      }

      // ログイン成功: 失敗カウントをリセット
      setFailCount(0);

      // 監査ログ（fire-and-forget: awaitしない）
      if (data.user) {
        supabase
          .from("audit_logs")
          .insert({
            user_id: data.user.id,
            action: "login_success",
            target_type: "auth",
          })
          .then(() => {});
      }

      // MFAチャレンジが必要か確認
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (
        aalData?.nextLevel === "aal2" &&
        aalData?.currentLevel === "aal1"
      ) {
        // MFAチャレンジが必要
        setShowMfaChallenge(true);
        return;
      }

      // MFA不要 or 完了 → 通常のリダイレクト
      await redirectToWorkspace(supabase, inviteToken);
    } catch {
      setError("ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  // MFAチャレンジの検証処理
  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    if (mfaCode.length !== 6) return;
    setError("");
    setMfaVerifying(true);

    try {
      // TOTP factorを取得
      const { data: factorsData, error: factorsError } =
        await supabase.auth.mfa.listFactors();
      if (factorsError) {
        setError(factorsError.message);
        return;
      }

      const totpFactor = factorsData?.totp?.[0];
      if (!totpFactor) {
        setError("認証要素が見つかりません");
        return;
      }

      // チャレンジ作成
      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
      if (challengeError) {
        setError(challengeError.message);
        return;
      }

      // コード検証
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challengeData.id,
        code: mfaCode,
      });
      if (verifyError) {
        setError(verifyError.message);
        return;
      }

      // 検証成功 → リダイレクト
      await redirectToWorkspace(supabase, inviteToken);
    } catch {
      setError("認証に失敗しました");
    } finally {
      setMfaVerifying(false);
    }
  }

  // MFAチャレンジ画面
  if (showMfaChallenge) {
    return (
      <div className="flex min-h-full items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-transparent.png" alt="" className="w-14 h-14 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-accent">Huddle</h1>
            <p className="mt-2 text-lg font-semibold text-foreground">
              2段階認証
            </p>
            <p className="mt-1 text-muted">
              認証アプリの6桁コードを入力してください
            </p>
          </div>

          <form onSubmit={handleMfaVerify} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => {
                  // 数字のみ許可
                  const val = e.target.value.replace(/\D/g, "");
                  setMfaCode(val);
                }}
                placeholder="000000"
                className="w-full rounded-lg border border-border bg-input-bg px-3 py-3 text-xl tracking-[0.5em] text-center text-foreground placeholder-muted font-mono focus:border-accent focus:outline-none"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={mfaVerifying || mfaCode.length !== 6}
              className="w-full rounded-lg bg-accent py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {mfaVerifying ? "確認中..." : "確認"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setShowMfaChallenge(false);
              setMfaCode("");
              setError("");
            }}
            className="w-full text-center text-sm text-muted hover:text-accent transition-colors"
          >
            ログイン画面に戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-transparent.png" alt="" className="w-14 h-14 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-accent">Huddle</h1>
          <p className="mt-2 text-muted">ログインして始めましょう</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-[15px] text-muted mb-1">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-[15px] text-muted mb-1">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="********"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          アカウントがない場合は{" "}
          <Link href="/signup" className="text-accent hover:underline">
            サインアップ
          </Link>
        </p>
      </div>
    </div>
  );
}
