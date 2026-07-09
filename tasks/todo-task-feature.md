# Huddle タスク機能拡張 — Phase 1

方針: チーム進捗管理型 × 他人アサイン可。既存 tasks 基盤(136_kanban_tasks.sql)の拡張。UX最優先。

## ゴール
チャットの依頼が確実に「自分の手元(マイタスク)」に集まり、アサインされたら気づける。
「このツールは自分のためにある」と感じられる状態にする。

## タスク

### A. DB / バックエンド
- [ ] `141_*.sql`: `tasks.message_id`(nullable FK→messages, ON DELETE SET NULL) 追加
- [ ] `142_*.sql`: `task_assignees` AFTER INSERT トリガー → 担当者へ notifications insert + net.http_post(自分自身へのアサインは除外)
- [ ] Edge Function `send-task-push`: 既存 send-reaction-push を雛形にAPNs送信
- [ ] `supabase db push` まで実行

### B. メッセージ→タスク化
- [ ] `message-item.tsx`: PCアクションバー/モバイルシートに「タスクにする」追加(onDecisionがテンプレ)
- [ ] `channel-view.tsx`: handleCreateTask → 本文を初期タイトルにTaskModalを開く
- [ ] `task-modal.tsx`: messageId/初期タイトルを受け取り message_id 込みでinsert

### C. マイタスク強化 + 発見性
- [ ] `sidebar.tsx` / `bottom-tab-bar.tsx`: my-work限定ガードを外し常時導線
- [ ] マイタスク画面: 自分アサイン分中心、期限切れ/今日/今週/期限なしでセクション化
- [ ] 「担当 / 依頼(created_by=自分)」切替タブ

## UX原則
- タスク化は2タップ以内、本文が自動でタイトルに入る
- グラデ禁止・単色+影+丸み(feedback_no_gradient)
- 完了はワンタップ + 気持ちよさ
- 通知は「誰が/何を/期限」が一目で分かる文面

## レビュー
(実装後に記載)
