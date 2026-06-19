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

  const today = new Date().toISOString().slice(0, 10);

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
        <h1 className="text-lg font-bold text-foreground">📋 タスクボード</h1>
      </header>

      {/* PC: 横スクロールカンバン / スマホ: タブ切り替え */}
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

      {showCreate && currentUserId && (
        <TaskModal task={null} channels={channels} currentUserId={currentUserId} defaultStatus={createStatus} onClose={() => setShowCreate(false)} onSaved={fetchTasks} />
      )}
      {editingTask && currentUserId && (
        <TaskModal task={editingTask} channels={channels} currentUserId={currentUserId} onClose={() => setEditingTask(null)} onSaved={fetchTasks} />
      )}
    </div>
  );
}
