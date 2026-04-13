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

  // クライアントサイド Rate Limiting 用 state（localStorage に永続化）
  // 段階的バックオフ: 5回失敗→1分、10回→15分、20回→1時間
  // ブラウザタブを閉じても保持されるため単純なリロード回避は効かない
  const LOCK_KEY = "huddle_login_lock";
  const [lockUntil, setLockUntil] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const raw = localStorage.getItem(LOCK_KEY);
    return raw ? Number(raw) : 0;
  });

  function applyLock(ms: number) {
    const until = Date.now() + ms;
    setLockUntil(until);
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCK_KEY, String(until));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Rate Limiting: ロック中は試行を拒否（localStorage で永続化済み）
    if (Date.now() < lockUntil) {
      const secLeft = Math.ceil((lockUntil - Date.now()) / 1000);
      setError(`ログインがロックされています。あと約${secLeft}秒お待ちください。`);
      return;
    }

    // サーバ側の失敗数も確認（複数端末・ブラウザを跨いだブルートフォース検知）
    // 直近15分で15回以上失敗していたら一旦ロック
    try {
      const { data: failCount } = await supabase.rpc("count_recent_login_failures", {
        p_email: email,
        p_window_minutes: 15,
      });
      if (typeof failCount === "number" && failCount >= 15) {
        applyLock(15 * 60 * 1000); // 15分
        setError("このメールアドレスのログイン試行が多すぎます。しばらく待ってからお試しください。");
        return;
      }
    } catch {
      // RPC失敗はスキップ（可用性優先）
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // 汎用エラーメッセージ（Supabase の詳細を隠す）
        setError("メールアドレスまたはパスワードが正しくありません");

        // DB に失敗を記録（別端末からのブルートフォース検知に使う）
        supabase.rpc("record_login_failure", { p_email: email }).then(() => {});

        // サーバで返ってきた直近失敗数で段階的バックオフを適用
        try {
          const { data: latestCount } = await supabase.rpc("count_recent_login_failures", {
            p_email: email,
            p_window_minutes: 15,
          });
          const c = typeof latestCount === "number" ? latestCount : 0;
          if (c >= 20) {
            applyLock(60 * 60 * 1000); // 1時間
            setError("ログイン試行が多すぎます。1時間後に再度お試しください。");
          } else if (c >= 10) {
            applyLock(15 * 60 * 1000); // 15分
            setError("ログイン試行が多すぎます。15分後に再度お試しください。");
          } else if (c >= 5) {
            applyLock(60 * 1000); // 1分
            setError("ログイン試行が多すぎます。1分後に再度お試しください。");
          }
        } catch {
          // カウント取得失敗は無視
        }
        return;
      }

      // ログイン成功: ロックを解除
      setLockUntil(0);
      if (typeof window !== "undefined") {
        localStorage.removeItem(LOCK_KEY);
      }

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
