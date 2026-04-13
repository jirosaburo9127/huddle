"use client";

// アカウントセキュリティ情報のパネル
// - 通知を受け取っているデバイス一覧（device_tokens 由来）と個別削除
// - 最近のログイン履歴（audit_logs の login_success 由来）
// - MFA 有効状態の表示
//
// 追加のみで既存機能には触らない。

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type DeviceToken = {
  id: string;
  token: string;
  platform: string;
  updated_at: string;
  created_at: string;
};

type LoginEvent = {
  id: string;
  created_at: string;
  action: string;
};

type Props = {
  currentUserId: string;
};

export function SecuritySettings({ currentUserId }: Props) {
  const [devices, setDevices] = useState<DeviceToken[]>([]);
  const [logins, setLogins] = useState<LoginEvent[]>([]);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    try {
      const [dRes, lRes, mfaRes] = await Promise.all([
        supabase
          .from("device_tokens")
          .select("id, token, platform, updated_at, created_at")
          .eq("user_id", currentUserId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("audit_logs")
          .select("id, created_at, action")
          .eq("user_id", currentUserId)
          .eq("action", "login_success")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.auth.mfa.listFactors(),
      ]);
      setDevices((dRes.data as DeviceToken[]) || []);
      setLogins((lRes.data as LoginEvent[]) || []);
      // verified な TOTP factor が1つでもあれば MFA 有効
      const totp = mfaRes.data?.totp || [];
      setMfaEnabled(totp.some((f: { status: string }) => f.status === "verified"));
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  async function revokeDevice(id: string) {
    if (!confirm("このデバイスを通知対象から外しますか？\n該当デバイスでは再度アプリを開くと再登録されます。")) {
      return;
    }
    setRevoking(id);
    const supabase = createClient();
    const { error } = await supabase.from("device_tokens").delete().eq("id", id);
    setRevoking(null);
    if (error) {
      alert("削除に失敗しました: " + error.message);
      return;
    }
    setDevices((prev) => prev.filter((d) => d.id !== id));
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  }

  function platformLabel(p: string): string {
    if (p === "ios") return "iPhone / iPad";
    if (p === "android") return "Android";
    if (p === "web") return "Web ブラウザ";
    return p;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3">
        セキュリティ
      </h3>

      {loading && (
        <p className="text-xs text-muted">読み込み中...</p>
      )}

      {!loading && (
        <div className="space-y-4">
          {/* MFA 状態 */}
          <div className="flex items-center justify-between rounded-xl border border-border/50 bg-background/30 px-3 py-2">
            <div>
              <p className="text-xs text-muted">2段階認証</p>
              <p className="text-sm font-medium">
                {mfaEnabled ? (
                  <span className="text-emerald-400">有効</span>
                ) : (
                  <span className="text-amber-400">未設定</span>
                )}
              </p>
            </div>
            {!mfaEnabled && (
              <span className="text-[11px] text-muted">下の「2段階認証」ボタンから設定</span>
            )}
          </div>

          {/* 通知デバイス一覧 */}
          <div>
            <p className="text-xs text-muted mb-2">
              通知を受け取っているデバイス ({devices.length})
            </p>
            {devices.length === 0 ? (
              <p className="text-xs text-muted">登録されたデバイスはありません</p>
            ) : (
              <div className="space-y-1.5">
                {devices.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {platformLabel(d.platform)}
                      </p>
                      <p className="text-muted text-[11px]">
                        最終更新 {formatDate(d.updated_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => revokeDevice(d.id)}
                      disabled={revoking === d.id}
                      className="ml-2 shrink-0 rounded-lg border border-mention/40 text-mention hover:bg-mention/10 px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
                    >
                      {revoking === d.id ? "..." : "削除"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 最近のログイン履歴 */}
          <div>
            <p className="text-xs text-muted mb-2">最近のログイン履歴 (直近10件)</p>
            {logins.length === 0 ? (
              <p className="text-xs text-muted">履歴がありません</p>
            ) : (
              <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {logins.map((l) => (
                  <li
                    key={l.id}
                    className="text-[11px] text-muted flex items-center justify-between rounded-lg bg-background/20 px-2.5 py-1.5"
                  >
                    <span>{formatDate(l.created_at)}</span>
                    <span className="text-emerald-400/80">成功</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-muted/60 mt-1">
              身に覚えのないログインがあればパスワードを変更してください
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
