"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task } from "../page";

type ChannelOption = { id: string; name: string; slug: string };
type MemberOption = { user_id: string; display_name: string; avatar_url: string | null };

type Props = {
  task: Task | null; // null = 新規作成
  channels: ChannelOption[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
};

export function TaskModal({ task, channels, currentUserId, onClose, onSaved }: Props) {
  const supabase = createClient();
  const isEdit = !!task;

  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [channelId, setChannelId] = useState(task?.channel_id || (channels.length > 0 ? channels[0].id : ""));
  const [status, setStatus] = useState(task?.status || "todo");
  const [dueDate, setDueDate] = useState(task?.due_date || "");
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set(task?.assignees.map((a) => a.user_id) || []));
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // チャンネルメンバー取得
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("channel_members")
        .select("user_id, profiles(display_name, avatar_url)")
        .eq("channel_id", channelId);
      if (cancelled || !data) return;
      setMembers(data.map((m: Record<string, unknown>) => {
        const p = m.profiles as { display_name: string; avatar_url: string | null } | null;
        return { user_id: m.user_id as string, display_name: p?.display_name || "不明", avatar_url: p?.avatar_url || null };
      }));
    })();
    return () => { cancelled = true; };
  }, [channelId, supabase]);

  async function handleSave() {
    if (!title.trim() || !channelId) return;
    setSaving(true);

    if (isEdit && task) {
      // 更新
      const { error } = await supabase
        .from("tasks")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          status,
          due_date: dueDate || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id);
      if (error) { alert("更新に失敗しました: " + error.message); setSaving(false); return; }

      // 担当者を差し替え
      await supabase.from("task_assignees").delete().eq("task_id", task.id);
      if (assigneeIds.size > 0) {
        await supabase.from("task_assignees").insert(
          Array.from(assigneeIds).map((uid) => ({ task_id: task.id, user_id: uid }))
        );
      }
    } else {
      // 新規作成
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          channel_id: channelId,
          title: title.trim(),
          description: description.trim() || null,
          status,
          due_date: dueDate || null,
          created_by: currentUserId,
        })
        .select("id")
        .single();
      if (error || !data) { alert("作成に失敗しました: " + (error?.message || "")); setSaving(false); return; }

      if (assigneeIds.size > 0) {
        await supabase.from("task_assignees").insert(
          Array.from(assigneeIds).map((uid) => ({ task_id: data.id, user_id: uid }))
        );
      }
    }

    setSaving(false);
    onSaved();
    onClose();
  }

  async function handleDelete() {
    if (!task || deleting) return;
    if (!confirm("このタスクを削除しますか？")) return;
    setDeleting(true);
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) { alert("削除に失敗しました: " + error.message); setDeleting(false); return; }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full sm:max-w-md max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-surface border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <h3 className="text-base font-bold">{isEdit ? "タスクを編集" : "タスクを作成"}</h3>
          <button onClick={onClose} className="p-1 text-muted hover:text-foreground rounded transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* フォーム */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* タイトル */}
          <div>
            <label className="block text-xs text-muted mb-1">タイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
              placeholder="タスクのタイトル"
              autoFocus
            />
          </div>

          {/* 説明 */}
          <div>
            <label className="block text-xs text-muted mb-1">説明（任意）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-20 resize-none rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
              placeholder="詳細な説明"
            />
          </div>

          {/* チャンネル */}
          {!isEdit && (
            <div>
              <label className="block text-xs text-muted mb-1">チャンネル</label>
              <select
                value={channelId}
                onChange={(e) => { setChannelId(e.target.value); setAssigneeIds(new Set()); }}
                className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>#{ch.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* ステータス（編集時のみ） */}
          {isEdit && (
            <div>
              <label className="block text-xs text-muted mb-1">ステータス</label>
              <div className="flex gap-2">
                {([["todo", "未着手"], ["in_progress", "進行中"], ["done", "完了"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStatus(val)}
                    className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                      status === val
                        ? val === "done" ? "border-green-400 bg-green-400/10 text-green-400 font-semibold"
                          : val === "in_progress" ? "border-sky bg-sky/10 text-sky font-semibold"
                          : "border-accent bg-accent/10 text-accent font-semibold"
                        : "border-border text-muted hover:border-border/80"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 期限 */}
          <div>
            <label className="block text-xs text-muted mb-1">期限（任意）</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
            />
          </div>

          {/* 担当者 */}
          <div>
            <label className="block text-xs text-muted mb-1">担当者</label>
            {members.length === 0 ? (
              <p className="text-xs text-muted">メンバーを読み込み中...</p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-input-bg">
                {members.map((m) => (
                  <label key={m.user_id} className="flex items-center gap-2 px-3 py-2 hover:bg-foreground/5 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={assigneeIds.has(m.user_id)}
                      onChange={() => {
                        setAssigneeIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.user_id)) next.delete(m.user_id);
                          else next.add(m.user_id);
                          return next;
                        });
                      }}
                      className="rounded border-border"
                    />
                    {m.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-muted/20 flex items-center justify-center text-[10px] font-bold text-muted">
                        {m.display_name.charAt(0)}
                      </span>
                    )}
                    <span className="text-sm text-foreground truncate">{m.display_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* フッター */}
        <div className="flex items-center gap-2 px-5 py-3 pb-20 sm:pb-3 border-t border-border/50 shrink-0 bg-surface">
          {isEdit && task?.created_by === currentUserId && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-mention hover:text-mention/80 transition-colors mr-auto"
            >
              {deleting ? "削除中..." : "削除"}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors">
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "保存中..." : isEdit ? "保存" : "作成"}
          </button>
        </div>
      </div>
    </div>
  );
}
