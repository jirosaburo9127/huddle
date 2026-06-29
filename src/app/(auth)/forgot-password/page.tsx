"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  // 送信完了表示フラグ（アカウントの存在有無は出さない＝列挙対策）
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      // リセットメールを送信。リンクは token_hash 形式で /reset-password に着地する
      // （メールテンプレート側で {{ .TokenHash }} を使うため別ブラウザ/別端末でも動く）
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // 送信失敗もユーザーには成功扱いで見せる（メール存在の有無を漏らさない）
    } finally {
      // 成功・失敗にかかわらず完了画面へ（アカウント列挙防止）
      setSent(true);
      setLoading(false);
    }
  }

  // 送信完了画面
  if (sent) {
    return (
      <div className="flex min-h-full items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/logo-transparent.png" alt="" className="w-14 h-14 mx-auto mb-3" />
            <h1 className="text-3xl font-bold text-accent">Huddle</h1>
            <p className="mt-2 text-lg font-semibold text-foreground">
              メールを送信しました
            </p>
          </div>

          <div className="rounded-lg bg-input-bg border border-border p-4 text-sm text-muted leading-relaxed">
            入力されたメールアドレス宛に、パスワード再設定用のリンクを送信しました。
            メールが届かない場合は、迷惑メールフォルダもご確認ください。
          </div>

          <Link
            href="/login"
            className="block w-full text-center text-sm text-muted hover:text-accent transition-colors"
          >
            ログイン画面に戻る
          </Link>
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
          <p className="mt-2 text-muted">パスワードの再設定</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted">
            登録済みのメールアドレスを入力してください。再設定用のリンクをお送りします。
          </p>

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

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "送信中..." : "再設定リンクを送信"}
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
