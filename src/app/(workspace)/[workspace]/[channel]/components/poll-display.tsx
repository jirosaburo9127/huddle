"use client";

// メッセージに紐づく投票の表示・投票・締切
// - 選択肢ごとに投票数と割合を表示
// - 自分が投票した選択肢はハイライト
// - 締切/クローズ済みは読み取り専用
// - 締切後に最多票の選択肢を「決定事項」化するボタン

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresInsertPayload, RealtimePostgresDeletePayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";

type Poll = {
  id: string;
  message_id: string;
  channel_id: string;
  created_by: string;
  options: string[];
  allow_multiple: boolean;
  is_closed: boolean;
  closes_at: string | null;
  closed_at: string | null;
  created_at: string;
};

type Vote = {
  id: string;
  poll_id: string;
  user_id: string;
  option_index: number;
};

type Props = {
  messageId: string;
  currentUserId: string;
  onMarkDecision?: (messageId: string) => void;
};

export function PollDisplay({ messageId, currentUserId, onMarkDecision }: Props) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // 1分ごとに再描画して締切表示を更新
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // 初回フェッチ + Realtime購読
  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    async function fetchPoll() {
      const { data: pollData } = await supabase
        .from("polls")
        .select("*")
        .eq("message_id", messageId)
        .maybeSingle();
      if (!mounted) return;
      if (!pollData) {
        setPoll(null);
        setLoading(false);
        return;
      }
      // options は jsonb で来るので型を調整
      const p = pollData as unknown as Poll;
      setPoll(p);

      const { data: voteData } = await supabase
        .from("poll_votes")
        .select("*")
        .eq("poll_id", p.id);
      if (!mounted) return;
      setVotes((voteData as Vote[]) || []);
      setLoading(false);
    }

    fetchPoll();

    // Realtime 購読 (メッセージ単位)
    let pollChannel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      // poll を取得してから votes を購読する必要があるので、非同期的にセットアップ
      const { data: pollRow } = await supabase
        .from("polls")
        .select("id")
        .eq("message_id", messageId)
        .maybeSingle();
      if (!pollRow || !mounted) return;
      const pollId = (pollRow as { id: string }).id;

      pollChannel = supabase
        .channel(`poll-${pollId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "poll_votes",
            filter: `poll_id=eq.${pollId}`,
          },
          (payload: RealtimePostgresInsertPayload<Vote>) => {
            setVotes((prev) => {
              if (prev.some((v) => v.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "poll_votes",
            filter: `poll_id=eq.${pollId}`,
          },
          (payload: RealtimePostgresDeletePayload<Vote>) => {
            const oldId = (payload.old as { id?: string }).id;
            if (!oldId) return;
            setVotes((prev) => prev.filter((v) => v.id !== oldId));
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "polls",
            filter: `id=eq.${pollId}`,
          },
          (payload: RealtimePostgresUpdatePayload<Poll>) => {
            setPoll((prev) =>
              prev ? { ...prev, ...(payload.new as Poll) } : prev
            );
          }
        )
        .subscribe();
    })();

    return () => {
      mounted = false;
      if (pollChannel) {
        supabase.removeChannel(pollChannel);
      }
    };
  }, [messageId]);

  // 締切過ぎているか
  const isPastDeadline = useMemo(() => {
    if (!poll?.closes_at) return false;
    return new Date(poll.closes_at).getTime() <= nowTick;
  }, [poll?.closes_at, nowTick]);

  const isActive = poll && !poll.is_closed && !isPastDeadline;

  // 集計
  const { counts, totalVoters, myVotes } = useMemo(() => {
    const counts = new Map<number, number>();
    const voterSet = new Set<string>();
    const my: number[] = [];
    for (const v of votes) {
      counts.set(v.option_index, (counts.get(v.option_index) || 0) + 1);
      voterSet.add(v.user_id);
      if (v.user_id === currentUserId) my.push(v.option_index);
    }
    return { counts, totalVoters: voterSet.size, myVotes: my };
  }, [votes, currentUserId]);

  // 最多票の選択肢を取得
  const topOption = useMemo(() => {
    if (!poll) return null;
    let maxCount = 0;
    let topIdx = -1;
    for (let i = 0; i < poll.options.length; i++) {
      const c = counts.get(i) || 0;
      if (c > maxCount) {
        maxCount = c;
        topIdx = i;
      }
    }
    if (topIdx < 0) return null;
    return { index: topIdx, label: poll.options[topIdx], count: maxCount };
  }, [poll, counts]);

  const handleVote = useCallback(
    async (optionIdx: number) => {
      if (!poll || voting || !isActive) return;
      setVoting(true);
      // 楽観的更新
      const supabase = createClient();
      const prevVotes = votes;
      const nextVotes: Vote[] = (() => {
        // 単一選択・複数選択ともにトグル動作:
        // 選択済みをタップ → 投票解除、未選択をタップ → 投票/変更
        const mine = votes.filter((v) => v.user_id === currentUserId);
        const existing = mine.find((v) => v.option_index === optionIdx);
        if (poll.allow_multiple) {
          if (existing) {
            return votes.filter((v) => v.id !== existing.id);
          }
          return [
            ...votes,
            {
              id: `tmp-${Date.now()}`,
              poll_id: poll.id,
              user_id: currentUserId,
              option_index: optionIdx,
            },
          ];
        }
        // 単一選択: 同じ選択肢をタップ → 投票解除 / 別をタップ → 変更
        const withoutMine = votes.filter((v) => v.user_id !== currentUserId);
        if (existing) {
          // 同じ選択肢をタップ → 投票解除
          return withoutMine;
        }
        return [
          ...withoutMine,
          {
            id: `tmp-${Date.now()}`,
            poll_id: poll.id,
            user_id: currentUserId,
            option_index: optionIdx,
          },
        ];
      })();
      setVotes(nextVotes);

      // 現在の自分の選択肢から最終的に送る配列を決定
      // 複数選択で既存があれば削除だけ、無ければ追加
      const finalIndices = nextVotes
        .filter((v) => v.user_id === currentUserId)
        .map((v) => v.option_index);

      const { error } = await supabase.rpc("cast_poll_vote", {
        p_poll_id: poll.id,
        p_option_indices: finalIndices,
      });

      if (error) {
        // ロールバック
        setVotes(prevVotes);
        alert("投票に失敗しました: " + error.message);
      }
      setVoting(false);
    },
    [poll, votes, voting, currentUserId, isActive]
  );

  const handleClose = useCallback(async () => {
    if (!poll) return;
    if (!confirm("この投票を締め切りますか？")) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("close_poll", { p_poll_id: poll.id });
    if (error) {
      alert("締切に失敗しました: " + error.message);
    }
  }, [poll]);

  if (loading) return null;
  if (!poll) return null;

  return (
    <div className="mt-2 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs font-semibold text-accent uppercase tracking-wider">
          投票
          {poll.allow_multiple && (
            <span className="ml-1 text-[10px] text-muted normal-case">(複数選択可)</span>
          )}
        </span>
        <span className="ml-auto text-[11px] text-muted">
          {totalVoters}人が投票
        </span>
      </div>

      <div className="space-y-1.5">
        {poll.options.map((opt, idx) => {
          const count = counts.get(idx) || 0;
          const percent = totalVoters > 0 ? (count / totalVoters) * 100 : 0;
          const isMyChoice = myVotes.includes(idx);
          const isTop = topOption?.index === idx && count > 0;

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleVote(idx)}
              disabled={!isActive || voting}
              className={`relative w-full rounded-lg border px-3 py-2 text-left overflow-hidden transition-colors ${
                isMyChoice
                  ? "border-accent bg-accent/10"
                  : "border-border bg-background/50 hover:border-accent/40"
              } ${!isActive ? "cursor-default" : "cursor-pointer"}`}
            >
              {/* 進捗バー */}
              <div
                className={`absolute inset-y-0 left-0 ${
                  isMyChoice ? "bg-accent/20" : "bg-white/[0.04]"
                }`}
                style={{ width: `${percent}%` }}
                aria-hidden="true"
              />
              <div className="relative flex items-start justify-between gap-2 text-[13px]">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  {isMyChoice && (
                    <svg className="w-3.5 h-3.5 shrink-0 text-accent mt-[3px]" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span className={`break-words whitespace-pre-wrap min-w-0 ${isMyChoice ? "font-semibold text-foreground" : "text-foreground"}`}>
                    {opt}
                  </span>
                  {isTop && !isActive && (
                    <span className="shrink-0 text-[10px] font-bold text-accent uppercase mt-[3px]">
                      👑 最多
                    </span>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2 text-muted mt-[1px]">
                  <span className="text-[11px]">{count}票</span>
                  <span className="text-[11px] tabular-nums">{Math.round(percent)}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* フッター */}
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
        <div className="text-muted">
          {poll.is_closed ? (
            <span>締め切られました</span>
          ) : isPastDeadline ? (
            <span>締切を過ぎました</span>
          ) : poll.closes_at ? (
            <span>締切: {new Date(poll.closes_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          ) : (
            <span>締切なし</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isActive && (
            <button
              type="button"
              onClick={handleClose}
              className="px-2 py-1 rounded-md text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            >
              締め切る
            </button>
          )}
          {!isActive && topOption && onMarkDecision && (
            <button
              type="button"
              onClick={() => onMarkDecision(messageId)}
              className="px-2 py-1 rounded-md text-accent font-semibold hover:bg-accent/10 transition-colors"
            >
              決定事項にする
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
