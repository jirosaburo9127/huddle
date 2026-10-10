"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { HuddleMark } from "@/components/huddle-mark";
import { MikanModal, type MikanContext } from "./mikan-modal";

type Props = {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  /** 通常チャンネルの一覧（いま開いているチャンネルを URL から特定するため） */
  channels: Array<{ id: string; slug: string; name: string }>;
};

// 画面ごとの「みかんに頼めること」を決めるため、URL からいまの画面を判定する
const PAGE_CONTEXT: Record<string, MikanContext> = {
  home: "home",
  tasks: "tasks",
  calendar: "calendar",
};

/** どの画面にもいる、みかんの浮遊ボタン。押すとその画面に合ったメニューが開く */
export function MikanFab({ workspaceId, workspaceSlug, currentUserId, channels }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const messageInputFocused = useMobileNavStore((s) => s.messageInputFocused);
  const [open, setOpen] = useState(false);

  const segment = pathname.split("/").filter(Boolean)[1] || "";
  const channel = useMemo(() => {
    const hit = channels.find((c) => c.slug === segment);
    return hit ? { id: hit.id, name: hit.name } : null;
  }, [channels, segment]);
  const context: MikanContext = channel ? "channel" : !segment ? "home" : PAGE_CONTEXT[segment] || "other";

  // 投稿欄のある画面（チャンネル・DM・独り言）では、送信ボタンに重ならないよう一段上に置く。
  // それ以外の一覧系の画面は URL が決まっているので、そこに無いものを投稿欄ありとみなす
  const LIST_PAGES = ["", "home", "tasks", "calendar", "files", "albums", "search", "dashboard", "in-progress", "dm-list", "settings"];
  const hasComposer = !LIST_PAGES.includes(segment);

  if (!pathname.startsWith(`/${workspaceSlug}`)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed right-4 lg:right-8 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-surface border border-border shadow-lg animate-mikan-float transition-opacity ${
          hasComposer
            ? "bottom-[calc(150px+env(safe-area-inset-bottom,0px))] lg:bottom-28"
            : "bottom-[calc(76px+env(safe-area-inset-bottom,0px))] lg:bottom-8"
        } ${messageInputFocused ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        aria-label="みかんを開く"
        title="みかん"
      >
        <HuddleMark size={28} />
      </button>
      {open && (
        <MikanModal
          workspaceId={workspaceId}
          channel={channel}
          context={context}
          currentUserId={currentUserId}
          onEventCreated={(messageId) => {
            // 開いているチャンネル画面に、予定カードを出す投稿だと知らせる
            window.dispatchEvent(new CustomEvent("huddle:eventCreated", { detail: { messageId } }));
          }}
          onRegistered={() => router.refresh()}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
