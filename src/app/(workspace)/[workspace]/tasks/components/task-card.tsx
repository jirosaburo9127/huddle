"use client";

import type { Task } from "../page";

type Props = {
  task: Task;
  onClick: () => void;
  onDragStart?: (e: React.DragEvent) => void;
};

export function TaskCard({ task, onClick, onDragStart }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = task.due_date && task.due_date < today && task.status !== "done";
  const isToday = task.due_date === today;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="bg-surface border border-border rounded-xl p-3 cursor-pointer hover:border-accent/30 transition-colors active:scale-[0.98]"
      style={{ touchAction: "manipulation" }}
    >
      {/* タイトル */}
      <p className="text-sm font-semibold text-foreground line-clamp-2">{task.title}</p>

      {/* チャンネル */}
      <div className="flex items-center gap-1 mt-1.5">
        {task.channel.icon_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={task.channel.icon_url} alt="" className="w-3.5 h-3.5 rounded-sm object-cover" />
        ) : (
          <span className="text-[11px] text-muted">#</span>
        )}
        <span className="text-[11px] text-muted truncate">{task.channel.name}</span>
      </div>

      {/* 下部: 担当者 + 期限 */}
      <div className="flex items-center justify-between mt-2">
        {/* 担当者アバター */}
        <div className="flex -space-x-1.5">
          {task.assignees.slice(0, 3).map((a) => (
            a.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={a.user_id} src={a.avatar_url} alt={a.display_name} className="w-5 h-5 rounded-full object-cover border border-surface" />
            ) : (
              <span key={a.user_id} className="w-5 h-5 rounded-full bg-muted/20 flex items-center justify-center text-[8px] font-bold text-muted border border-surface">
                {a.display_name.charAt(0)}
              </span>
            )
          ))}
          {task.assignees.length > 3 && (
            <span className="w-5 h-5 rounded-full bg-muted/10 flex items-center justify-center text-[8px] text-muted border border-surface">
              +{task.assignees.length - 3}
            </span>
          )}
        </div>

        {/* 期限 */}
        {task.due_date && (
          <span className={`text-[11px] font-medium ${
            isOverdue ? "text-mention" : isToday ? "text-yellow-500" : "text-muted"
          }`}>
            {(() => {
              const d = new Date(task.due_date + "T00:00:00");
              return `${d.getMonth() + 1}/${d.getDate()}`;
            })()}
          </span>
        )}
      </div>
    </div>
  );
}
