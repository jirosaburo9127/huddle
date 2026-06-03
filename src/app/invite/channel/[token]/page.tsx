"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ChannelInviteInfo = {
  channel_name: string;
  channel_slug: string;
  workspace_name: string;
  workspace_slug: string;
};

export default function ChannelInvitePage() {
  const params = useParams();
  const token = params.token as string;
  const supabase = createClient();

  const [info, setInfo] = useState<ChannelInviteInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setIsAuthenticated(!!user);

        const { data, error: rpcError } = await supabase.rpc(
          "get_channel_invitation_info",
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

        setInfo(data as ChannelInviteInfo);
      } catch {
        setError("エラーが発生しました");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [token, supabase]);

  async function handleJoin() {
    setJoining(true);
    setError("");

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "accept_channel_invitation",
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

      const isValidSlug = /^[a-z0-9\-]+$/.test(data.workspace_slug);
      if (!isValidSlug) {
        setError("無効なワークスペースです");
        setJoining(false);
        return;
      }
      window.location.href = `/${data.workspace_slug}/${data.channel_slug}`;
    } catch {
      setError("参加処理中にエラーが発生しました");
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-background)", padding: 16 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--color-accent)" }}>Huddle</h1>
          <p style={{ marginTop: 16, color: "var(--color-muted)" }}>読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-background)", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--color-accent)" }}>Huddle</h1>
          <div style={{ marginTop: 24, borderRadius: 12, background: "rgba(239,68,68,0.1)", padding: 16, fontSize: 14, color: "#ef4444" }}>
            {error}
          </div>
          <a href="/login" style={{ display: "inline-block", marginTop: 16, fontSize: 14, color: "var(--color-accent)" }}>
            ログインページへ
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-background)", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--color-accent)" }}>Huddle</h1>
        <div style={{ marginTop: 24 }}>
          <p style={{ fontSize: 18, color: "var(--color-foreground)" }}>
            <span style={{ fontWeight: 600 }}>{info?.workspace_name}</span>
          </p>
          <p style={{ fontSize: 16, color: "var(--color-foreground)", marginTop: 8 }}>
            <span style={{ color: "var(--color-sky)", fontWeight: 600 }}>#</span>{" "}
            <span style={{ fontWeight: 600 }}>{info?.channel_name}</span>{" "}
            に招待されています
          </p>
        </div>

        {error && (
          <div style={{ marginTop: 16, borderRadius: 12, background: "rgba(239,68,68,0.1)", padding: 12, fontSize: 14, color: "#ef4444" }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 32 }}>
          {isAuthenticated ? (
            <button
              onClick={handleJoin}
              disabled={joining}
              style={{
                width: "100%", borderRadius: 12, padding: "12px 24px",
                fontSize: 16, fontWeight: 600, color: "#fff",
                background: "var(--color-accent)", border: "none", cursor: "pointer",
                opacity: joining ? 0.5 : 1,
              }}
            >
              {joining ? "参加中..." : "チャンネルに参加する"}
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <a
                href={`/signup?invite_channel=${token}`}
                style={{
                  display: "block", width: "100%", borderRadius: 12, padding: "12px 24px",
                  fontSize: 16, fontWeight: 600, color: "#fff", textAlign: "center",
                  background: "var(--color-accent)", textDecoration: "none",
                }}
              >
                サインアップして参加
              </a>
              <a
                href={`/login?invite_channel=${token}`}
                style={{
                  display: "block", width: "100%", borderRadius: 12, padding: "12px 24px",
                  fontSize: 16, fontWeight: 600, color: "var(--color-foreground)", textAlign: "center",
                  border: "1px solid var(--color-border)", textDecoration: "none",
                }}
              >
                ログインして参加
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
