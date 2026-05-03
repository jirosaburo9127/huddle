"use client";

// 進行中ページ・決定事項ページのフィルタタブで共通利用する、
// チャンネルをドラッグで並び替え可能な縦型リスト。
// PC サイドバーとモバイルのボトムシート両方から使う。

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export type ChannelFacet = {
  id: string;
  name: string;
  count: number;
};

type Props = {
  items: ChannelFacet[];
  selectedId: string | null;
  totalCount: number;
  onSelect: (id: string | null) => void;
  onReorder: (newOrderIds: string[]) => void;
};

function SortableRow({
  item,
  active,
  onSelect,
}: {
  item: ChannelFacet;
  active: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 rounded-lg ${
        active ? "bg-accent" : "hover:bg-white/[0.04]"
      }`}
    >
      {/* ドラッグハンドル */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="並び替え"
        className={`shrink-0 px-1.5 py-2 cursor-grab active:cursor-grabbing touch-none ${
          active ? "text-white/70" : "text-muted/60"
        }`}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="7" cy="5" r="1.5" />
          <circle cx="13" cy="5" r="1.5" />
          <circle cx="7" cy="10" r="1.5" />
          <circle cx="13" cy="10" r="1.5" />
          <circle cx="7" cy="15" r="1.5" />
          <circle cx="13" cy="15" r="1.5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onSelect}
        className={`flex-1 min-w-0 text-left pr-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
          active ? "text-white" : "text-foreground"
        }`}
      >
        <span className="truncate">#{item.name}</span>
        <span
          className={`shrink-0 text-[11px] tabular-nums ${
            active ? "text-white/80" : "text-muted"
          }`}
        >
          {item.count}
        </span>
      </button>
    </div>
  );
}

export function SortableChannelTabs({
  items,
  selectedId,
  totalCount,
  onSelect,
  onReorder,
}: Props) {
  // PointerSensor: PC マウス用 (5px 動かしたらドラッグ開始)
  // TouchSensor: モバイル用 (200ms 長押しでドラッグ開始、タップとの衝突回避)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = items.slice();
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    onReorder(next.map((i) => i.id));
  }

  return (
    <div className="space-y-1">
      {/* "全て" は固定 (並び替え対象外) */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors flex items-center justify-between gap-2 ${
          selectedId === null
            ? "bg-accent text-white"
            : "text-foreground hover:bg-white/[0.04]"
        }`}
      >
        <span className="truncate">全て</span>
        <span
          className={`shrink-0 text-[11px] tabular-nums ${
            selectedId === null ? "text-white/80" : "text-muted"
          }`}
        >
          {totalCount}
        </span>
      </button>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              active={selectedId === item.id}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

// 並び順を localStorage に保存・復元するためのユーティリティ
const ORDER_KEY_PREFIX = "huddle:channelOrder:";

export function loadChannelOrder(scope: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_KEY_PREFIX + scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveChannelOrder(scope: string, order: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORDER_KEY_PREFIX + scope, JSON.stringify(order));
  } catch {
    // 容量超過などは無視
  }
}

// channelFacets を保存済みの並び順で並び替える。新しいチャンネルは末尾に。
export function applyChannelOrder<T extends { id: string }>(
  facets: T[],
  order: string[]
): T[] {
  if (order.length === 0) return facets;
  const map = new Map(facets.map((f) => [f.id, f]));
  const ordered: T[] = [];
  for (const id of order) {
    const f = map.get(id);
    if (f) {
      ordered.push(f);
      map.delete(id);
    }
  }
  // 残り (まだ並び順に存在しない新規チャンネル) は末尾に
  ordered.push(...Array.from(map.values()));
  return ordered;
}
