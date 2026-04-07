"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

// ファイルサイズ上限: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

type MemberProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type MentionMember = {
  user_id: string;
  profiles: MemberProfile;
};

type Props = {
  channelName?: string;
  onSend: (content: string) => void | Promise<void>;
  placeholder?: string;
  channelId?: string; // ファイルアップロード用
  workspaceId?: string; // メンション用
};

export function MessageInput({ channelName, onSend, placeholder, channelId, workspaceId }: Props) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // メンション関連state
  const [members, setMembers] = useState<MentionMember[]>([]);
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const [isComposing, setIsComposing] = useState(false);

  // WSメンバーを取得
  useEffect(() => {
    if (!workspaceId) return;
    async function fetchMembers() {
      const supabase = createClient();
      const { data } = await supabase
        .from("workspace_members")
        .select("user_id, profiles(id, display_name, avatar_url)")
        .eq("workspace_id", workspaceId);
      if (data) {
        const normalized = data.map((row: { user_id: string; profiles: unknown }) => {
          const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          return { user_id: row.user_id, profiles: p as MemberProfile };
        });
        setMembers(normalized);
      }
    }
    fetchMembers();
  }, [workspaceId]);

  // メンションフィルタリング
  const filteredMentionMembers = useMemo(() => {
    if (!mentionQuery) return members;
    const q = mentionQuery.toLowerCase();
    return members.filter((m) =>
      m.profiles?.display_name?.toLowerCase().includes(q)
    );
  }, [members, mentionQuery]);

  // テキスト変更時のメンション検出
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // IME入力中はサジェストを表示しない
    if (isComposing) return;

    const cursorPos = e.target.selectionStart ?? value.length;
    // カーソル位置から逆方向に@を探す
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex >= 0) {
      // @の前がスペースまたは行頭であることを確認
      const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || atIndex === 0) {
        const query = textBeforeCursor.slice(atIndex + 1);
        // クエリにスペースが含まれていない場合のみサジェスト表示
        if (!query.includes(" ") && !query.includes("\n")) {
          setShowMention(true);
          setMentionQuery(query);
          setMentionStartPos(atIndex);
          setMentionIndex(0);
          return;
        }
      }
    }
    setShowMention(false);
  }, [isComposing]);

  // メンション選択時の挿入
  const insertMention = useCallback((member: MentionMember) => {
    const name = member.profiles.display_name;
    const before = content.slice(0, mentionStartPos);
    const after = content.slice(
      mentionStartPos + 1 + mentionQuery.length // @+クエリ文字列分
    );
    const newContent = `${before}@${name} ${after}`;
    setContent(newContent);
    setShowMention(false);
    setMentionQuery("");

    // カーソルをメンション直後に移動
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = mentionStartPos + name.length + 2; // @+name+space
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos;
        textareaRef.current.focus();
      }
    });
  }, [content, mentionStartPos, mentionQuery]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setContent("");

    // テキストエリアの高さをリセット
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      await onSend(trimmed);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // IME変換中のEnterは無視（日本語入力の確定操作）
    if (e.nativeEvent.isComposing) return;

    // メンションサジェスト表示中のキーボード操作
    if (showMention && filteredMentionMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) =>
          prev < filteredMentionMembers.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) =>
          prev > 0 ? prev - 1 : filteredMentionMembers.length - 1
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentionMembers[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMention(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  // テキストエリアの自動リサイズ
  function handleInput() {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }

  // ファイル選択ハンドラ
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // ファイルサイズチェック
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("ファイルサイズは10MB以下にしてください");
      // input をリセット
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadError(null);
    setUploading(true);

    try {
      const supabase = createClient();
      const path = `${channelId || "general"}/${crypto.randomUUID()}-${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from("chat-files")
        .upload(path, file);

      if (uploadErr) {
        setUploadError(`アップロード失敗: ${uploadErr.message}`);
        return;
      }

      // 公開URLを取得してメッセージとして送信
      const { data: urlData } = supabase.storage
        .from("chat-files")
        .getPublicUrl(path);

      await onSend(urlData.publicUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
      // input をリセット
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="shrink-0 px-4 pb-4 relative">
      {/* アップロードエラー表示 */}
      {uploadError && (
        <div className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 flex items-center justify-between">
          <span>{uploadError}</span>
          <button
            onClick={() => setUploadError(null)}
            className="text-red-400 hover:text-red-300 ml-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* メンションサジェストリスト */}
      {showMention && filteredMentionMembers.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-64 max-h-48 overflow-y-auto rounded-xl bg-sidebar border border-border shadow-xl z-50">
          {filteredMentionMembers.map((member, index) => (
            <button
              key={member.user_id}
              type="button"
              onMouseDown={(e) => {
                // blurを防止してからメンション挿入
                e.preventDefault();
                insertMention(member);
              }}
              className={`flex items-center gap-2 px-3 py-2 text-sm w-full text-left cursor-pointer transition-colors ${
                index === mentionIndex
                  ? "bg-accent/10"
                  : "hover:bg-white/[0.04]"
              }`}
            >
              {member.profiles.avatar_url ? (
                <img
                  src={member.profiles.avatar_url}
                  alt={member.profiles.display_name}
                  className="w-6 h-6 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-medium text-accent">
                    {member.profiles.display_name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <span className="truncate text-foreground">{member.profiles.display_name}</span>
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 rounded-xl border border-border bg-input-bg px-3 py-2"
      >
        {/* ファイル添付ボタン */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 rounded-lg p-2 text-muted hover:text-accent disabled:opacity-50 transition-colors"
          title="ファイルを添付"
        >
          {uploading ? (
            // アップロード中のスピナー
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            // 📎 クリップアイコン
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          )}
        </button>

        {/* 非表示のファイルinput */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.json,.xml"
        />

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={placeholder || (channelName ? `#${channelName} にメッセージを送信` : "メッセージを入力")}
          rows={1}
          maxLength={4000}
          className="flex-1 resize-none bg-transparent text-lg text-foreground placeholder-muted focus:outline-none max-h-[200px]"
        />
        <button
          type="submit"
          disabled={!content.trim()}
          className="shrink-0 rounded-lg bg-accent p-2 text-white hover:bg-accent-hover disabled:opacity-30 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
    </div>
  );
}
