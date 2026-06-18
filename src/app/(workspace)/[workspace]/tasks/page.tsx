"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { TaskCard } from "./components/task-card";
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
  { key: "todo" as const, label: "未着手", color: "var(--color-muted)" },
  { key: "in_progress" as const, label: "進行中", color: "var(--color-sky)" },
  { key: "done" as const, label: "完了", color: "#22c55e" },
];

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
  const [activeTab, setActiveTab] = useState<"todo" | "in_progress" | "done">("todo");
  const [filterChannel, setFilterChannel] = useState<string>("");
  const [filterMine, setFilterMine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

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

      // チャンネル一覧
      const { data: ws } = await supabase.from("workspaces").select("id").eq("slug", params.workspace).maybeSingle();
      if (!ws || cancelled) return;
      const { data: chData } = await supabase
        .from("channel_members")
        .select("channels(id, name, slug, workspace_id)")
        .eq("user_id", user.id);
      if (chData && !cancelled) {
        type ChWithWs = { id: string; name: string; slug: string; workspace_id: string };
        const chs: Array<{ id: string; name: string; slug: string }> = [];
        for (const r of chData) {
          const ch = (r as Record<string, unknown>).channels as ChWithWs | null;
          if (ch && ch.workspace_id === ws.id) {
            chs.push({ id: ch.id, name: ch.name, slug: ch.slug });
          }
        }
        setChannels(chs);
      }

      // タスク取得
      const { data: taskData } = await supabase.rpc("get_my_tasks", { p_user_id: user.id });
      if (!cancelled && taskData && Array.isArray(taskData)) setTasks(taskData as Task[]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [params.workspace, supabase]);

  // フィルター適用
  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filterChannel) result = result.filter((t) => t.channel_id === filterChannel);
    if (filterMine && currentUserId) result = result.filter((t) => t.assignees.some((a) => a.user_id === currentUserId));
    return result;
  }, [tasks, filterChannel, filterMine, currentUserId]);

  const tasksByStatus = useMemo(() => ({
    todo: filteredTasks.filter((t) => t.status === "todo"),
    in_progress: filteredTasks.filter((t) => t.status === "in_progress"),
    done: filteredTasks.filter((t) => t.status === "done"),
  }), [filteredTasks]);

  // ドラッグ&ドロップ
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);

  function handleDragStart(taskId: string) {
    setDragTaskId(taskId);
  }

  async function handleDrop(newStatus: string) {
    setDragOverCol(null);
    if (!dragTaskId) return;
    const task = tasks.find((t) => t.id === dragTaskId);
    if (!task || task.status === newStatus) { setDragTaskId(null); return; }

    // 楽観的更新
    setTasks((prev) => prev.map((t) => t.id === dragTaskId ? { ...t, status: newStatus as Task["status"] } : t));
    setDragTaskId(null);

    const { error } = await supabase
      .from("tasks")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", dragTaskId);
    if (error) {
      // ロールバック
      setTasks((prev) => prev.map((t) => t.id === dragTaskId ? { ...t, status: task.status } : t));
    }
  }

  // スマホ: タップでステータス変更
  async function cycleStatus(task: Task) {
    const order: Task["status"][] = ["todo", "in_progress", "done"];
    const idx = order.indexOf(task.status);
    const next = order[(idx + 1) % order.length];
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: next } : t));
    await supabase.from("tasks").update({ status: next, updated_at: new Date().toISOString() }).eq("id", task.id);
  }

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-header shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <h1 className="text-base font-bold text-foreground">タスク</h1>
          <span className="text-xs bg-accent/10 text-accent rounded-full px-2 py-0.5">
            {tasks.filter((t) => t.status !== "done").length}
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
        >
          ＋ 新規タスク
        </button>
      </header>

      {/* フィルター */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 shrink-0 overflow-x-auto">
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="rounded-lg border border-border bg-input-bg px-2 py-1 text-xs text-foreground focus:outline-none"
        >
          <option value="">全チャンネル</option>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>#{ch.name}</option>
          ))}
        </select>
        <button
          onClick={() => setFilterMine((v) => !v)}
          className={`rounded-lg px-2 py-1 text-xs border transition-colors ${
            filterMine ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"
          }`}
        >
          自分の担当
        </button>
      </div>

      {/* PC: 3カラムカンバン / スマホ: タブ切り替え */}
      <div className="flex-1 overflow-hidden">
        {isDesktop ? (
          /* PC: 3カラム横並び */
          <div className="flex h-full gap-4 p-4 overflow-x-auto">
            {COLUMNS.map((col) => {
              if (col.key === "done" && !showDone) {
                return (
                  <div key={col.key} className="w-60 shrink-0 flex flex-col">
                    <button
                      onClick={() => setShowDone(true)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-foreground transition-colors"
                    >
                      <span style={{ color: col.color }}>●</span>
                      {col.label}（{tasksByStatus.done.length}）
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                );
              }
              const colTasks = tasksByStatus[col.key];
              return (
                <div
                  key={col.key}
                  className={`w-72 shrink-0 flex flex-col rounded-xl transition-colors ${
                    dragOverCol === col.key ? "bg-accent/5" : "bg-sidebar/50"
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
                >
                  <div className="flex items-center gap-2 px-3 py-2 shrink-0">
                    <span style={{ color: col.color, fontSize: 10 }}>●</span>
                    <span className="text-sm font-semibold text-foreground">{col.label}</span>
                    <span className="text-xs text-muted">{colTasks.length}</span>
                    {col.key === "done" && (
                      <button onClick={() => setShowDone(false)} className="ml-auto text-muted hover:text-foreground">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                    {colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setEditingTask(task)}
                        onDragStart={() => handleDragStart(task.id)}
                      />
                    ))}
                    {colTasks.length === 0 && (
                      <div className="text-xs text-muted text-center py-6">タスクなし</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* スマホ: タブ切り替え */
          <div className="flex flex-col h-full">
            <div className="flex border-b border-border shrink-0">
              {COLUMNS.map((col) => (
                <button
                  key={col.key}
                  onClick={() => setActiveTab(col.key)}
                  className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors relative ${
                    activeTab === col.key ? "text-foreground" : "text-muted"
                  }`}
                >
                  {col.label}（{tasksByStatus[col.key].length}）
                  {activeTab === col.key && (
                    <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full" style={{ background: col.color }} />
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {tasksByStatus[activeTab].map((task) => (
                <div key={task.id} className="flex gap-2">
                  <TaskCard
                    task={task}
                    onClick={() => setEditingTask(task)}
                  />
                  <button
                    onClick={() => cycleStatus(task)}
                    className="shrink-0 w-10 flex items-center justify-center text-muted hover:text-accent transition-colors"
                    title="ステータス変更"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              ))}
              {tasksByStatus[activeTab].length === 0 && (
                <div className="text-center text-muted py-12">
                  <p className="text-sm">タスクなし</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 作成モーダル */}
      {showCreate && currentUserId && (
        <TaskModal
          task={null}
          channels={channels}
          currentUserId={currentUserId}
          onClose={() => setShowCreate(false)}
          onSaved={fetchTasks}
        />
      )}

      {/* 編集モーダル */}
      {editingTask && currentUserId && (
        <TaskModal
          task={editingTask}
          channels={channels}
          currentUserId={currentUserId}
          onClose={() => setEditingTask(null)}
          onSaved={fetchTasks}
        />
      )}
    </div>
  );
}
