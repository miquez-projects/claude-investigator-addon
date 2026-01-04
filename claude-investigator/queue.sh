#!/usr/bin/env bash
# Queue management functions for investigation system
# All state files live in /data/

QUEUE_FILE="/data/queue.json"
INVESTIGATED_FILE="/data/investigated.json"
WORKER_LOCK="/data/worker.lock"

# Initialize state files if they don't exist
queue_init() {
    [ -f "$QUEUE_FILE" ] || echo '[]' > "$QUEUE_FILE"
    [ -f "$INVESTIGATED_FILE" ] || echo '{}' > "$INVESTIGATED_FILE"
}

# Check if issue is already investigated
# Usage: is_investigated "owner/repo" 42
is_investigated() {
    local repo="$1"
    local issue="$2"
    queue_init
    jq -e --arg repo "$repo" --argjson issue "$issue" \
        '.[$repo] // [] | index($issue) != null' "$INVESTIGATED_FILE" > /dev/null 2>&1
}

# Check if issue is already in queue
# Usage: is_queued "owner/repo" 42
is_queued() {
    local repo="$1"
    local issue="$2"
    queue_init
    jq -e --arg repo "$repo" --argjson issue "$issue" \
        '.[] | select(.repo == $repo and .issue == $issue)' "$QUEUE_FILE" > /dev/null 2>&1
}

# Add issue to queue (if not already queued or investigated)
# Usage: queue_add "owner/repo" 42
# Returns: 0 if added, 1 if skipped
queue_add() {
    local repo="$1"
    local issue="$2"
    queue_init

    if is_investigated "$repo" "$issue"; then
        echo "Issue $repo#$issue already investigated, skipping"
        return 1
    fi

    if is_queued "$repo" "$issue"; then
        echo "Issue $repo#$issue already in queue, skipping"
        return 1
    fi

    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local tmp="$(mktemp)"
    jq --arg repo "$repo" --argjson issue "$issue" --arg ts "$timestamp" \
        '. + [{"repo": $repo, "issue": $issue, "added": $ts}]' "$QUEUE_FILE" > "$tmp" \
        && mv "$tmp" "$QUEUE_FILE"
    echo "Added $repo#$issue to queue"
    return 0
}

# Get next item from queue (first item, FIFO)
# Usage: item=$(queue_peek) # Returns JSON object or empty
queue_peek() {
    queue_init
    jq -c '.[0] // empty' "$QUEUE_FILE"
}

# Remove first item from queue
# Usage: queue_pop
queue_pop() {
    queue_init
    local tmp="$(mktemp)"
    jq '.[1:]' "$QUEUE_FILE" > "$tmp" && mv "$tmp" "$QUEUE_FILE"
}

# Mark issue as investigated
# Usage: mark_investigated "owner/repo" 42
mark_investigated() {
    local repo="$1"
    local issue="$2"
    queue_init
    local tmp="$(mktemp)"
    jq --arg repo "$repo" --argjson issue "$issue" \
        '.[$repo] = ((.[$repo] // []) + [$issue] | unique)' "$INVESTIGATED_FILE" > "$tmp" \
        && mv "$tmp" "$INVESTIGATED_FILE"
    echo "Marked $repo#$issue as investigated"
}

# Get queue length
# Usage: len=$(queue_length)
queue_length() {
    queue_init
    jq 'length' "$QUEUE_FILE"
}

# Check if worker is running (PID alive)
# Usage: if worker_running; then ...
worker_running() {
    [ -f "$WORKER_LOCK" ] || return 1
    local pid="$(cat "$WORKER_LOCK" 2>/dev/null)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Acquire worker lock
# Usage: worker_lock_acquire
worker_lock_acquire() {
    echo "$$" > "$WORKER_LOCK" || return 1
}

# Release worker lock
# Usage: worker_lock_release
worker_lock_release() {
    rm -f "$WORKER_LOCK"
}
