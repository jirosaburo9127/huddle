"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  workspaceId: string;
  currentUserId: string;
  // 自分が参加しているチャンネル一覧
  channels: Array<{ id: string; name: string; slug: string }>;
  // 既存アルバムに追加する場合のアルバムID
  addToAlbumId?: string;
  onClose: () => void;
  onCreated: () => void;
};

// 画像圧縮（message-input.tsxと同じロジック）
async function compressImage(file: File): Promise<File> {
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size < 500 * 1024) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1920;
      let { width, height } = img;
      if (width > max || height > max) {
        const ratio = Math.min(max / width, max / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size < file.size) {
            resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        0.8
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function isImageFile(name: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(name);
}

export function CreateAlbumModal({ workspaceId, currentUserId, channels, addToAlbumId, onClose, onCreated }: Props) {
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id || "");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setFiles((prev) => [...prev, ...arr]);
    // プレビュー生成
    for (const f of arr) {
      if (isImageFile(f.name)) {
        const url = URL.createObjectURL(f);
        setPreviews((prev) => [...prev, url]);
      } else {
        setPreviews((prev) => [...prev, ""]);
      }
    }
  }, []);

  const handleSubmit = async () => {
    if (!addToAlbumId && !title.trim()) return;
    if (files.length === 0) return;
    setUploading(true);

    let albumId = addToAlbumId;

    // アルバム作成（新規の場合）
    if (!albumId) {
      const { data, error } = await supabase
        .from("albums")
        .insert({ channel_id: channelId, title: title.trim(), created_by: currentUserId })
        .select()
        .single();
      if (error || !data) {
        alert("アルバムの作成に失敗しました");
        setUploading(false);
        return;
      }
      albumId = data.id;
    }

    // ファイルアップロード + album_items INSERT
    for (let i = 0; i < files.length; i++) {
      setProgress(Math.round(((i) / files.length) * 100));
      let file = files[i];

      // 画像なら圧縮
      if (isImageFile(file.name)) {
        file = await compressImage(file);
      }

      const ext = file.name.split(".").pop() || "bin";
      const path = `${channelId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("chat-files")
        .upload(path, file, { contentType: file.type });

      if (uploadErr) {
        console.error("Upload failed:", uploadErr);
        continue;
      }

      const { data: urlData } = supabase.storage.from("chat-files").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      const fileType = isImageFile(file.name) ? "image" : "video";

      await supabase.from("album_items").insert({
        album_id: albumId,
        url: publicUrl,
        file_type: fileType,
        file_name: file.name,
        added_by: currentUserId,
      });
    }

    // カバー画像を設定（最初の画像）
    if (!addToAlbumId) {
      const { data: firstItem } = await supabase
        .from("album_items")
        .select("url")
        .eq("album_id", albumId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstItem) {
        await supabase.from("albums").update({ cover_url: firstItem.url }).eq("id", albumId);
      }
    }

    // チャンネルにアルバム更新通知メッセージを投稿
    // system_eventにアルバム情報をJSON埋め込み → message-itemで専用カード表示
    const albumTitle = addToAlbumId ? undefined : title.trim();
    const { data: coverItem } = await supabase
      .from("album_items")
      .select("url")
      .eq("album_id", albumId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const eventData = JSON.stringify({
      type: "album_update",
      album_id: albumId,
      title: albumTitle,
      cover_url: coverItem?.url || null,
      item_count: files.length,
      is_new: !addToAlbumId,
    });

    await supabase.from("messages").insert({
      channel_id: channelId,
      user_id: currentUserId,
      content: addToAlbumId
        ? `📸 アルバムに${files.length}枚追加しました`
        : `📸 アルバム「${title.trim()}」を作成しました（${files.length}枚）`,
      system_event: eventData,
    });

    setUploading(false);
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full sm:max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-sidebar border border-border shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
          <h2 className="text-base font-bold text-foreground">
            {addToAlbumId ? "写真を追加" : "アルバムを作成"}
          </h2>
          <button onClick={onClose} className="p-1 text-muted hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* タイトル（新規のみ） */}
          {!addToAlbumId && (
            <>
              <div>
                <label className="text-xs font-medium text-muted block mb-1">タイトル</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 2026年5月コンペ"
                  className="w-full rounded-xl border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted block mb-1">チャンネル</label>
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>#{ch.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* ファイル選択 */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-border py-8 text-center text-sm text-muted hover:border-accent hover:text-accent transition-colors"
            >
              📷 写真・動画を選択
            </button>
          </div>

          {/* プレビュー */}
          {files.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {files.map((f, i) => (
                <div key={i} className="aspect-square bg-border/20 rounded-lg overflow-hidden relative">
                  {previews[i] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previews[i]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-muted">
                      🎥
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setFiles((prev) => prev.filter((_, j) => j !== i));
                      if (previews[i]) URL.revokeObjectURL(previews[i]);
                      setPreviews((prev) => prev.filter((_, j) => j !== i));
                    }}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center text-white text-[10px]"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 進行状況 */}
          {uploading && (
            <div className="text-center text-sm text-muted">
              <div className="w-full bg-border/30 rounded-full h-1.5 mb-2">
                <div className="bg-accent h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              アップロード中... {progress}%
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-border/50">
          <button
            onClick={handleSubmit}
            disabled={uploading || files.length === 0 || (!addToAlbumId && !title.trim())}
            className="w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
          >
            {uploading ? "アップロード中..." : addToAlbumId ? `${files.length}枚を追加` : `アルバムを作成（${files.length}枚）`}
          </button>
        </div>
      </div>
    </div>
  );
}
