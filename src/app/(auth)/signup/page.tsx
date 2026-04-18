"use client";

import { useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validatePassword, checkPasswordBreached } from "@/lib/password-strength";
import Link from "next/link";

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const supabase = createClient();

  const passwordStrength = useMemo(() => validatePassword(password), [password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // パスワード強度検証（クライアント側の最終チェック）
    if (!passwordStrength.valid) {
      setError(passwordStrength.errors[0]);
      return;
    }

    setLoading(true);

    // 漏洩パスワード DB (HaveIBeenPwned) と突き合わせ
    // k-anonymity API なのでパスワード本体は送信されない
    const breachCount = await checkPasswordBreached(password);
    if (breachCount !== null && breachCount > 0) {
      setError(
        `このパスワードは過去のデータ漏洩で${breachCount.toLocaleString()}回確認されています。別のパスワードを設定してください。`
      );
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
        },
      });

      if (error) {
        // Supabaseの詳細エラーを隠し、汎用メッセージを表示
        if (error.message.includes("already")) {
          setError("このメールアドレスは既に登録されています");
        } else {
          setError("アカウントの作成に失敗しました");
        }
        return;
      }

      // 招待トークンがあれば招待ページへ、なければホームへ
      window.location.href = inviteToken ? `/invite/${inviteToken}` : "/";
    } catch {
      setError("サインアップに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-accent">Huddle</h1>
          <p className="mt-2 text-muted">アカウントを作成</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="displayName" className="block text-base text-muted mb-1">
              表示名
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="山田太郎"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-base text-muted mb-1">
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
            <label htmlFor="password" className="block text-base text-muted mb-1">
              パスワード
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
            />
            {/* 強度ゲージ */}
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
                  <p className="text-xs text-emerald-400">
                    強度OK
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "作成中..." : "アカウント作成"}
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          既にアカウントがある場合は{" "}
          <Link href="/login" className="text-accent hover:underline">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
