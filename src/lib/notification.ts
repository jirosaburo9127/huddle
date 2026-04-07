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
  // アプリがフォーカスされている場合は通知しない
  if (typeof window === "undefined") return;
  if (document.hasFocus()) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  // メッセージ本文を100文字に切り詰め
  const body = content.length > 100 ? content.slice(0, 100) + "…" : content;
  const title = `${senderName} (#${channelName})`;

  const notification = new Notification(title, {
    body,
    icon: "/icons/icon-192.png",
    tag: `huddle-${Date.now()}`,
  });

  // 通知クリックでアプリにフォーカス
  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  // 5秒後に自動で閉じる
  setTimeout(() => notification.close(), 5000);
}
