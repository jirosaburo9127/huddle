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

const NODE_COLORS = [null, "#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"];

export function ChannelMindmap({ channelId, channelName, onClose }: Props) {
  const supabase = createClient();
  const [nodes, setNodes] = useState<MindmapNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [addingParent, setAddingParent] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState("");
  const [saving, setSaving] = useState(false);

  // DB からマインドマップを取得
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
      if (!token) { alert("認証エラー"); return; }

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-mindmap`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ channel_id: channelId, channel_name: channelName }),
        }
      );

      if (!res.ok) {
        alert("マインドマップの生成に失敗しました");
        return;
      }

      const { nodes: newNodes } = await res.json();
      if (Array.isArray(newNodes) && newNodes.length > 0) {
        setNodes(newNodes);
      }
    } catch {
      alert("生成中にエラーが発生しました");
    } finally {
      setGenerating(false);
    }
  }, [channelId, channelName, supabase]);

  // 初回: データがなければ自動生成
  useEffect(() => {
    if (!loading && nodes.length === 0) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // DBに保存
  const saveNodes = useCallback(async (updated: MindmapNode[]) => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("mindmaps").upsert({
      channel_id: channelId,
      nodes: updated,
      updated_by: user?.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "channel_id" });
    setSaving(false);
  }, [channelId, supabase]);

  // ツリー構造に変換
  const tree = useMemo(() => {
    const childrenMap = new Map<string, MindmapNode[]>();
    for (const n of nodes) {
      const parentKey = n.parent ?? "__root__";
      const list = childrenMap.get(parentKey) || [];
      list.push(n);
      childrenMap.set(parentKey, list);
    }
    return childrenMap;
  }, [nodes]);

  const roots = tree.get("__root__") || [];

  // ノード操作
  function handleEdit(node: MindmapNode) {
    setEditingId(node.id);
    setEditLabel(node.label);
  }

  function saveEdit() {
    if (!editingId || !editLabel.trim()) return;
    const updated = nodes.map((n) => n.id === editingId ? { ...n, label: editLabel.trim() } : n);
    setNodes(updated);
    setEditingId(null);
    saveNodes(updated);
  }

  function addChild() {
    if (!addingParent || !addLabel.trim()) return;
    const newId = `n-${Date.now()}`;
    const updated = [...nodes, { id: newId, label: addLabel.trim(), parent: addingParent, color: null }];
    setNodes(updated);
    setAddingParent(null);
    setAddLabel("");
    saveNodes(updated);
  }

  function deleteNode(id: string) {
    if (id === "root") return;
    // 子ノードも再帰的に削除
    const toDelete = new Set<string>();
    function collect(nodeId: string) {
      toDelete.add(nodeId);
      for (const n of nodes) {
        if (n.parent === nodeId) collect(n.id);
      }
    }
    collect(id);
    const updated = nodes.filter((n) => !toDelete.has(n.id));
    setNodes(updated);
    saveNodes(updated);
  }

  function cycleColor(id: string) {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const idx = NODE_COLORS.indexOf(node.color);
    const next = NODE_COLORS[(idx + 1) % NODE_COLORS.length];
    const updated = nodes.map((n) => n.id === id ? { ...n, color: next } : n);
    setNodes(updated);
    saveNodes(updated);
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ノード描画（再帰）
  function renderNode(node: MindmapNode, depth: number) {
    const children = tree.get(node.id) || [];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const isEditing = editingId === node.id;
    const isAdding = addingParent === node.id;

    return (
      <div key={node.id} style={{ marginLeft: depth > 0 ? (depth === 1 ? 16 : 24) : 0 }}>
        <div className="flex items-center gap-1.5 group py-1 px-1 rounded hover:bg-sidebar-hover transition-colors" style={{ minHeight: 32 }}>
          {/* 展開/折りたたみ */}
          {hasChildren ? (
            <button onClick={() => toggleCollapse(node.id)} className="w-4 h-4 flex items-center justify-center text-muted shrink-0">
              <svg className="w-3 h-3" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0)", transition: "transform 150ms" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {/* カラードット */}
          <button
            onClick={() => cycleColor(node.id)}
            className="w-3 h-3 rounded-full shrink-0 border border-border/50 hover:scale-125 transition-transform"
            style={{ background: node.color || "var(--color-muted)", opacity: node.color ? 1 : 0.3 }}
            title="色を変更"
          />

          {/* ラベル */}
          {isEditing ? (
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit(); if (e.key === "Escape") setEditingId(null); }}
              onBlur={saveEdit}
              className="flex-1 text-sm bg-input-bg border border-border rounded px-2 py-0.5 text-foreground focus:border-accent focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              className="flex-1 text-sm text-foreground cursor-pointer truncate"
              style={{ fontWeight: depth === 0 ? 700 : 400 }}
              onClick={() => hasChildren ? toggleCollapse(node.id) : handleEdit(node)}
            >
              {node.label}
            </span>
          )}

          {/* アクションボタン（ホバーで表示） */}
          {!isEditing && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button onClick={() => { setAddingParent(node.id); setAddLabel(""); }} className="p-0.5 text-muted hover:text-accent" title="子ノード追加">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button onClick={() => handleEdit(node)} className="p-0.5 text-muted hover:text-accent" title="編集">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              {node.id !== "root" && (
                <button onClick={() => deleteNode(node.id)} className="p-0.5 text-muted hover:text-mention" title="削除">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 子ノード追加入力 */}
        {isAdding && (
          <div className="flex items-center gap-2 ml-10 py-1">
            <input
              type="text"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addChild(); if (e.key === "Escape") setAddingParent(null); }}
              placeholder="ノード名を入力"
              className="flex-1 text-sm bg-input-bg border border-border rounded px-2 py-1 text-foreground focus:border-accent focus:outline-none"
              autoFocus
            />
            <button onClick={addChild} className="text-xs text-accent font-medium">追加</button>
            <button onClick={() => setAddingParent(null)} className="text-xs text-muted">取消</button>
          </div>
        )}

        {/* 子ノード（再帰） */}
        {!isCollapsed && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-background lg:static lg:inset-auto lg:z-auto lg:w-[420px] lg:border-l lg:border-border flex flex-col h-full animate-slide-in-right">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 lg:py-0 lg:h-14 border-b border-border bg-header shrink-0">
        <h2 className="font-bold text-base flex items-center gap-2">
          <span>🧠</span>
          マインドマップ
        </h2>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-muted">保存中...</span>}
          <button
            onClick={generate}
            disabled={generating}
            className="text-xs bg-accent/10 text-accent px-2.5 py-1 rounded-lg hover:bg-accent/20 disabled:opacity-50 transition-colors font-medium"
          >
            {generating ? "生成中..." : "AI再生成"}
          </button>
          <button onClick={onClose} className="p-1 text-muted hover:text-foreground rounded transition-colors" title="閉じる">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {/* ボディ */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading || generating ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted">{generating ? "AIが会話を分析中..." : "読み込み中..."}</p>
          </div>
        ) : nodes.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-muted mb-3">マインドマップがありません</p>
            <button onClick={generate} className="text-sm text-accent font-medium">AIで生成する</button>
          </div>
        ) : (
          roots.map((root) => renderNode(root, 0))
        )}
      </div>
    </div>
  );
}
