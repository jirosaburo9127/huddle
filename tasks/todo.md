# Huddle オンライン会議＋AI議事録 自動化 実装計画

> 作成: 2026-06-02 / 秘書室長: 本多正信
> ステータス: **設計・計画フェーズ（実装はオーナー承認後）**

---

## 0. ゴール（オーナー確定）

**「Huddleで会議を開く → 終わったら自動で文字起こし → AIが議事録を生成 → そのチャンネルに自動投稿」までを一気通貫で自動化する。**

| 項目 | 決定 |
|------|------|
| 会議の器 | **LiveKit**（ビデオ通話フル：音声＋映像＋画面共有） |
| 文字起こしのタイミング | **会議終了後に録音ファイルから一括** |
| STTエンジン | **Whisper自前**（faster-whisper / whisper.cpp） |
| 話者分離 | MVPでは不要（後付け可能。要点・決定・ToDoが拾えればOK） |
| 議事録生成 | **Claude API**（最新Opus/Sonnet） |
| 投稿先 | **会議したチャンネルにメッセージとして自動投稿** |
| 対応環境 | Web ＋ iOS（Capacitor） |
| 今回のゴール | この計画書まで。承認後に実装着手 |

---

## 1. ⚠️ 最重要・要判断：文字起こしワーカーの置き場所

**Whisper自前 = 常駐の文字起こしワーカー（Python）が必須。** Vercel（サーバーレス）/ Supabase Edge Function では Whisper の重い処理・長時間ジョブ・バイナリ実行は不可。ここだけ新インフラが要る。

| 案 | 内容 | コスト | 推奨度 |
|----|------|--------|--------|
| **A. 小型常駐サーバー** | Fly.io / Railway / VPS に faster-whisper ワーカーを常駐。ジョブをポーリング（or webhook）で処理 | 月$5〜（CPU）/ GPUなら高め | ◎ 本番向け |
| B. オーナーのMac常駐 | 既存の whisper.cpp 環境（→ memory: video-subtitle-burn-in）をローカルワーカー化。Mac起動中のみ動く | $0 | △ 検証・初期のみ |
| C. クラウドSTTに逃がす | Whisper自前を諦め Deepgram 等。ワーカー不要だが「自前」方針に反する | 従量 | × 今回は不採用 |

**推奨: まず B で動作実証 → A（Fly.io等）で常駐化して本番。** 開発はMac、本番はFly.ioが現実的。
→ **オーナー判断: A/B どちらで本番運用するか？**（この章だけ先に決めたい）

---

## 2. 天才会議：招集メンバー

新機能開発＋パフォーマンス（音声処理）＋セキュリティ＋日本語品質のため以下を招集。

- **M3 DHH（バック）** … パイプラインをシンプルに。状態は最小テーブル＋ジョブキュー
- **M2 ラウチ（フロント）** … LiveKit React SDK 組み込み、通話UX
- **M10 カーマック（処理/性能）** … Whisper ワーカー、音声変換、ジョブ処理の高速・堅牢化
- **M11 シュナイアー（セキュリティ）** … トークン認可、録音データのアクセス制御、RLS
- **M9 神田昌典（日本語）** … Claude への議事録プロンプト設計（日本語の議事録として読める品質）
- 議長: 本多正信

### 各メンバー初期コメント（要約）
- **M3**:「メディアと録音は LiveKit、文字起こしは外部ワーカー。Huddle 側は『ジョブの状態』テーブル1本で疎結合に。webhook 駆動でポーリング地獄を避けろ。」
- **M10**:「LiveKit Egress は音声のみ（Opus/OGG）で十分。映像を録ると無駄に重い。faster-whisper の `large-v3` は重いので、まず CPU で動く範囲のモデル＋必要なら GPU。チャンク並列で速く。」
- **M11**:「録音ファイルとトランスクリプトは個人情報の塊。Storage は private バケット、署名URL限定。ワーカーの認証はサービスロール鍵を環境変数で。LiveKit トークンは必ずサーバー署名＋channel_members 照合。」
- **M9**:「議事録は『誰でも3分で追える』形に。要約 / 決定事項 / ToDo（担当・期限）/ 次回アジェンダ の固定フォーマット。Claude のプロンプトに日本語ビジネス議事録の型を渡す。」
- **M4（参考）**:「会議の開始と終了は1タップで。議事録は勝手に出てくる——ユーザーは何もしない、が理想。」

---

## 3. パイプライン全体像

```
 ① 会議を開く（チャンネルで「会議開始」）
      │  POST /api/livekit/token（認証＋メンバー照合）
      v
 ┌──────────────┐   WebRTC   ┌────────────────┐
 │ Huddle (Web/ │<──────────>│  LiveKit Cloud  │  ← ビデオ会議（SFU）
 │  iOS/PC)     │            │  + Egress(録音) │
 └──────────────┘            └───────┬─────────┘
                                     │ ② 会議終了→音声ファイル出力
                                     v
                         ┌────────────────────────┐
                         │ Storage(private bucket) │  ← 録音(Opus/OGG)
                         └───────────┬─────────────┘
   ③ egress_ended webhook            │
   ┌──────────────────────────┐      │ ④ 音声DL
   │ Next.js /api/livekit/    │      v
   │   webhook → ジョブ作成    │   ┌─────────────────────────┐
   └──────────────────────────┘   │  文字起こしワーカー(Python)│
            │ minutes_jobs 行       │  faster-whisper → 文字起こし│
            │ (status: transcribing)│  → Claude API → 議事録生成 │
            v                       └────────────┬────────────┘
   ┌──────────────┐                              │ ⑤ messages へ INSERT
   │  Supabase    │<─────────────────────────────┘   （= チャンネルに自動投稿）
   │  Postgres    │   ⑥ Realtime で通常メッセージとして配信
   └──────────────┘
```

**疎結合の肝**: Huddle 本体（Next.js/Supabase）と 文字起こしワーカー（Python）は `minutes_jobs` テーブルを介してだけ繋がる。ワーカーが落ちても会議自体は成立し、ジョブは後追いで処理できる。

---

## 4. 技術選定

### 4-1. 会議＋録音：LiveKit Cloud + Egress
- 会議: `@livekit/components-react`（`LiveKitRoom` + `VideoConference`）
- 録音: **LiveKit Egress（音声のみ track/composite → Opus/OGG）**。議事録目的なので映像は録らない（軽い・安い・速い）。
- 出力先: S3互換ストレージ。**Supabase Storage は S3互換エンドポイントあり**→ private バケット `meeting-recordings` に直接出力。
- ⚠️ memory: **Supabase Free プランは1ファイル50MBキャップ**。Opus音声なら1時間≈30MB前後で概ね収まるが、長時間会議は超過リスク → 長尺は分割 or Pro化 or LiveKit側ストレージ検討。

### 4-2. 文字起こし：faster-whisper（自前ワーカー）
- `faster-whisper`（CTranslate2、whisper.cpp より実装が楽でGPU/CPU両対応）。モデルは日本語精度重視で `large-v3`（GPU）/ 妥協で `medium`（CPU）。
- 入力音声は ffmpeg で 16kHz mono wav に正規化してから投入（→ memory: video-subtitle-burn-in の知見、フル版ffmpeg必要）。
- 話者分離（フェーズ後半・任意）: `pyannote.audio` 追加、または LiveKit で**参加者ごとに個別音声トラックを Egress**して話者を確定（こちらの方が精度高・実装明快）。

### 4-3. 議事録生成：Claude API
- トランスクリプト全文 → Claude（Opus/Sonnet）で日本語議事録に整形。
- プロンプト固定フォーマット（M9案）:
  1. **会議サマリー**（3〜5行）
  2. **決定事項**（箇条書き）
  3. **ToDo**（担当 / 期限、わかる範囲で）
  4. **次回アジェンダ / 保留事項**
- 長尺対策: トランスクリプトが長い場合はチャンク要約→統合（map-reduce）。プロンプトキャッシュ活用。
- 鍵: `ANTHROPIC_API_KEY`（ワーカー側 環境変数）。

### パッケージ
```jsonc
// Huddle 本体（クライアント）
"livekit-client": "^2",
"@livekit/components-react": "^2",
"@livekit/components-styles": "^2",
// Huddle 本体（サーバー: token発行・egress制御・webhook検証）
"livekit-server-sdk": "^2",
// 文字起こしワーカー（別リポ or slack-app/worker/、Python）
//   faster-whisper, anthropic, supabase(py), ffmpeg(システム), (任意)pyannote.audio
```

---

## 5. iOS（Capacitor）の制約 — §会議UIに反映
- 音声・カメラ: ✅ iOS 14.3+ の WKWebView で getUserMedia 可（Info.plist に Camera/Mic 記載済み）。
- 画面共有の**配信**: ❌ iOS は `getDisplayMedia` 非対応 → iOS では画面共有ボタンを隠す（閲覧は可）。
- バックグラウンド音声継続: `ios/App/App/Info.plist` の `UIBackgroundModes` に `audio` 追加。
- 実装時は実機検証必須（→ memory: feedback_observe_before_fix）。
- **議事録パイプライン自体は端末非依存**（サーバー/ワーカー側で完結するので iOS 制約の影響を受けない）。

---

## 6. DBスキーマ（新規マイグレーション）

`supabase/migrations/126_meetings.sql`（番号は実装時の最新+1）

```sql
-- 会議セッション（= LiveKit room 1個）
create table call_sessions (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references channels(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  started_by   uuid not null references profiles(id),
  room_name    text not null unique default ('call_' || gen_random_uuid()::text),
  status       text not null default 'active' check (status in ('active','ended')),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);

-- 議事録ジョブ（録音→文字起こし→生成→投稿 の状態機械）
create table minutes_jobs (
  id              uuid primary key default gen_random_uuid(),
  call_session_id uuid not null references call_sessions(id) on delete cascade,
  channel_id      uuid not null references channels(id) on delete cascade,
  recording_path  text,            -- Storage 上の音声ファイルパス
  transcript      text,            -- 文字起こし全文（監査・再生成用に保持）
  status          text not null default 'pending'
                    check (status in ('pending','transcribing','summarizing','posted','failed')),
  error           text,
  posted_message_id uuid references messages(id),  -- 投稿した議事録メッセージ
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on call_sessions (channel_id) where status = 'active';
create index on minutes_jobs (status) where status in ('pending','transcribing','summarizing');
```

**RLS（M11）:**
- `call_sessions`: SELECT/INSERT とも当該 channel の `channel_members` のみ。
- `minutes_jobs`: SELECT は同 channel メンバー。INSERT/UPDATE は**サービスロール（webhook/ワーカー）のみ**（クライアントからは触らせない）。
- 録音 Storage バケットは private。読み取りは署名URLのみ、ワーカーはサービスロールでアクセス。
- 議事録の最終成果物は `messages` への通常 INSERT なので、既存のチャンネル可視性（RLS）がそのまま効く。

---

## 7. バックエンド（Next.js 側）

### 7-1. トークン発行 `src/app/api/livekit/token/route.ts`
（既存 `api/calendar` の Route Handler パターン）
1. `getAuthUser()` で認証 → 2. `channel_members` 照合（非メンバー403）→ 3. active な `call_session` を取得/作成 → 4. `livekit-server-sdk` の `AccessToken` で署名（identity=user.id, room=room_name, canPublish/Subscribe）→ 5. `{ server_url, participant_token, room_name }` を返す。

### 7-2. Egress 制御
- 会議開始時 or 1人目参加時に **Audio Egress 開始**（`livekit-server-sdk` の EgressClient、出力先=Supabase Storage S3）。
- 会議終了/全員退出で Egress 停止。
- 出力先パスを `minutes_jobs.recording_path` 候補として保持。

### 7-3. Webhook `src/app/api/livekit/webhook/route.ts`
- LiveKit の `egress_ended` を受信（署名検証）→ 対応する `call_sessions` を `ended` に、`minutes_jobs` を `pending` で作成（recording_path セット）。
- これがワーカーへの発火点。

### 7-4. （任意）ワーカー完了通知
- ワーカーが議事録を `messages` に INSERT 後、`minutes_jobs.status='posted'` に更新。Realtime が通常メッセージとしてチャンネルに配信（追加の配信実装は不要）。

---

## 8. 文字起こしワーカー（Python・新規）

`slack-app/worker/`（または別リポ）。常駐 or webhook 起動。
1. `pending` ジョブを取得（webhook push か短間隔ポーリング）。
2. Storage から録音DL → ffmpeg で 16kHz mono wav 正規化。
3. `status='transcribing'` → faster-whisper で日本語文字起こし → `transcript` 保存。
4. `status='summarizing'` → Claude API で議事録生成（§4-3 フォーマット）。
5. `messages` に議事録を INSERT（user_id は専用Bot/開始者、content=議事録Markdown）。
6. `status='posted'`、`posted_message_id` 記録。失敗時 `failed`＋`error`、UIに再実行ボタン。

> **冪等性**（M10）: 各ステップは再実行可能に。`transcript` を保持しておけば文字起こしをやり直さず議事録だけ再生成できる。

---

## 9. フロントエンド

### 通話UI（§前回計画と共通）
- `src/stores/call-store.ts`（activeCall / incomingCall / minimized）
- `src/components/call/call-room.tsx`（LiveKitRoom + VideoConference、Huddleテーマに合わせる）
- `call-button.tsx`（チャンネルヘッダーに「会議を開始」）/ `incoming-call-banner.tsx` / `active-call-pill.tsx`
- iOS時は画面共有ボタン非表示（§5）

### 議事録まわり
- 会議終了後、チャンネルに「議事録を生成中…」の軽いステータス表示（`minutes_jobs` を Realtime購読、任意）。
- 完成した議事録は**通常のメッセージとして**チャンネルに出る（特別なビューワ不要。リッチ表示したければ message に `type=minutes` 等のメタを後付け）。

### 着信通知
- アプリ起動中: `call_sessions` INSERT を Realtime購読 → 着信バナー。
- アプリ閉: 既存 `send-push`（APNs/FCM）を会議開始イベントに拡張、`push-tap-handler` で参加導線。

---

## 10. 段階的実装フェーズ（チェックリスト）

### フェーズ0：基盤準備
- [ ] LiveKit Cloud プロジェクト作成、API Key/Secret 発行
- [ ] ワーカー本番ホスト決定（§1 の A/B）
- [ ] 環境変数登録（`.env.local` + Vercel + ワーカー）※`.env`変更はオーナー確認
- [ ] パッケージ追加
- [ ] マイグレーション `126_meetings.sql` + RLS（`supabase db push` まで）

### フェーズ1：会議が繋がる（メディア）
- [ ] token API（認証＋メンバー照合）
- [ ] call-store / call-room / call-button
- [ ] **Web 2者間で音声＋映像が繋がることを実ブラウザで確認**（動作証明まで完了扱いにしない）

### フェーズ2：録音→ファイル化
- [ ] Egress 開始/停止（Supabase Storage 出力、private バケット）
- [ ] webhook 受信 → `minutes_jobs(pending)` 作成
- [ ] **会議の音声ファイルが Storage に出ることを確認**

### フェーズ3：文字起こし＋議事録（パイプライン本体）
- [ ] Python ワーカー雛形（ジョブ取得→DL→ffmpeg正規化）
- [ ] faster-whisper で日本語文字起こし → transcript 保存
- [ ] Claude API で議事録生成（M9フォーマット、プロンプト調整）
- [ ] `messages` へ自動投稿 → チャンネルに出ることを確認
- [ ] **実会議1本を録って、議事録が自動投稿される end-to-end を実証**

### フェーズ4：着信・参加・退出体験
- [ ] Realtime 着信バナー / active-call-pill / 退出処理

### フェーズ5：iOS アプリ対応
- [ ] `Info.plist` に `UIBackgroundModes: audio`
- [ ] WKWebView getUserMedia 許可確認（capacitor.config）
- [ ] iOSでは画面共有ボタン非表示
- [ ] `npx cap sync ios` → 実機ビルドで音声・映像・議事録投稿まで確認

### フェーズ6：閉じてる時の着信プッシュ
- [ ] `send-push` を会議開始イベントに拡張 / `push-tap-handler` で参加導線

### フェーズ7：仕上げ・任意拡張
- [ ] 議事録の再生成ボタン（transcript 流用）/ failed リトライ
- [ ] 話者分離（参加者別トラックEgress or pyannote）
- [ ] テーマ3種に通話UI適合
- [ ] セキュリティ監査（app-security-guardian：トークン/RLS/録音アクセス）
- [ ] デプロイ（Huddleルール：push + vercel --prod 自動）

---

## 11. コスト見積もり

- **LiveKit Cloud**: 無料枠あり。会議の接続時間 ＋ Egress（録音）分が従量。小規模は低コスト。
- **Whisper ワーカー**: §1 の選択次第。CPU常駐なら月$5〜、Mac常駐なら$0、GPUは高め。
- **Claude API**: 議事録生成のトークン量のみ。1会議あたり数円〜数十円規模。プロンプトキャッシュで圧縮。
- **Supabase**: 既存枠＋Storage（録音）。Free の50MB/ファイル上限に注意（長尺はPro検討）。

---

## 12. リスク・未決事項（オーナー判断）

1. **ワーカーのホスト（§1）**: 本番は A（常駐サーバー）か B（Mac）か。← まず決めたい
2. **録音ストレージ**: Supabase Storage（50MB上限）で始めるか、別S3 / LiveKit側ストレージか。長尺会議の扱い。
3. **議事録の投稿者**: 専用Botアカウントで投稿するか、会議開始者名義か（推奨: 「議事録Bot」アカウント）。
4. **話者分離**: MVP後に「参加者別トラックEgress」で精度高く入れるか。
5. **プライバシー運用**: 録音・トランスクリプトの保持期間／削除ポリシー（M11 推奨: 議事録生成後に音声は一定期間で自動削除）。
6. **`.env` への鍵追加**: CLAUDE.md ルールによりオーナー確認必須。

---

## レビューセクション（実装後に追記）

（実装完了後、何をしたか / 何が変わったかをここに記録）
