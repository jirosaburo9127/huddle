"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { TaskModal } from "./components/task-modal";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done";
  due_date: string | null;
  sort_order: number;
  channel_id: string;
  message_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  channel: { name: string; slug: string; icon_url: string | null };
  creator: { display_name: string; avatar_url: string | null };
  assignees: Array<{ user_id: string; display_name: string; avatar_url: string | null }>;
};

const COLUMNS = [
  { key: "todo" as const, label: "ToDo", color: "#3B82F6", bg: "rgba(59,130,246,0.06)", border: "rgba(59,130,246,0.25)" },
  { key: "in_progress" as const, label: "進行中", color: "#F59E0B", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.25)" },
  { key: "done" as const, label: "完了", color: "#22C55E", bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.25)" },
];

function formatDue(d: string): string {
  const date = new Date(d + "T00:00:00");
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// YYYY-MM-DD をローカル基準で返す
function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// マイタスクの期限セクション定義
type DueBucket = "overdue" | "today" | "week" | "later" | "none";
const BUCKET_META: Record<DueBucket, { label: string; color: string }> = {
  overdue: { label: "期限切れ", color: "#EF4444" },
  today: { label: "今日", color: "#F59E0B" },
  week: { label: "今週", color: "#3B82F6" },
  later: { label: "それ以降", color: "#8B5CF6" },
  none: { label: "期限なし", color: "#94A3B8" },
};
const BUCKET_ORDER: DueBucket[] = ["overdue", "today", "week", "later", "none"];

export default function TasksPage() {
  const params = useParams<{ workspace: string }>();
  const setSidebarOpen = useMobileNavStore((s) => s.setSidebarOpen);
  const supabase = useMemo(() => createClient(), []);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [channels, setChannels] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStatus, setCreateStatus] = useState<Task["status"]>("todo");
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Task["status"]>("todo");
  // 表示モード: マイタスク（自分中心）/ ボード（チーム全体のカンバン）
  const [view, setView] = useState<"mine" | "board">("mine");
  // マイタスクのフィルタ: 担当（自分がアサイン）/ 依頼（自分が作成）
  const [mineFilter, setMineFilter] = useState<"assigned" | "created">("assigned");
  // 完了セクションを開くか
  const [showDone, setShowDone] = useState(false);

  useEffect(() => { setSidebarOpen(false); }, [setSidebarOpen]);

  const fetchTasks = useCallback(async () => {
    if (!currentUserId) return;
    const { data } = await supabase.rpc("get_my_tasks", { p_user_id: currentUserId });
    if (data && Array.isArray(data)) setTasks(data as Task[]);
  }, [currentUserId, supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setCurrentUserId(user.id);
      const { data: ws } = await supabase.from("workspaces").select("id").eq("slug", params.workspace).maybeSingle();
      if (!ws || cancelled) return;
      const { data: chData } = await supabase.from("channel_members").select("channels(id, name, slug, workspace_id)").eq("user_id", user.id);
      if (chData && !cancelled) {
        type ChWithWs = { id: string; name: string; slug: string; workspace_id: string };
        const chs: Array<{ id: string; name: string; slug: string }> = [];
        for (const r of chData) {
          const ch = (r as Record<string, unknown>).channels as ChWithWs | null;
          if (ch && ch.workspace_id === ws.id) chs.push({ id: ch.id, name: ch.name, slug: ch.slug });
        }
        setChannels(chs);
      }
      const { data: taskData } = await supabase.rpc("get_my_tasks", { p_user_id: user.id });
      if (!cancelled && taskData && Array.isArray(taskData)) setTasks(taskData as Task[]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [params.workspace, supabase]);

  const tasksByStatus = useMemo(() => ({
    todo: tasks.filter((t) => t.status === "todo"),
    in_progress: tasks.filter((t) => t.status === "in_progress"),
    done: tasks.filter((t) => t.status === "done"),
  }), [tasks]);

  async function handleDrop(newStatus: string) {
    setDragOverCol(null);
    if (!dragTaskId) return;
    const task = tasks.find((t) => t.id === dragTaskId);
    if (!task || task.status === newStatus) { setDragTaskId(null); return; }
    setTasks((prev) => prev.map((t) => t.id === dragTaskId ? { ...t, status: newStatus as Task["status"] } : t));
    setDragTaskId(null);
    await supabase.from("tasks").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", dragTaskId);
  }

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const today = ymd(new Date());
  const weekEnd = ymd(new Date(Date.now() + 7 * 86400000));

  // ワンタップで完了/未完了をトグル（マイタスク行のチェックボックス）
  async function toggleComplete(task: Task) {
    const nextStatus: Task["status"] = task.status === "done" ? "todo" : "done";
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    const { error } = await supabase
      .from("tasks")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)));
    }
  }

  // マイタスク: 担当（自分アサイン）/ 依頼（自分作成）でフィルタ
  const mineTasks = useMemo(() => {
    if (!currentUserId) return [];
    return tasks.filter((t) =>
      mineFilter === "assigned"
        ? t.assignees.some((a) => a.user_id === currentUserId)
        : t.created_by === currentUserId
    );
  }, [tasks, mineFilter, currentUserId]);

  // 期限でバケット分け（完了は別枠）
  const mineGrouped = useMemo(() => {
    const groups: Record<DueBucket, Task[]> = { overdue: [], today: [], week: [], later: [], none: [] };
    const done: Task[] = [];
    for (const t of mineTasks) {
      if (t.status === "done") { done.push(t); continue; }
      if (!t.due_date) { groups.none.push(t); continue; }
      if (t.due_date < today) groups.overdue.push(t);
      else if (t.due_date === today) groups.today.push(t);
      else if (t.due_date <= weekEnd) groups.week.push(t);
      else groups.later.push(t);
    }
    return { groups, done };
  }, [mineTasks, today, weekEnd]);

  const mineActiveCount = BUCKET_ORDER.reduce((n, b) => n + mineGrouped.groups[b].length, 0);

  function renderMineRow(task: Task) {
    const isOverdue = task.due_date && task.due_date < today && task.status !== "done";
    const isDone = task.status === "done";
    const otherAssignees = task.assignees.filter((a) => a.user_id !== currentUserId);
    return (
      <div
        key={task.id}
        onClick={() => setEditingTask(task)}
        className="flex items-start gap-3 px-4 py-3 bg-surface border-b border-border/40 cursor-pointer hover:bg-sidebar-hover transition-colors"
      >
        {/* ワンタップ完了チェックボックス */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleComplete(task); }}
          className={`shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all active:scale-90 ${
            isDone ? "bg-green-500 border-green-500" : "border-muted/50 hover:border-green-500"
          }`}
          aria-label={isDone ? "未完了に戻す" : "完了にする"}
        >
          {isDone && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-sm leading-snug mb-1 ${isDone ? "line-through text-muted" : "text-foreground"}`}>
            {task.title}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 進行中バッジ */}
            {task.status === "in_progress" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500">● 進行中</span>
            )}
            {/* チャンネル */}
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              {task.channel.icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={task.channel.icon_url} alt="" className="w-3 h-3 rounded-sm object-cover" />
              ) : "#"}
              {task.channel.name}
            </span>
            {/* 期限 */}
            {task.due_date && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${isOverdue ? "text-red-500" : "text-muted"}`}>
                📅 {formatDue(task.due_date)}
              </span>
            )}
            {/* 依頼者（担当ビュー時、他人が作成したもの） */}
            {mineFilter === "assigned" && task.created_by !== currentUserId && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                {task.creator.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={task.creator.avatar_url} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                ) : null}
                {task.creator.display_name}から
              </span>
            )}
            {/* 担当者（依頼ビュー時、自分以外の担当） */}
            {mineFilter === "created" && otherAssignees.length > 0 && (
              <span className="inline-flex items-center gap-1">
                {otherAssignees.slice(0, 3).map((a) => (
                  a.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={a.user_id} src={a.avatar_url} alt={a.display_name} title={a.display_name} className="w-4 h-4 rounded-full object-cover" />
                  ) : (
                    <span key={a.user_id} title={a.display_name} className="w-4 h-4 rounded-full bg-muted/20 flex items-center justify-center text-[8px] font-bold text-muted">
                      {a.display_name.charAt(0)}
                    </span>
                  )
                ))}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderCard(task: Task) {
    const isOverdue = task.due_date && task.due_date < today && task.status !== "done";
    return (
      <div
        key={task.id}
        draggable={isDesktop}
        onDragStart={() => setDragTaskId(task.id)}
        onClick={() => setEditingTask(task)}
        className="bg-surface border-b border-border/40 px-3 py-3 cursor-pointer hover:bg-sidebar-hover transition-colors"
        style={{ touchAction: "manipulation" }}
      >
        <p className={`text-[13px] font-medium leading-snug mb-2 ${task.status === "done" ? "line-through text-muted" : "text-foreground"}`}>
          {task.title}
        </p>

        {/* チャンネル + 期限 */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted">
            {task.channel.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={task.channel.icon_url} alt="" className="w-3 h-3 rounded-sm object-cover" />
            ) : "#"}
            {task.channel.name}
          </span>
          {task.due_date && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${
              isOverdue ? "text-mention" : "text-muted"
            }`}>
              📅 {formatDue(task.due_date)}
            </span>
          )}
        </div>

        {/* 担当者 */}
        {task.assignees.length > 0 && (
          <div className="flex items-center gap-1">
            {task.assignees.slice(0, 4).map((a) => (
              a.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.user_id} src={a.avatar_url} alt={a.display_name} title={a.display_name} className="w-6 h-6 rounded-full object-cover border-2 border-surface" />
              ) : (
                <span key={a.user_id} title={a.display_name} className="w-6 h-6 rounded-full bg-muted/20 flex items-center justify-center text-[9px] font-bold text-muted border-2 border-surface">
                  {a.display_name.charAt(0)}
                </span>
              )
            ))}
            {task.assignees.length > 4 && (
              <span className="text-[10px] text-muted ml-0.5">+{task.assignees.length - 4}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-bold text-foreground shrink-0">📋 タスク</h1>
          {/* 表示切替: マイタスク / ボード */}
          <div className="flex items-center gap-0.5 rounded-lg bg-input-bg p-0.5">
            {([["mine", "マイタスク"], ["board", "ボード"]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setView(val)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  view === val ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => { setCreateStatus("todo"); setShowCreate(true); }}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新規
        </button>
      </header>

      {/* マイタスク: 自分中心の期限別リスト */}
      {view === "mine" && (
        <div className="flex-1 overflow-y-auto">
          {/* フィルタ: 担当 / 依頼 */}
          <div className="flex sticky top-0 z-10 bg-background border-b border-border">
            {([["assigned", "担当"], ["created", "依頼した"]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setMineFilter(val)}
                className="flex-1 py-2.5 text-center relative"
              >
                <span className={`text-sm font-medium ${mineFilter === val ? "text-foreground" : "text-muted"}`}>
                  {label}
                </span>
                {mineFilter === val && (
                  <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-accent" />
                )}
              </button>
            ))}
          </div>

          {mineActiveCount === 0 && mineGrouped.done.length === 0 ? (
            <div className="text-center py-16 px-6">
              <p className="text-4xl mb-3">🌱</p>
              <p className="text-sm text-muted">
                {mineFilter === "assigned" ? "あなたに割り当てられたタスクはありません" : "あなたが依頼したタスクはありません"}
              </p>
              <p className="text-xs text-muted/70 mt-2">メッセージの「タスク」ボタンからも作成できます</p>
            </div>
          ) : (
            <div className="pb-24">
              {BUCKET_ORDER.map((bucket) => {
                const list = mineGrouped.groups[bucket];
                if (list.length === 0) return null;
                const meta = BUCKET_META[bucket];
                return (
                  <div key={bucket}>
                    <div className="flex items-center gap-2 px-4 pt-4 pb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                      <span className="text-xs font-bold" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-xs text-muted">{list.length}</span>
                    </div>
                    {list.map(renderMineRow)}
                  </div>
                );
              })}

              {/* 完了（折りたたみ） */}
              {mineGrouped.done.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowDone((v) => !v)}
                    className="flex items-center gap-2 px-4 pt-4 pb-1.5 w-full"
                  >
                    <svg className={`w-3 h-3 text-muted transition-transform ${showDone ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-bold text-muted">完了</span>
                    <span className="text-xs text-muted">{mineGrouped.done.length}</span>
                  </button>
                  {showDone && mineGrouped.done.map(renderMineRow)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ボード: チーム全体のカンバン（従来） */}
      {view === "board" && (
      <div className="flex-1 overflow-hidden">
        {isDesktop ? (
          <div className="flex h-full gap-0 overflow-x-auto">
            {COLUMNS.map((col) => {
              const colTasks = tasksByStatus[col.key];
              return (
                <div
                  key={col.key}
                  className="flex-1 min-w-0 flex flex-col overflow-hidden transition-colors border-r border-border/30 last:border-r-0"
                  style={{
                    background: dragOverCol === col.key ? col.bg : "transparent",
                    borderTop: `3px solid ${col.color}`,
                  }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
                >
                  {/* カラムヘッダー */}
                  <div className="flex items-center justify-between px-3 py-2.5 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: col.color }}>{col.label}</span>
                      <span className="text-xs text-muted font-medium">{colTasks.length}</span>
                    </div>
                    <button
                      onClick={() => { setCreateStatus(col.key); setShowCreate(true); }}
                      className="text-muted hover:text-foreground transition-colors"
                      title="タスクを追加"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>

                  {/* カードリスト */}
                  <div className="flex-1 overflow-y-auto">
                    {colTasks.map(renderCard)}
                    {colTasks.length === 0 && (
                      <button
                        onClick={() => { setCreateStatus(col.key); setShowCreate(true); }}
                        className="w-full py-8 text-xs text-muted hover:text-accent text-center transition-colors"
                      >
                        + タスクを追加
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* スマホ: タブ */
          <div className="flex flex-col h-full">
            <div className="flex shrink-0 border-b border-border">
              {COLUMNS.map((col) => (
                <button
                  key={col.key}
                  onClick={() => setActiveTab(col.key)}
                  className="flex-1 py-3 text-center relative"
                >
                  <span className={`text-sm font-medium ${activeTab === col.key ? "text-foreground" : "text-muted"}`}>
                    {col.label} {tasksByStatus[col.key].length > 0 && <span className="text-xs">({tasksByStatus[col.key].length})</span>}
                  </span>
                  {activeTab === col.key && (
                    <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full" style={{ background: col.color }} />
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {tasksByStatus[activeTab].map(renderCard)}
              {tasksByStatus[activeTab].length === 0 && (
                <div className="text-center py-12">
                  <p className="text-sm text-muted mb-3">タスクなし</p>
                  <button
                    onClick={() => { setCreateStatus(activeTab); setShowCreate(true); }}
                    className="text-sm text-accent font-medium"
                  >
                    + タスクを追加
                  </button>
                </div>
              )}
            </div>
            {/* スマホ FAB */}
            <button
              onClick={() => { setCreateStatus(activeTab); setShowCreate(true); }}
              className="fixed bottom-20 right-4 w-12 h-12 rounded-full bg-accent text-white shadow-lg flex items-center justify-center lg:hidden z-30 active:scale-90 transition-transform"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        )}
      </div>
      )}

      {showCreate && currentUserId && (
        <TaskModal task={null} channels={channels} currentUserId={currentUserId} defaultStatus={createStatus} onClose={() => setShowCreate(false)} onSaved={fetchTasks} />
      )}
      {editingTask && currentUserId && (
        <TaskModal task={editingTask} channels={channels} currentUserId={currentUserId} onClose={() => setEditingTask(null)} onSaved={fetchTasks} />
      )}
    </div>
  );
}
