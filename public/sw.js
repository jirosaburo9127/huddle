const CACHE_NAME = "huddle-v2";

// インストール時は即 activate する
self.addEventListener("install", () => {
  self.skipWaiting();
});

// アクティベート時に古いキャッシュを全削除（v1 時代のオフラインキャッシュも除去）
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// navigate fetch はブラウザに任せる（respondWith しない）
// iOS WKWebView で SW が fetch を握ると <a href> のナビゲーションが
// 発火しない症状が出たため、SW による navigation 横取りを完全に停止する。
// （プッシュ通知の受信・クリックは下の handler で処理）

// プッシュ通知受信
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Huddle";
  const options = {
    body: data.body || "新しいメッセージがあります",
    icon: "/icons/icon.svg",
    badge: "/icons/icon.svg",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック時にアプリを開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || "/"));
});
