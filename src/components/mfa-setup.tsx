"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/** TOTP factorの型（Supabase MFA listFactorsの返り値） */
type TotpFactor = {
  id: string;
  friendly_name?: string;
  factor_type: "totp";
  status: "verified" | "unverified";
};

type MfaSetupProps = {
  /** 設定完了時のコールバック */
  onStatusChange?: () => void;
};

export function MfaSetup({ onStatusChange }: MfaSetupProps) {
  const supabase = createClient();

  // 設定状態
  const [totpFactor, setTotpFactor] = useState<TotpFactor | null>(null);
  const [loading, setLoading] = useState(true);

  // 登録フロー用state
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 無効化中フラグ
  const [unenrolling, setUnenrolling] = useState(false);

  // TOTP factorの読み込み
  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        console.error("MFA factor取得エラー:", listError);
        return;
      }
      // verifiedなTOTP factorを検索
      const verified = data?.totp?.find(
        (f: TotpFactor) => f.status === "verified"
      );
      setTotpFactor(verified || null);
    } catch (err) {
      console.error("MFA factor取得エラー:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  // トースト自動消去
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 登録フロー開始
  const handleStartEnroll = async () => {
    setError(null);
    setEnrolling(true);
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
      });
      if (enrollError) {
        setError(enrollError.message);
        setEnrolling(false);
        return;
      }
      if (data?.totp?.qr_code) {
        setQrCode(data.totp.qr_code);
        setFactorId(data.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
      setEnrolling(false);
    }
  };

  // コード検証（登録確定）
  const handleVerify = async () => {
    if (!factorId || verifyCode.length !== 6) return;
    setError(null);
    setVerifying(true);
    try {
      const { error: verifyError } =
        await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code: verifyCode,
        });
      if (verifyError) {
        setError(verifyError.message);
        setVerifying(false);
        return;
      }
      // 成功
      setToast("2段階認証を設定しました");
      setEnrolling(false);
      setQrCode(null);
      setFactorId(null);
      setVerifyCode("");
      await loadFactors();
      onStatusChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "検証に失敗しました");
    } finally {
      setVerifying(false);
    }
  };

  // 登録フローキャンセル
  const handleCancelEnroll = async () => {
    // 未検証のfactorを削除
    if (factorId) {
      await supabase.auth.mfa.unenroll({ factorId });
    }
    setEnrolling(false);
    setQrCode(null);
    setFactorId(null);
    setVerifyCode("");
    setError(null);
  };

  // 無効化
  const handleUnenroll = async () => {
    if (!totpFactor) return;
    setError(null);
    setUnenrolling(true);
    try {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({
        factorId: totpFactor.id,
      });
      if (unenrollError) {
        setError(unenrollError.message);
        setUnenrolling(false);
        return;
      }
      setToast("2段階認証を無効にしました");
      setTotpFactor(null);
      onStatusChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "無効化に失敗しました");
    } finally {
      setUnenrolling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
        読み込み中...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* エラー表示 */}
      {error && (
        <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div className="rounded-lg bg-green-500/10 p-3 text-sm text-green-400 animate-fade-in">
          {toast}
        </div>
      )}

      {/* 設定済みの場合 */}
      {totpFactor && !enrolling && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            2段階認証が有効です
          </div>
          <button
            type="button"
            onClick={handleUnenroll}
            disabled={unenrolling}
            className="px-4 py-2 text-sm rounded-xl border border-mention/30 text-mention hover:bg-mention/10 transition-colors disabled:opacity-50"
          >
            {unenrolling ? "無効化中..." : "無効にする"}
          </button>
        </div>
      )}

      {/* 未設定 & 登録フロー未開始 */}
      {!totpFactor && !enrolling && (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            認証アプリ（Google Authenticator等）を使って、ログイン時のセキュリティを強化できます。
          </p>
          <button
            type="button"
            onClick={handleStartEnroll}
            className="px-4 py-2 text-sm rounded-xl bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            2段階認証を設定
          </button>
        </div>
      )}

      {/* 登録フロー中 */}
      {enrolling && (
        <div className="space-y-4">
          {qrCode && (
            <>
              <p className="text-sm text-muted">
                認証アプリで下のQRコードをスキャンしてください。
              </p>
              {/* QRコード表示 */}
              <div className="flex justify-center">
                <div className="bg-white p-3 rounded-xl">
                  <img
                    src={qrCode}
                    alt="TOTP QRコード"
                    className="w-48 h-48"
                  />
                </div>
              </div>
              {/* コード入力 */}
              <div>
                <label className="text-xs text-muted mb-1 block">
                  認証アプリに表示された6桁のコードを入力
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => {
                    // 数字のみ許可
                    const val = e.target.value.replace(/\D/g, "");
                    setVerifyCode(val);
                  }}
                  placeholder="000000"
                  className="w-full bg-background/50 rounded-xl px-3 py-2 text-lg tracking-[0.5em] text-center border border-border/50 focus:border-accent focus:bg-input-bg placeholder-muted/60 transition-all outline-none font-mono"
                  autoFocus
                />
              </div>
              {/* ボタン */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={verifying || verifyCode.length !== 6}
                  className="px-4 py-2 text-sm rounded-xl bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {verifying ? "確認中..." : "確認"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEnroll}
                  className="px-4 py-2 text-sm rounded-xl border border-border/50 text-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
