#!/bin/sh
# 給 crontab 使用的同步工作包裝：
# - 所有工作共用一把 flock 鎖依序執行，避免每日同步與每月匯入同時佔用記憶體。
# - 記憶體不足時讓核心優先結束這個工作（oom_score_adj=1000），而不是同一台主機上的 MySQL。
# - 日誌寫到 logs/<日誌名稱>.log，並加上開始、結束時間與結束代碼。
#
# 用法：scripts/cron-job.sh <日誌名稱> <npm script> [-- 參數...]
#   scripts/cron-job.sh sync-daily sync:daily
#   scripts/cron-job.sh sync-monthly sync:monthly -- --month=202609
set -u

if [ "$#" -lt 2 ]; then
    echo "用法：$0 <日誌名稱> <npm script> [-- 參數...]" >&2
    exit 2
fi

cd "$(dirname "$0")/.." || exit 1
log_name=$1
shift

LOCK_FILE=${CRON_JOB_LOCK_FILE:-/tmp/crawl-judicial-cases.lock}
# 等待鎖的秒數：每日同步最長約 3 小時，每月工作需要等它跑完
LOCK_WAIT_SECONDS=${CRON_JOB_LOCK_WAIT_SECONDS:-18000}
OOM_SCORE_ADJ=1000

mkdir -p logs
log_file="logs/$log_name.log"

if command -v choom >/dev/null 2>&1; then
    set -- choom -n "$OOM_SCORE_ADJ" -- flock -w "$LOCK_WAIT_SECONDS" "$LOCK_FILE" npm run -s "$@"
else
    set -- flock -w "$LOCK_WAIT_SECONDS" "$LOCK_FILE" npm run -s "$@"
fi

{
    echo "== start $(date '+%F %T %Z')"
    "$@"
    status=$?
    echo "== end $(date '+%F %T %Z') exit=$status"
} >> "$log_file" 2>&1

exit "$status"
