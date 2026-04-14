"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  channelId: string;
  onClose: () => void;
};

export function CreatePollModal({ channelId, onClose }: Props) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  // 締切: 未入力ならなし (= 手動で閉じる必要がある)
  const [closesAt, setClosesAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function addOption() {
    if (options.length >= 6) return;
    setOptions((prev) => [...prev, ""]);
  }

  function removeOption(idx: number) {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateOption(idx: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const q = question.trim();
    if (!q) {
      setError("質問を入力してください");
      return;
    }
    const cleanedOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (cleanedOptions.length < 2) {
      setError("選択肢は2つ以上入力してください");
      return;
    }

    // 締切のバリデーション (指定されていれば現在より未来でないとダメ)
    let closesAtIso: string | null = null;
    if (closesAt) {
      const dt = new Date(closesAt);
      if (Number.isNaN(dt.getTime())) {
        setError("締切の日時が不正です");
        return;
      }
      if (dt.getTime() <= Date.now()) {
        setError("締切は現在より未来の日時を設定してください");
        return;
      }
      closesAtIso = dt.toISOString();
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: rpcErr } = await supabase.rpc("create_poll", {
        p_channel_id: channelId,
        p_question: q,
        p_options: cleanedOptions,
        p_allow_multiple: allowMultiple,
        p_closes_at: closesAtIso,
      });
      if (rpcErr) {
        setError("作成に失敗しました: " + rpcErr.message);
        return;
      }
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl bg-sidebar border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <h3 className="text-base font-bold">投票を作成</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted hover:text-foreground rounded transition-colors"
            aria-label="閉じる"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4" id="create-poll-form">
          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>
          )}

          <div>
            <label className="block text-xs text-muted mb-1">質問</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
              maxLength={200}
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
              placeholder="例: 来週のミーティングはいつにする？"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">選択肢 (2〜6個)</label>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => updateOption(idx, e.target.value)}
                    maxLength={100}
                    className="flex-1 rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
                    placeholder={`選択肢 ${idx + 1}`}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(idx)}
                      className="p-1.5 text-muted hover:text-mention transition-colors"
                      aria-label="選択肢を削除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              {options.length < 6 && (
                <button
                  type="button"
                  onClick={addOption}
                  className="text-xs text-accent hover:underline"
                >
                  + 選択肢を追加
                </button>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowMultiple}
              onChange={(e) => setAllowMultiple(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-muted">複数選択を許可する</span>
          </label>

          <div>
            <label className="block text-xs text-muted mb-1">
              締切 (任意)
            </label>
            <input
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted">
              指定しない場合は手動で「投票を締め切る」を押すまで有効です
            </p>
          </div>
        </form>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border/50 shrink-0 bg-sidebar">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            form="create-poll-form"
            disabled={loading || !question.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {loading ? "作成中..." : "投票を作成"}
          </button>
        </div>
      </div>
    </div>
  );
}
