// Service Worker は廃止しました。
// 古い SW が登録されているデバイスのために、自分自身を unregister する stub を置いておく。
// これを取得した瞬間に activate → 自己 unregister → キャッシュ削除 → 全クライアントをリロード。

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      try {
        await self.registration.unregister();
      } catch {}
      // 全クライアントにリロードを促す
      try {
        const clientsList = await self.clients.matchAll({ type: "window" });
        for (const c of clientsList) {
          try {
            c.navigate(c.url);
          } catch {}
        }
      } catch {}
    })()
  );
});
