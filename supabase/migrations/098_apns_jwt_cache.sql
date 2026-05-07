-- APNs JWT を全 Edge Function インスタンス間で共有するためのキャッシュテーブル。
--
-- 背景:
-- send-push 内のメモリキャッシュ (cachedJwt) は同一インスタンス内でしか
-- 共有されず、Supabase Edge Function は cold start ごとに新規インスタンスを
-- 立ち上げるため、リクエスト頻度が低い workspace では毎回新規 JWT が
-- 生成される。APNs は「同一プロバイダから 20分以内に新規 JWT を発行」
-- すると 429 TooManyProviderTokenUpdates を返すため、結果として
-- 流量の少ない workspace の push が片っ端から失敗していた。
--
-- 解決策: JWT を DB に 1 行だけ保持して、全インスタンスがこれを参照/更新する。
-- 50 分以内なら再利用、超えていたら新規生成して上書きする。

CREATE TABLE IF NOT EXISTS public.apns_jwt_cache (
  id INTEGER PRIMARY KEY DEFAULT 1,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT apns_jwt_cache_singleton CHECK (id = 1)
);

-- RLS: service role のみ読み書き可
ALTER TABLE public.apns_jwt_cache ENABLE ROW LEVEL SECURITY;

-- service_role は RLS をバイパスするのでポリシー定義は不要
-- (anon / authenticated には漏らしたくないので明示ポリシーは作らない)
