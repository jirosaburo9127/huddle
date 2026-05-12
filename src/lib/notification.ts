// ブラウザ通知を表示するユーティリティ
export function showMessageNotification({
  senderName,
  channelName,
  content,
  url,
}: {
  senderName: string;
  channelName: string;
  content: string;
  url: string;
}) {
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  // 現在見ているチャンネルと同じなら、フォーカス中は通知しない
  // 別チャンネルのメッセージならフォーカス中でも通知する（LINE方式）
  // urlが ?m=xxx 付きでも、pathnameだけで同一チャンネル判定する
  const targetPath = new URL(url, window.location.origin).pathname;
  const isCurrentChannel = window.location.pathname === targetPath;
  if (isCurrentChannel && document.hasFocus()) return;

  // メッセージ本文を100文字に切り詰め
  const body = content.length > 100 ? content.slice(0, 100) + "…" : content;
  const title = `${senderName} (#${channelName})`;

  const notification = new Notification(title, {
    body,
    icon: "/icons/icon-192.png",
    tag: `huddle-${Date.now()}`,
  });

  // 通知クリックで該当投稿に遷移
  notification.onclick = () => {
    window.focus();
    if (url) {
      // 同一チャンネル内ならCustomEventでジャンプ、別チャンネルなら通常遷移
      const targetPath = url.split("?")[0];
      if (window.location.pathname === targetPath) {
        const params = new URLSearchParams(url.split("?")[1] || "");
        const messageId = params.get("m");
        if (messageId) {
          window.dispatchEvent(
            new CustomEvent("huddle:jumpToMessage", { detail: { messageId } })
          );
        }
      } else {
        window.location.href = url;
      }
    }
    notification.close();
  };

  // 5秒後に自動で閉じる
  setTimeout(() => notification.close(), 5000);
}
