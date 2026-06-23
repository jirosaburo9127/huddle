"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

const BRANCH_COLORS = [
  { main: "#EF4444", bg: "#FEE2E2", text: "#991B1B" },
  { main: "#3B82F6", bg: "#DBEAFE", text: "#1E3A5F" },
  { main: "#8B5CF6", bg: "#F3E8FF", text: "#4C1D95" },
  { main: "#F97316", bg: "#FFEDD5", text: "#7C2D12" },
  { main: "#10B981", bg: "#D1FAE5", text: "#064E3B" },
  { main: "#EC4899", bg: "#FCE7F3", text: "#831843" },
];

export function ChannelMindmap({ channelId, channelName, onClose }: Props) {
  const supabase = createClient();
  const [nodes, setNodes] = useState<MindmapNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("mindmaps").select("nodes").eq("channel_id", channelId).maybeSingle();
      if (data?.nodes && Array.isArray(data.nodes) && data.nodes.length > 0) setNodes(data.nodes as MindmapNode[]);
      setLoading(false);
    })();
  }, [channelId, supabase]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { alert("認証エラー"); setGenerating(false); return; }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-mindmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ channel_id: channelId, channel_name: channelName }),
      });
      if (!res.ok) { console.error("[mindmap]", res.status); alert("生成に失敗しました"); setGenerating(false); return; }
      const json = await res.json();
      if (Array.isArray(json?.nodes) && json.nodes.length > 0) setNodes(json.nodes);
    } catch { alert("エラーが発生しました"); } finally { setGenerating(false); }
  }, [channelId, channelName, supabase]);

  useEffect(() => { if (!loading && nodes.length === 0) generate(); }, [loading]); // eslint-disable-line

  const saveNodes = useCallback(async (updated: MindmapNode[]) => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("mindmaps").upsert({ channel_id: channelId, nodes: updated, updated_by: user?.id || null, updated_at: new Date().toISOString() }, { onConflict: "channel_id" });
    setSaving(false);
  }, [channelId, supabase]);

  const childrenMap = useMemo(() => {
    const m = new Map<string, MindmapNode[]>();
    for (const n of nodes) { const k = n.parent ?? "__root__"; m.set(k, [...(m.get(k) || []), n]); }
    return m;
  }, [nodes]);

  const root = (childrenMap.get("__root__") || [])[0];
  const branches = root ? (childrenMap.get(root.id) || []) : [];

  function startEdit(n: MindmapNode) { setEditingId(n.id); setEditLabel(n.label); }
  function saveEdit() {
    if (!editingId || !editLabel.trim()) return;
    const u = nodes.map((n) => n.id === editingId ? { ...n, label: editLabel.trim() } : n);
    setNodes(u); setEditingId(null); saveNodes(u);
  }
  function addChild(parentId: string) {
    const label = prompt("ノード名を入力"); if (!label?.trim()) return;
    const u = [...nodes, { id: `n-${Date.now()}`, label: label.trim(), parent: parentId, color: null }];
    setNodes(u); saveNodes(u);
  }
  function deleteNode(id: string) {
    if (id === root?.id) return;
    const del = new Set<string>();
    function collect(nid: string) { del.add(nid); for (const n of nodes) { if (n.parent === nid) collect(n.id); } }
    collect(id);
    const u = nodes.filter((n) => !del.has(n.id)); setNodes(u); saveNodes(u);
  }

  // 共通ノードラベル
  function renderLabel(node: MindmapNode, fontSize: number, fontWeight: number, color: string) {
    if (editingId === node.id) {
      return (
        <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit(); if (e.key === "Escape") setEditingId(null); }}
          onBlur={saveEdit} autoFocus
          className="bg-transparent border-b outline-none w-full text-center"
          style={{ fontSize, fontWeight, color, borderColor: color + "60" }} />
      );
    }
    return <span style={{ fontSize, fontWeight, color, lineHeight: 1.3 }}>{node.label}</span>;
  }

  // ブランチ描画
  function renderBranch(branch: MindmapNode, idx: number, side: "left" | "right") {
    const c = BRANCH_COLORS[idx % BRANCH_COLORS.length];
    const children = childrenMap.get(branch.id) || [];
    const isLeft = side === "left";

    return (
      <div key={branch.id} style={{ display: "flex", flexDirection: isLeft ? "row-reverse" : "row", alignItems: "center", gap: 0, marginBottom: 32 }}>
        {/* 子ノード群（外側） */}
        {children.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: isLeft ? "flex-end" : "flex-start" }}>
            {children.map((child) => {
              const gc = childrenMap.get(child.id) || [];
              return (
                <div key={child.id} style={{ display: "flex", flexDirection: isLeft ? "row-reverse" : "row", alignItems: "center", gap: 0 }}>
                  {/* 孫ノード（最外側） */}
                  {gc.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: isLeft ? "flex-end" : "flex-start" }}>
                      {gc.map((g) => (
                        <div key={g.id} className="group flex items-center gap-1" style={{ flexDirection: isLeft ? "row-reverse" : "row" }}>
                          <div onClick={() => startEdit(g)} className="cursor-pointer px-3 py-1.5 rounded-lg border-2 transition-shadow hover:shadow-sm"
                            style={{ borderColor: c.main + "50", background: "#fff" }}>
                            {renderLabel(g, 12, 500, c.text)}
                          </div>
                          <button onClick={() => deleteNode(g.id)} className="hidden group-hover:block text-muted hover:text-mention p-0.5 shrink-0">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {gc.length > 0 && <div style={{ width: 24, borderTop: `2px dotted ${c.main}40`, flexShrink: 0 }} />}
                  {/* 子ノード本体 */}
                  <div className="group flex items-center gap-1" style={{ flexDirection: isLeft ? "row-reverse" : "row" }}>
                    <div onClick={() => startEdit(child)} className="cursor-pointer px-4 py-2 rounded-xl border-2 transition-shadow hover:shadow-md"
                      style={{ borderColor: c.main, background: c.bg }}>
                      {renderLabel(child, 13, 600, c.text)}
                    </div>
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button onClick={() => addChild(child.id)} className="text-muted hover:text-accent p-0.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg></button>
                      <button onClick={() => deleteNode(child.id)} className="text-muted hover:text-mention p-0.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 接続線 */}
        <div style={{ width: 40, flexShrink: 0, position: "relative" }}>
          <div style={{ borderTop: `3px solid ${c.main}`, width: "100%" }} />
        </div>

        {/* ブランチノード */}
        <div className="group flex items-center gap-1 shrink-0" style={{ flexDirection: isLeft ? "row-reverse" : "row" }}>
          <div onClick={() => startEdit(branch)} className="cursor-pointer px-5 py-3 rounded-2xl transition-shadow hover:shadow-lg"
            style={{ background: c.main, minWidth: 80 }}>
            {renderLabel(branch, 15, 700, "#fff")}
          </div>
          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button onClick={() => addChild(branch.id)} className="text-muted hover:text-accent p-0.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg></button>
            <button onClick={() => deleteNode(branch.id)} className="text-muted hover:text-mention p-0.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        </div>

        {/* 中央への接続線 */}
        <div style={{ width: 50, flexShrink: 0 }}>
          <div style={{ borderTop: `3px dotted ${c.main}60`, width: "100%" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col" style={{ overflow: "hidden" }}>
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0">
        <h2 className="font-bold text-lg flex items-center gap-2">🧠 マインドマップ</h2>
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-muted">保存中...</span>}
          <button onClick={generate} disabled={generating}
            className="text-sm bg-accent/10 text-accent px-3 py-1.5 rounded-lg hover:bg-accent/20 disabled:opacity-50 transition-colors font-medium">
            {generating ? "生成中..." : "🔄 AI再生成"}
          </button>
          <button onClick={onClose} className="p-2 text-muted hover:text-foreground rounded-lg hover:bg-sidebar-hover transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </header>

      {/* マップ本体 */}
      <div className="flex-1 overflow-auto">
        {loading || generating ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted">{generating ? "AIが会話を分析中..." : "読み込み中..."}</p>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-sm text-muted mb-3">マインドマップがありません</p>
            <button onClick={generate} className="text-sm text-accent font-medium">AIで生成する</button>
          </div>
        ) : root ? (
          <div className="flex items-center justify-center min-w-max" style={{ minHeight: "100%", padding: "60px 80px" }}>
            {/* 左ブランチ */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              {branches.filter((_, i) => i % 2 === 0).map((b, i) => renderBranch(b, i * 2, "left"))}
            </div>

            {/* 中央ルート */}
            <div className="flex flex-col items-center shrink-0 mx-4">
              <div onClick={() => startEdit(root)} className="cursor-pointer flex flex-col items-center justify-center"
                style={{
                  width: 150, height: 150, borderRadius: "50%",
                  background: "radial-gradient(circle, #FFFBEB 0%, #FEF3C7 50%, #FDE68A 100%)",
                  border: "4px solid #F59E0B", boxShadow: "0 8px 30px rgba(245,158,11,0.2)",
                }}>
                <div className="text-3xl mb-1">💡</div>
                {renderLabel(root, 14, 800, "#78350F")}
              </div>
              <button onClick={() => addChild(root.id)} className="mt-3 text-xs text-muted hover:text-accent font-medium">+ トピック追加</button>
            </div>

            {/* 右ブランチ */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              {branches.filter((_, i) => i % 2 === 1).map((b, i) => renderBranch(b, i * 2 + 1, "right"))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
