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

  // 現在見ているチャンネルと同じURLなら、フォーカス中は通知しない
  // 別チャンネルのメッセージならフォーカス中でも通知する（LINE方式）
  const isCurrentPage = window.location.pathname === url;
  if (isCurrentPage && document.hasFocus()) return;

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
