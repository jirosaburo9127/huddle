"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validatePassword, checkPasswordBreached } from "@/lib/password-strength";
import Link from "next/link";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

// リカバリリンクの検証状態
type VerifyState = "verifying" | "valid" | "invalid";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [verifyState, setVerifyState] = useState<VerifyState>("verifying");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordStrength = useMemo(() => validatePassword(password), [password]);

  // マウント時にメールリンクの token_hash を検証してリカバリセッションを確立する。
  // token_hash 方式は code verifier 不要のため、別ブラウザ/別端末で開いても成立する。
  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");

    if (!tokenHash || type !== "recovery") {
      setVerifyState("invalid");
      return;
    }

    let cancelled = false;
    (async () => {
      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: tokenHash,
      });
      if (cancelled) return;
      setVerifyState(error ? "invalid" : "valid");
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // パスワード強度検証（クライアント側の最終チェック）
    if (!passwordStrength.valid) {
      setError(passwordStrength.errors[0]);
      return;
    }

    setLoading(true);

    // 漏洩パスワード DB (HaveIBeenPwned) と突き合わせ（k-anonymity）
    const breachCount = await checkPasswordBreached(password);
    if (breachCount !== null && breachCount > 0) {
      setError(
        `このパスワードは過去のデータ漏洩で${breachCount.toLocaleString()}回確認されています。別のパスワードを設定してください。`
      );
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setError("パスワードの更新に失敗しました。お手数ですが再度お試しください。");
        return;
      }

      // 監査ログ（fire-and-forget: awaitしない）
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        supabase
          .from("audit_logs")
          .insert({
            user_id: userData.user.id,
            action: "password_reset",
            target_type: "auth",
          })
          .then(() => {});
      }

      // 更新成功 → ログイン画面へ（新パスワードでの再ログインを促す）
      window.location.href = "/login";
    } catch {
      setError("パスワードの更新に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  // 検証中
  if (verifyState === "verifying") {
    return (
      <div className="flex min-h-full items-center justify-center px-4">
        <p className="text-muted">リンクを確認しています...</p>
      </div>
    );
  }

  // 無効・期限切れリンク
  if (verifyState === "invalid") {
    return (
      <div className="flex min-h-full items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/logo-transparent.png" alt="" className="w-14 h-14 mx-auto mb-3" />
            <h1 className="text-3xl font-bold text-accent">Huddle</h1>
            <p className="mt-2 text-lg font-semibold text-foreground">
              リンクが無効です
            </p>
          </div>

          <div className="rounded-lg bg-red-500/10 p-4 text-sm text-red-400 leading-relaxed">
            このパスワード再設定リンクは無効か、有効期限が切れています。
            お手数ですが、もう一度メールの送信をお試しください。
          </div>

          <p className="text-center text-sm text-muted">
            <Link href="/forgot-password" className="text-accent hover:underline">
              再設定リンクを再送する
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // 検証成功 → 新パスワード入力フォーム
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-transparent.png" alt="" className="w-14 h-14 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-accent">Huddle</h1>
          <p className="mt-2 text-muted">新しいパスワードを設定</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="password" className="block text-base text-muted mb-1">
              新しいパスワード
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="12文字以上（英大文字小文字・数字・記号）"
              autoFocus
            />
            {/* 強度ゲージ（signup と同一仕様） */}
            {password.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`flex-1 h-1 rounded-full transition-colors ${
                        i < passwordStrength.score
                          ? passwordStrength.score <= 1
                            ? "bg-red-500"
                            : passwordStrength.score === 2
                            ? "bg-amber-500"
                            : passwordStrength.score === 3
                            ? "bg-lime-500"
                            : "bg-emerald-500"
                          : "bg-white/10"
                      }`}
                    />
                  ))}
                </div>
                {passwordStrength.errors.length > 0 ? (
                  <p className="text-xs text-red-400">
                    {passwordStrength.errors[0]}
                  </p>
                ) : (
                  <p className="text-xs text-emerald-400">強度OK</p>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "更新中..." : "パスワードを更新"}
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          <Link href="/login" className="text-accent hover:underline">
            ログイン画面に戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
