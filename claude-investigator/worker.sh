#!/usr/bin/env bash
set -e

# Source queue helpers
source /queue.sh

echo "=== Investigation Worker Started ==="
echo "PID: $$"

# Acquire lock
worker_lock_acquire
trap 'worker_lock_release; echo "Worker exiting"' EXIT

# Failure tracking for backoff
CONSECUTIVE_FAILURES=0
MAX_FAILURES_BEFORE_BACKOFF=3
MAX_FAILURES_BEFORE_EXIT=6
BACKOFF_SECONDS=1800  # 30 minutes

# Main loop
while true; do
    # Get next item
    ITEM=$(queue_peek)

    if [ -z "$ITEM" ]; then
        echo "Queue empty, worker finished"
        break
    fi

    REPO=$(echo "$ITEM" | jq -r '.repo')
    ISSUE=$(echo "$ITEM" | jq -r '.issue')
    REINVESTIGATION=$(echo "$ITEM" | jq -r '.reinvestigation // false')

    echo ""
    echo "=== Processing $REPO#$ISSUE ==="
    echo "Queue length: $(queue_length)"
    echo "Consecutive failures: $CONSECUTIVE_FAILURES"

    # Run investigation
    if /investigate-issue.sh "$REPO" "$ISSUE" "$REINVESTIGATION"; then
        echo "Investigation succeeded for $REPO#$ISSUE"
        mark_investigated "$REPO" "$ISSUE"
        queue_pop
        CONSECUTIVE_FAILURES=0
    else
        echo "Investigation failed for $REPO#$ISSUE"
        CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))

        # Move failed item to end of queue (so we try others first)
        queue_pop
        queue_add "$REPO" "$ISSUE" || true  # Re-add to end

        if [ $CONSECUTIVE_FAILURES -ge $MAX_FAILURES_BEFORE_EXIT ]; then
            echo "ERROR: $CONSECUTIVE_FAILURES consecutive failures, giving up"
            echo "Remaining items will be processed on next trigger"
            break
        elif [ $CONSECUTIVE_FAILURES -ge $MAX_FAILURES_BEFORE_BACKOFF ]; then
            echo "WARNING: $CONSECUTIVE_FAILURES consecutive failures, backing off for 30 minutes"
            sleep $BACKOFF_SECONDS
            CONSECUTIVE_FAILURES=0  # Reset after backoff
        fi
    fi
done

echo "=== Investigation Worker Finished ==="
