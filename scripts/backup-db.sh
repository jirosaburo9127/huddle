#!/bin/bash
# Huddle DB バックアップスクリプト
# Supabase REST API 経由で全テーブルのデータを JSON でエクスポートする。
#
# 使い方:
#   ./scripts/backup-db.sh
#
# 出力先: backups/YYYY-MM-DD_HHMMSS/
# 各テーブルが個別の .json ファイルとして保存される。

set -euo pipefail

# .env.local から読み込み
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env.local が見つかりません: $ENV_FILE"
  exit 1
fi

SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  echo "ERROR: SUPABASE_URL または SERVICE_ROLE_KEY が .env.local にありません"
  exit 1
fi

# バックアップディレクトリ
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_DIR="$PROJECT_DIR/backups/$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

# バックアップ対象テーブル（依存順）
TABLES=(
  "profiles"
  "workspaces"
  "workspace_members"
  "workspace_categories"
  "channels"
  "channel_members"
  "messages"
  "reactions"
  "mentions"
  "polls"
  "poll_votes"
  "bookmarks"
  "channel_notes"
  "workspace_invitations"
  "share_tokens"
  "device_tokens"
  "audit_logs"
  "notifications"
)

echo "=== Huddle DB バックアップ ==="
echo "日時: $TIMESTAMP"
echo "出力先: $BACKUP_DIR"
echo ""

TOTAL=0
ERRORS=0

for TABLE in "${TABLES[@]}"; do
  printf "  %-25s ... " "$TABLE"

  # Supabase REST API でテーブル全件取得
  # select=* でオフセットなし、Range ヘッダーで上限を大きく取る
  HTTP_CODE=$(curl -s -w "%{http_code}" -o "$BACKUP_DIR/$TABLE.json" \
    "${SUPABASE_URL}/rest/v1/${TABLE}?select=*" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Range: 0-99999" \
    -H "Accept: application/json" \
    2>/dev/null)

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "206" ]; then
    # 行数をカウント
    ROWS=$(python3 -c "import json; print(len(json.load(open('$BACKUP_DIR/$TABLE.json'))))" 2>/dev/null || echo "?")
    SIZE=$(du -h "$BACKUP_DIR/$TABLE.json" | cut -f1)
    echo "OK (${ROWS}行, ${SIZE})"
    TOTAL=$((TOTAL + 1))
  elif [ "$HTTP_CODE" = "404" ]; then
    echo "SKIP (テーブル不在)"
    rm -f "$BACKUP_DIR/$TABLE.json"
  else
    echo "FAIL (HTTP $HTTP_CODE)"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
echo "=== 完了 ==="
echo "成功: ${TOTAL}テーブル / エラー: ${ERRORS}"

# 古いバックアップの自動削除（30日以上前）
BACKUPS_ROOT="$PROJECT_DIR/backups"
if [ -d "$BACKUPS_ROOT" ]; then
  OLD_COUNT=$(find "$BACKUPS_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +30 2>/dev/null | wc -l | tr -d ' ')
  if [ "$OLD_COUNT" -gt 0 ]; then
    echo ""
    echo "30日以上前のバックアップを ${OLD_COUNT} 件削除します..."
    find "$BACKUPS_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
  fi
fi

# 圧縮
echo ""
echo "圧縮中..."
cd "$PROJECT_DIR/backups"
tar -czf "${TIMESTAMP}.tar.gz" "$TIMESTAMP"
rm -rf "$TIMESTAMP"
echo "バックアップ: backups/${TIMESTAMP}.tar.gz"
