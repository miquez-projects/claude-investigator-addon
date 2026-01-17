#!/usr/bin/env bash
# CLI entry point for manual investigation
# Usage: investigate.sh <owner/repo> <issue_number>
#
# This script:
# 1. Adds the issue to the queue
# 2. Scans for other uninvestigated open issues
# 3. Starts worker if not already running

set -e

source /queue.sh

REPO="$1"
ISSUE="$2"

if [ -z "$REPO" ] || [ -z "$ISSUE" ]; then
    echo "Usage: investigate.sh <owner/repo> <issue_number>"
    exit 1
fi

echo "=== Investigation Trigger ==="
echo "Repository: $REPO"
echo "Issue: #$ISSUE"

# Initialize queue
queue_init

# Add triggered issue to queue
queue_add "$REPO" "$ISSUE" || true

# Catchup scan: find all open issues needing investigation
echo ""
echo "=== Catchup Scan ==="
echo "Checking for issues needing investigation in $REPO..."

OPEN_ISSUES=$(gh issue list --repo "$REPO" --state open --json number,updatedAt 2>/dev/null || echo "[]")

if [ "$OPEN_ISSUES" != "[]" ]; then
    echo "$OPEN_ISSUES" | jq -c '.[]' | while read -r issue_data; do
        issue_num=$(echo "$issue_data" | jq -r '.number')
        issue_updated=$(echo "$issue_data" | jq -r '.updatedAt')

        if ! is_investigated "$REPO" "$issue_num"; then
            if ! is_queued "$REPO" "$issue_num"; then
                echo "Found uninvestigated issue: #$issue_num"
                queue_add "$REPO" "$issue_num" false || true
            fi
        else
            # Check if issue has new activity
            investigated_at=$(get_investigated_time "$REPO" "$issue_num")
            if [ -n "$investigated_at" ]; then
                # Compare timestamps using date command
                # macOS uses -j -f, Linux uses -d
                issue_ts=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$issue_updated" +%s 2>/dev/null || date -d "$issue_updated" +%s 2>/dev/null || echo 0)
                investigated_ts=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$investigated_at" +%s 2>/dev/null || date -d "$investigated_at" +%s 2>/dev/null || echo 0)

                if [ "$issue_ts" -gt "$investigated_ts" ] 2>/dev/null; then
                    if ! is_queued "$REPO" "$issue_num"; then
                        echo "Found issue with new activity: #$issue_num (updated since $investigated_at)"
                        queue_add "$REPO" "$issue_num" true || true
                    fi
                fi
            fi
        fi
    done
else
    echo "Could not fetch open issues (gh CLI error or no issues)"
fi

echo ""
echo "Queue length: $(queue_length)"

# Start worker if not running
if worker_running; then
    echo "Worker already running (PID $(cat "$WORKER_LOCK")), it will pick up queued items"
else
    echo "Starting worker..."
    nohup /worker.sh >> /data/logs/worker-$(date +%Y%m%d-%H%M%S).log 2>&1 &
    echo "Worker started with PID $!"
fi

echo "=== Trigger Complete ==="
