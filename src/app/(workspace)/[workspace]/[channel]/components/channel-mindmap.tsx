"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type MindmapNode = {
  id: string;
  label: string;
  parent: string | null;
  color: string | null;
};

type Props = {
  channelId: string;
  channelName: string;
  onClose: () => void;
};

// ブランチごとの配色
const BRANCH_COLORS = [
  { bg: "#FEE2E2", border: "#EF4444", text: "#DC2626" },
  { bg: "#DBEAFE", border: "#3B82F6", text: "#2563EB" },
  { bg: "#F3E8FF", border: "#8B5CF6", text: "#7C3AED" },
  { bg: "#FFEDD5", border: "#F97316", text: "#EA580C" },
  { bg: "#D1FAE5", border: "#10B981", text: "#059669" },
  { bg: "#FEF3C7", border: "#F59E0B", text: "#D97706" },
];

export function ChannelMindmap({ channelId, channelName, onClose }: Props) {
  const supabase = createClient();
  const [nodes, setNodes] = useState<MindmapNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // DB から取得
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("mindmaps")
        .select("nodes")
        .eq("channel_id", channelId)
        .maybeSingle();
      if (data?.nodes && Array.isArray(data.nodes) && data.nodes.length > 0) {
        setNodes(data.nodes as MindmapNode[]);
      }
      setLoading(false);
    })();
  }, [channelId, supabase]);

  // AI生成
  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { alert("認証エラー"); setGenerating(false); return; }

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-mindmap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ channel_id: channelId, channel_name: channelName }),
        }
      );

      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error("[mindmap] generate failed:", res.status, await res.text().catch(() => ""));
        alert("マインドマップの生成に失敗しました");
        setGenerating(false);
        return;
      }

      const json = await res.json();
      if (Array.isArray(json?.nodes) && json.nodes.length > 0) {
        setNodes(json.nodes);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[mindmap] error:", err);
      alert("生成中にエラーが発生しました");
    } finally {
      setGenerating(false);
    }
  }, [channelId, channelName, supabase]);

  useEffect(() => {
    if (!loading && nodes.length === 0) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // DB保存
  const saveNodes = useCallback(async (updated: MindmapNode[]) => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("mindmaps").upsert({
      channel_id: channelId, nodes: updated, updated_by: user?.id || null, updated_at: new Date().toISOString(),
    }, { onConflict: "channel_id" });
    setSaving(false);
  }, [channelId, supabase]);

  // ツリー構造
  const childrenMap = useMemo(() => {
    const m = new Map<string, MindmapNode[]>();
    for (const n of nodes) {
      const key = n.parent ?? "__root__";
      const list = m.get(key) || [];
      list.push(n);
      m.set(key, list);
    }
    return m;
  }, [nodes]);

  const root = (childrenMap.get("__root__") || [])[0];
  const branches = root ? (childrenMap.get(root.id) || []) : [];

  // ノード操作
  function startEdit(node: MindmapNode) { setEditingId(node.id); setEditLabel(node.label); }
  function saveEdit() {
    if (!editingId || !editLabel.trim()) return;
    const updated = nodes.map((n) => n.id === editingId ? { ...n, label: editLabel.trim() } : n);
    setNodes(updated); setEditingId(null); saveNodes(updated);
  }
  function addChild(parentId: string) {
    const label = prompt("ノード名を入力");
    if (!label?.trim()) return;
    const newId = `n-${Date.now()}`;
    const updated = [...nodes, { id: newId, label: label.trim(), parent: parentId, color: null }];
    setNodes(updated); saveNodes(updated);
  }
  function deleteNode(id: string) {
    if (id === root?.id) return;
    const toDelete = new Set<string>();
    function collect(nid: string) { toDelete.add(nid); for (const n of nodes) { if (n.parent === nid) collect(n.id); } }
    collect(id);
    const updated = nodes.filter((n) => !toDelete.has(n.id));
    setNodes(updated); saveNodes(updated);
  }

  // ブランチ描画（左右共通）
  function renderBranch(branch: MindmapNode, branchIdx: number, side: "left" | "right") {
    const colorScheme = BRANCH_COLORS[branchIdx % BRANCH_COLORS.length];
    const children = childrenMap.get(branch.id) || [];
    const isLeft = side === "left";

    return (
      <div key={branch.id} className="relative" style={{ display: "flex", flexDirection: isLeft ? "row-reverse" : "row", alignItems: "flex-start", gap: 12, marginBottom: 24 }}>
        {/* ブランチノード */}
        <div style={{ flexShrink: 0 }}>
          <div
            className="group flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer transition-shadow hover:shadow-md"
            style={{ background: colorScheme.border, color: "#fff", whiteSpace: "nowrap" }}
            onClick={() => startEdit(branch)}
          >
            {editingId === branch.id ? (
              <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                onBlur={saveEdit} autoFocus className="w-24 text-sm font-bold bg-transparent border-b border-white/50 outline-none text-white" />
            ) : (
              <span className="text-sm font-bold">{branch.label}</span>
            )}
            <div className="hidden group-hover:flex items-center gap-1 shrink-0">
              <button onClick={(e) => { e.stopPropagation(); addChild(branch.id); }} className="text-white/70 hover:text-white"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg></button>
              <button onClick={(e) => { e.stopPropagation(); deleteNode(branch.id); }} className="text-white/70 hover:text-white"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          </div>
        </div>

        {/* 点線コネクタ（中央へ向かう） */}
        <div style={{ width: 40, borderTop: `2px dotted ${colorScheme.border}`, alignSelf: "center", flexShrink: 0 }} />

        {/* 子ノード群 */}
        {children.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: isLeft ? "flex-end" : "flex-start" }}>
            {children.map((child) => {
              const grandchildren = childrenMap.get(child.id) || [];
              return (
                <div key={child.id} style={{ display: "flex", flexDirection: isLeft ? "row-reverse" : "row", alignItems: "flex-start", gap: 8 }}>
                  <div
                    className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all hover:shadow-sm"
                    style={{ border: `2px solid ${colorScheme.border}`, background: colorScheme.bg, whiteSpace: "nowrap" }}
                    onClick={() => startEdit(child)}
                  >
                    {editingId === child.id ? (
                      <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                        onBlur={saveEdit} autoFocus className="w-20 text-xs bg-transparent border-b outline-none" style={{ color: colorScheme.text }} />
                    ) : (
                      <span className="text-xs font-medium" style={{ color: colorScheme.text }}>{child.label}</span>
                    )}
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); addChild(child.id); }} className="text-muted hover:text-accent p-0.5"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg></button>
                      <button onClick={(e) => { e.stopPropagation(); deleteNode(child.id); }} className="text-muted hover:text-mention p-0.5"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                    </div>
                  </div>
                  {grandchildren.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 4 }}>
                      {grandchildren.map((gc) => (
                        <div key={gc.id} className="group flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer hover:bg-sidebar-hover" style={{ flexDirection: isLeft ? "row-reverse" : "row" }} onClick={() => startEdit(gc)}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colorScheme.border, opacity: 0.5 }} />
                          {editingId === gc.id ? (
                            <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                              onBlur={saveEdit} autoFocus className="w-16 text-[11px] bg-transparent border-b outline-none" style={{ color: colorScheme.text }} />
                          ) : (
                            <span className="text-[11px] text-muted whitespace-nowrap">{gc.label}</span>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); deleteNode(gc.id); }} className="hidden group-hover:block text-muted hover:text-mention p-0.5 shrink-0">
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 放射状レイアウト: 左右に分散
  function renderRadialMap() {
    if (!root) return null;
    const leftBranches = branches.filter((_, i) => i % 2 === 0);
    const rightBranches = branches.filter((_, i) => i % 2 === 1);

    return (
      <div ref={containerRef} className="relative w-full flex items-start justify-center gap-0" style={{ minHeight: 500, padding: "40px 16px" }}>
        {/* 左側ブランチ */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", paddingTop: 60 }}>
          {leftBranches.map((b, i) => renderBranch(b, i * 2, "left"))}
        </div>

        {/* 中央ルートノード */}
        <div className="flex flex-col items-center shrink-0" style={{ margin: "0 8px", paddingTop: 20 }}>
          <div
            className="flex items-center justify-center cursor-pointer"
            style={{
              width: 120, height: 120, borderRadius: "50%",
              background: "radial-gradient(circle, #FFF8E1 0%, #FFF3E0 100%)",
              border: "3px solid #FFB74D", boxShadow: "0 4px 20px rgba(255,183,77,0.15)",
            }}
            onClick={() => startEdit(root)}
          >
            <div className="text-center px-2">
              <div className="text-xl mb-0.5">💡</div>
              {editingId === root.id ? (
                <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                  onBlur={saveEdit} autoFocus className="w-full text-center text-xs font-bold bg-transparent border-b border-foreground/30 outline-none" />
              ) : (
                <span className="text-xs font-bold text-foreground leading-tight">{root.label}</span>
              )}
            </div>
          </div>
          <button onClick={() => addChild(root.id)} className="mt-2 text-[10px] text-muted hover:text-accent transition-colors">+ 追加</button>
        </div>

        {/* 右側ブランチ */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", paddingTop: 60 }}>
          {rightBranches.map((b, i) => renderBranch(b, i * 2 + 1, "right"))}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[50] bg-background flex flex-col h-full animate-slide-in-right">
      <header className="flex items-center justify-between px-4 py-3 lg:py-0 lg:h-14 border-b border-border bg-header shrink-0">
        <h2 className="font-bold text-base flex items-center gap-2">🧠 マインドマップ</h2>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-muted">保存中...</span>}
          <button onClick={generate} disabled={generating} className="text-xs bg-accent/10 text-accent px-2.5 py-1 rounded-lg hover:bg-accent/20 disabled:opacity-50 transition-colors font-medium">
            {generating ? "生成中..." : "AI再生成"}
          </button>
          <button onClick={onClose} className="p-1 text-muted hover:text-foreground rounded transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {loading || generating ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted">{generating ? "AIが会話を分析中..." : "読み込み中..."}</p>
          </div>
        ) : nodes.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm text-muted mb-3">マインドマップがありません</p>
            <button onClick={generate} className="text-sm text-accent font-medium">AIで生成する</button>
          </div>
        ) : (
          renderRadialMap()
        )}
      </div>
    </div>
  );
}
