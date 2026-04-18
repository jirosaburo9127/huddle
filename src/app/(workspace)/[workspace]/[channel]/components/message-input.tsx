"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { verifyFileMagicBytes } from "@/lib/file-validation";
import { scanForSensitiveData } from "@/lib/dlp-scan";
import type { MessageWithProfile } from "@/lib/supabase/types";

// ファイルサイズ上限: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// 許可するMIMEタイプ
// SVG はスクリプト埋め込み可能で XSS ベクトルなので除外する
const ALLOWED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
  "application/json", "application/xml", "text/xml",
];

// ブロックする危険な拡張子
const BLOCKED_EXTENSIONS = [
  ".exe", ".sh", ".bat", ".cmd", ".com", ".msi",
  ".js", ".py", ".rb", ".php", ".ps1", ".vbs",
  ".scr", ".pif", ".hta", ".cpl", ".jar", ".wsf",
];

// ファイル名のサニタイズ
// Supabase Storageのオブジェクトキーは非ASCII文字（日本語など）を許容しないため、
// ASCII英数字・ハイフン・アンダースコア・ドット以外は全て"_"に置換する。
function sanitizeFileName(name: string): string {
  // 拡張子を分離（最後の "." 以降）
  const lastDot = name.lastIndexOf(".");
  const base = lastDot >= 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot >= 0 ? name.slice(lastDot) : "";

  const safeBase = base
    .replace(/[^a-zA-Z0-9._-]/g, "_") // 非ASCII・記号を全て"_"に
    .replace(/_+/g, "_")               // 連続した"_"を1つに
    .replace(/^[._]+/, "")             // 先頭のドット・アンダースコアを除去
    .slice(0, 100);                    // 長さ制限

  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);

  // baseが空になってしまった場合のフォールバック
  return (safeBase || "file") + safeExt;
}

type MemberProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type MentionMember = {
  user_id: string;
  profiles: MemberProfile;
};

export type MentionPayload = {
  userIds: string[]; // 明示的に指定されたユーザーメンション
  broadcast: "here" | "channel" | null; // @here / @channel 特殊メンション
};

type SendOptions = {
  isDecision?: boolean;
};

type Props = {
  channelName?: string;
  onSend: (content: string, mentions: MentionPayload, options?: SendOptions) => void | Promise<void>;
  placeholder?: string;
  channelId?: string; // ファイルアップロード用
  workspaceId?: string; // メンション用
  onCreatePoll?: () => void; // 投票作成モーダルを開くコールバック
  replyTo?: MessageWithProfile | null; // Chatwork風インライン返信の対象
  onCancelReply?: () => void;
};

export function MessageInput({ channelName, onSend, placeholder, channelId, workspaceId, onCreatePoll, replyTo, onCancelReply }: Props) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sendAsDecision, setSendAsDecision] = useState(false);
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

  // 常時表示の「@」ピル方式メンション
  // チャットワークの To のような使い方: 入力前に宛先を選んでおくと
  // 本文送信時に自動で先頭に @name が付く。IME 確定なしで使える。
  type PillMention =
    | { kind: "user"; id: string; label: string }
    | { kind: "broadcast"; type: "here" | "channel" };
  const [pillMentions, setPillMentions] = useState<PillMention[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const mentionPickerRef = useRef<HTMLDivElement>(null);

  // 音声入力 (Capacitor: ネイティブプラグイン / Web: Web Speech API)
  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  async function toggleVoiceInput() {
    if (isListening) {
      // 停止
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) {
          const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
          await SpeechRecognition.stop();
        } else {
          recognitionRef.current?.stop();
        }
      } catch {
        recognitionRef.current?.stop();
      }
      setIsListening(false);
      setContent((prev) => prev.replace(/\u200B/g, ""));
      return;
    }

    // Capacitor ネイティブ判定
    let isNative = false;
    try {
      const { Capacitor } = await import("@capacitor/core");
      isNative = Capacitor.isNativePlatform();
    } catch {
      // Capacitor未インストール環境
    }

    if (isNative) {
      // ネイティブ音声認識 (iOS)
      try {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
        const perm = await SpeechRecognition.requestPermissions();
        if (perm.speechRecognition !== "granted") {
          alert("音声認識の権限を許可してください");
          return;
        }
        setIsListening(true);
        const result = await SpeechRecognition.start({
          language: "ja-JP",
          partialResults: false,
          popup: false,
        });
        setIsListening(false);
        if (result.matches && result.matches.length > 0) {
          setContent((prev) => prev + result.matches![0]);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
          }
        }
      } catch {
        setIsListening(false);
      }
    } else {
      // Web Speech API (ブラウザ)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const SpeechRecognitionClass = w?.SpeechRecognition || w?.webkitSpeechRecognition;
      if (!SpeechRecognitionClass) {
        alert("このブラウザは音声入力に対応していません");
        return;
      }

      const recognition = new SpeechRecognitionClass();
      recognition.lang = "ja-JP";
      recognition.interimResults = true;
      recognition.continuous = true;
      recognitionRef.current = recognition;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setContent((prev) => {
          const base = prev.replace(/\u200B[\s\S]*$/, "");
          return base + "\u200B" + transcript;
        });
      };

      recognition.onend = () => {
        setIsListening(false);
        setContent((prev) => prev.replace(/\u200B/g, ""));
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
        setContent((prev) => prev.replace(/\u200B/g, ""));
      };

      recognition.start();
      setIsListening(true);
    }
  }

  // ペースト/ドロップされた添付ファイルの保留キュー
  // アップロードは即時だが「送信」ボタンを押すまで実送信はしない
  type PendingAttachment = {
    url: string;
    name: string;
    type: string;
    isImage: boolean;
  };
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  // WSメンバーを取得
  useEffect(() => {
    if (!workspaceId) return;
    async function fetchMembers() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("workspace_members")
        .select("user_id, profiles(id, display_name, avatar_url)")
        .eq("workspace_id", workspaceId);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[mention] workspace_members fetch failed:", error);
        return;
      }
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

  // ピル方式の候補リスト（ピッカー内の検索）
  const pickerCandidates = useMemo(() => {
    const q = pickerQuery.toLowerCase().trim();
    const list = members.filter((m) => {
      if (!m.profiles?.display_name) return false;
      if (pillMentions.some((p) => p.kind === "user" && p.id === m.user_id)) return false;
      if (!q) return true;
      return m.profiles.display_name.toLowerCase().includes(q);
    });
    return list;
  }, [members, pillMentions, pickerQuery]);

  const hasBroadcastChannel = pillMentions.some((p) => p.kind === "broadcast" && p.type === "channel");

  function addUserPill(member: MentionMember) {
    setPillMentions((prev) => {
      if (prev.some((p) => p.kind === "user" && p.id === member.user_id)) return prev;
      return [...prev, { kind: "user", id: member.user_id, label: member.profiles.display_name }];
    });
    setPickerQuery("");
  }

  function addBroadcastPill(type: "here" | "channel") {
    setPillMentions((prev) => {
      if (prev.some((p) => p.kind === "broadcast" && p.type === type)) return prev;
      return [...prev, { kind: "broadcast", type }];
    });
    setShowMentionPicker(false);
  }

  function removePill(idx: number) {
    setPillMentions((prev) => prev.filter((_, i) => i !== idx));
  }

  // ピッカー外クリックで閉じる
  useEffect(() => {
    if (!showMentionPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        mentionPickerRef.current &&
        !mentionPickerRef.current.contains(e.target as Node)
      ) {
        setShowMentionPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMentionPicker]);

  // テキスト変更時のメンション検出
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // IME入力中でも @ の検出は行う。
    // 日本語IMEで変換中の中間文字はメンショントリガーにならないが、
    // `@` 自体はIME外で確定入力されるため、isComposing に関係なく検出すべき。
    // （以前は isComposing で全体を early return していたが、モバイルの日本語キーボードで
    //  @を入力してもサジェストが出ない問題を引き起こしていた）

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
  // 表示名に含まれる半角スペースは NBSP (U+00A0) に置換して 1 トークン扱いにする。
  // 見た目は通常の空白と同じだが、正規表現では \S と同等扱いでき、
  // 「@奥 純香」のような多語メンションを後段で正しく検出できる。
  const insertMention = useCallback((member: MentionMember) => {
    const displayName = member.profiles.display_name;
    const nameForMention = displayName.replace(/ /g, "\u00A0");
    const before = content.slice(0, mentionStartPos);
    const after = content.slice(
      mentionStartPos + 1 + mentionQuery.length // @+クエリ文字列分
    );
    const newContent = `${before}@${nameForMention} ${after}`;
    setContent(newContent);
    setShowMention(false);
    setMentionQuery("");

    // カーソルをメンション直後に移動
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = mentionStartPos + nameForMention.length + 2; // @+name+space
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos;
        textareaRef.current.focus();
      }
    });
  }, [content, mentionStartPos, mentionQuery]);

  // 送信時のメンション抽出: 本文中の @<display_name> を走査し、
  // workspace members と照合してユーザーID集合を作る。@here / @channel も判定。
  function extractMentions(text: string): MentionPayload {
    const userIds = new Set<string>();
    let broadcast: "here" | "channel" | null = null;

    if (/(^|\s)@here(\s|$)/.test(text)) broadcast = "here";
    // @All (新しい表記) または @channel (後方互換) のどちらも channel ブロードキャスト扱い
    else if (/(^|\s)@All(\s|$)/.test(text)) broadcast = "channel";
    else if (/(^|\s)@channel(\s|$)/.test(text)) broadcast = "channel";

    // 長い display_name から順に照合（部分一致衝突を避けるため）
    const sorted = [...members].sort(
      (a, b) => b.profiles.display_name.length - a.profiles.display_name.length
    );
    for (const m of sorted) {
      const name = m.profiles.display_name;
      if (!name) continue;
      // 表示名内の半角スペースは挿入時に NBSP に置換されているので、
      // 照合用の名前も同様に変換してからエスケープする
      const nameForMatch = name.replace(/ /g, "\u00A0");
      const escaped = nameForMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|\\s)@${escaped}(?=\\s|$)`);
      if (re.test(text)) userIds.add(m.user_id);
    }
    return { userIds: Array.from(userIds), broadcast };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const rawTrimmed = content.trim();
    // 添付がある場合はテキスト空でも送信を許可する
    if (!rawTrimmed && pillMentions.length === 0 && pendingAttachments.length === 0) return;
    if (sending) return;

    // ピル方式で選ばれたメンションを本文先頭に差し込む
    // 表示名に含まれる半角スペースは NBSP に置換して 1 トークン扱い
    const pillPrefix = pillMentions
      .map((p) => {
        if (p.kind === "user") return `@${p.label.replace(/ /g, "\u00A0")}`;
        return p.type === "here" ? "@here" : "@All";
      })
      .join(" ");
    const combined = pillPrefix
      ? pillPrefix + (rawTrimmed ? " " + rawTrimmed : "")
      : rawTrimmed;
    const trimmed = combined.trim();
    // 添付のみで本文空の場合は trimmed が空でも送信可能にする
    if (!trimmed && pendingAttachments.length === 0) return;

    // DLP: 機密情報検知 → 警告して確認を取る（強制ブロックはしない）
    // 本文が空 (添付のみ) の場合はスキャン不要
    if (trimmed) {
      const findings = scanForSensitiveData(trimmed);
      if (findings.length > 0) {
        const labels = findings.map((f) => `・${f.label} (${f.preview})`).join("\n");
        const ok = window.confirm(
          `以下の機密情報らしき内容が含まれています:\n\n${labels}\n\nこのまま送信しますか？`
        );
        if (!ok) return;
      }
    }

    setSending(true);
    const mentions = trimmed ? extractMentions(trimmed) : { userIds: [], broadcast: null };
    const options: SendOptions = sendAsDecision ? { isDecision: true } : {};
    const attachmentsSnapshot = pendingAttachments;
    setContent("");
    setSendAsDecision(false);
    setPillMentions([]);
    setPendingAttachments([]);

    // テキストエリアの高さをリセット
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      // テキスト本文（宛先ピル含む）があれば先に送る
      if (trimmed) {
        await onSend(trimmed, mentions, options);
      }
      // 続けて添付を順次送信（1添付 = 1メッセージ）
      for (const att of attachmentsSnapshot) {
        await onSend(att.url, { userIds: [], broadcast: null });
      }
    } finally {
      setSending(false);
      // PC のみ自動フォーカス（モバイルではキーボードが勝手に出てうるさい）
      const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;
      if (!isMobile) {
        textareaRef.current?.focus();
      }
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

    // Enter 単体 → 改行 (LINE 風)
    // Alt+Enter (Windows Alt / Mac Option) または Cmd+Enter (Mac Command) → 送信
    // Shift+Enter は従来どおり改行 (デフォルト動作)
    if (e.key === "Enter" && (e.altKey || e.metaKey)) {
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

  // ファイルをアップロードして保留キューに追加する (送信は送信ボタン待ち)
  async function uploadFile(file: File) {
    // ファイルサイズチェック
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("ファイルサイズは10MB以下にしてください");
      return;
    }

    // MIMEタイプチェック
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setUploadError("このファイル形式はアップロードできません");
      return;
    }

    // 拡張子チェック（実行ファイルブロック）
    const ext = file.name.lastIndexOf(".") >= 0
      ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
      : "";
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      setUploadError("実行ファイルはアップロードできません");
      return;
    }

    // マジックバイト検証（MIME type 偽装の検知）
    const magicOk = await verifyFileMagicBytes(file, file.type);
    if (!magicOk) {
      setUploadError("ファイルの内容と形式が一致しません");
      return;
    }

    setUploadError(null);
    setUploading(true);

    try {
      const supabase = createClient();
      const safeName = sanitizeFileName(file.name);
      const path = `${channelId || "general"}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from("chat-files")
        .upload(path, file);

      if (uploadErr) {
        setUploadError(`アップロード失敗: ${uploadErr.message}`);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("chat-files")
        .getPublicUrl(path);

      // 即送信せず保留キューに入れる
      setPendingAttachments((prev) => [
        ...prev,
        {
          url: urlData.publicUrl,
          name: file.name,
          type: file.type,
          isImage: file.type.startsWith("image/"),
        },
      ]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }

  // ファイル選択ハンドラ
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // クリップボードからのペースト (スクショ貼り付け等)
  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    // テキストペーストは通常の動作を通す。ファイル (image/*) のみ横取り
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    for (const f of files) {
      // クリップボードから来た画像は file.name が "image.png" 固定で拡張子無しの
      // ことがあるので、タイプから拡張子を補完する
      const withName =
        f.name && f.name !== "image.png" && f.name.includes(".")
          ? f
          : new File([f], `paste-${Date.now()}.${(f.type.split("/")[1] || "png").toLowerCase()}`, { type: f.type });
      await uploadFile(withName);
    }
  }

  // 返信対象がセットされたらテキストエリアにフォーカス
  useEffect(() => {
    if (replyTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyTo]);

  // 親 (channel-view) からのドロップイベントを受け取ってアップロード
  useEffect(() => {
    async function handler(ev: Event) {
      const detail = (ev as CustomEvent<{ files: File[] }>).detail;
      if (!detail?.files?.length) return;
      for (const f of detail.files) {
        await uploadFile(f);
      }
    }
    window.addEventListener("huddle:filesDropped", handler as EventListener);
    return () => {
      window.removeEventListener("huddle:filesDropped", handler as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return (
    <div className="shrink-0 px-4 pb-4 relative">
      {/* 返信対象インジケーター (Chatwork風) */}
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-accent/5 border border-accent/30 px-3 py-2">
          <svg className="w-4 h-4 text-accent mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-accent">
              @{replyTo.profiles?.display_name || "メンバー"} に返信
            </div>
            <div className="text-xs text-muted line-clamp-1 break-words">
              {replyTo.content}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="shrink-0 text-muted hover:text-foreground transition-colors"
            aria-label="返信をキャンセル"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

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

      {/* ピッカーは form の外側で absolute 配置 */}
      <div className="relative" ref={mentionPickerRef}>
        {/* ピッカー */}
        {showMentionPicker && (
          <div className="absolute bottom-full left-0 mb-1 w-72 max-h-72 flex flex-col rounded-xl bg-sidebar border border-border shadow-xl z-50 overflow-hidden">
            <div className="p-2 border-b border-border/50 shrink-0">
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="メンバーを検索"
                className="w-full rounded-lg bg-input-bg border border-border px-2.5 py-1.5 text-sm text-foreground placeholder-muted focus:border-accent focus:outline-none"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {/* @All 特殊メンション */}
              {!pickerQuery && !hasBroadcastChannel && (
                <>
                  <button
                    type="button"
                    onClick={() => addBroadcastPill("channel")}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-white/[0.04] transition-colors"
                  >
                    <span className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0 text-accent text-[10px] font-bold">All</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground">@All</div>
                      <div className="text-[11px] text-muted">チャンネル全員に通知</div>
                    </div>
                  </button>
                  {pickerCandidates.length > 0 && (
                    <div className="my-1 border-t border-border/50" />
                  )}
                </>
              )}

              {pickerCandidates.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted">
                  該当するメンバーがいません
                </div>
              ) : (
                pickerCandidates.map((member) => (
                  <button
                    key={member.user_id}
                    type="button"
                    onClick={() => addUserPill(member)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-white/[0.04] transition-colors"
                  >
                    {member.profiles.avatar_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
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
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col rounded-xl border border-border bg-input-bg overflow-hidden"
      >
        {/* ツールバー行 — 添付 / 宛先追加 アイコンを textarea の上に配置 */}
        <div className="flex items-center gap-1 px-2 py-1.5">
          {/* ファイル添付ボタン */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="shrink-0 rounded-lg w-8 h-8 flex items-center justify-center text-muted hover:text-accent disabled:opacity-50 transition-colors"
            title="ファイルを添付"
          >
            {uploading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            )}
          </button>

          {/* 宛先追加ボタン */}
          <button
            type="button"
            onClick={() => setShowMentionPicker((v) => !v)}
            className="shrink-0 rounded-lg w-8 h-8 flex items-center justify-center text-base font-bold text-muted hover:text-accent transition-colors"
            title="宛先を追加"
            aria-haspopup="listbox"
            aria-expanded={showMentionPicker}
          >
            @
          </button>

          {/* 投票作成ボタン */}
          {onCreatePoll && (
            <button
              type="button"
              onClick={onCreatePoll}
              className="shrink-0 rounded-lg w-8 h-8 flex items-center justify-center text-muted hover:text-accent transition-colors"
              title="投票を作成"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 11l3 3L22 4M13 3H6a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              </svg>
            </button>
          )}

          {/* 音声入力ボタン */}
          <button
            type="button"
            onClick={toggleVoiceInput}
            className={`shrink-0 rounded-lg w-8 h-8 flex items-center justify-center transition-colors ${
              isListening
                ? "text-red-400 bg-red-500/10 animate-pulse"
                : "text-muted hover:text-accent"
            }`}
            title={isListening ? "音声入力を停止" : "音声入力"}
          >
            <svg className="w-4 h-4" fill={isListening ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>

          {/* 決定として送るトグル — 添付・@と並んで入力ツールの一部 */}
          <button
            type="button"
            onClick={() => setSendAsDecision((v) => !v)}
            className={`shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-all duration-200 select-none ${
              sendAsDecision
                ? "bg-accent text-white shadow-md shadow-accent/25"
                : "text-muted border border-border hover:text-foreground hover:border-foreground/30"
            }`}
            aria-pressed={sendAsDecision}
          >
            <svg className="w-3.5 h-3.5" fill={sendAsDecision ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            決定
          </button>
        </div>

        {/* ツールバーと入力欄の区切り線 */}
        <div className="border-t border-border/50" />

        {/* 保留中の添付ファイル（送信ボタンで実送信される） */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/50">
            {pendingAttachments.map((att, idx) => (
              <div
                key={idx}
                className="relative group rounded-lg border border-border bg-background/40 overflow-hidden"
              >
                {att.isImage ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={att.url}
                    alt={att.name}
                    className="w-20 h-20 object-cover"
                  />
                ) : (
                  <div className="w-32 h-20 flex items-center gap-2 px-2">
                    <svg className="w-6 h-6 text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <span className="text-xs text-foreground truncate">{att.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                  aria-label="添付を削除"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 選択済みの宛先ピル行 */}
        {pillMentions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-border/50">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted shrink-0">
              To
            </span>
            {pillMentions.map((p, idx) => (
              <span
                key={p.kind === "user" ? `u-${p.id}` : `b-${p.type}`}
                className="inline-flex items-center gap-1 rounded-full bg-accent/10 border border-accent/30 px-2 py-0.5 text-xs text-accent"
              >
                <span className="font-semibold">
                  @{p.kind === "user" ? p.label : p.type === "here" ? "here" : "All"}
                </span>
                <button
                  type="button"
                  onClick={() => removePill(idx)}
                  className="text-accent/70 hover:text-accent"
                  aria-label="削除"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 非表示のファイルinput */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.json,.xml"
        />

        {/* 入力欄行 */}
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder={placeholder || (channelName ? `#${channelName} にメッセージを送信` : "メッセージを入力")}
            rows={1}
            maxLength={4000}
            className="flex-1 resize-none bg-transparent text-base text-foreground placeholder-muted focus:outline-none max-h-[200px]"
          />
          {/* 送信ボタン */}
          <button
            type="submit"
            disabled={!content.trim() && pendingAttachments.length === 0}
            className="shrink-0 rounded-lg bg-accent p-2 text-white hover:bg-accent-hover disabled:opacity-30 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
