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

# Catchup scan: find all open issues not yet investigated
echo ""
echo "=== Catchup Scan ==="
echo "Checking for uninvestigated open issues in $REPO..."

OPEN_ISSUES=$(gh issue list --repo "$REPO" --state open --json number --jq '.[].number' 2>/dev/null || echo "")

if [ -n "$OPEN_ISSUES" ]; then
    for issue_num in $OPEN_ISSUES; do
        if ! is_investigated "$REPO" "$issue_num" && ! is_queued "$REPO" "$issue_num"; then
            echo "Found uninvestigated issue: #$issue_num"
            queue_add "$REPO" "$issue_num" || true
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
