# Queue-Based Investigation System

## Problem

Current system has reliability gaps:
- Webhooks can be missed (HA down, network issues)
- Multiple rapid issue reports cause concurrent Claude instances
- No guarantee every issue gets investigated
- No notification when investigation completes

**Desired state:** Report issues from anywhere, forget about them, trust they'll all be investigated eventually.

## Solution Overview

Sequential queue-based processing with catchup scanning:
- One investigation runs at a time (no concurrency issues)
- Every trigger also scans for all uninvestigated open issues
- Issue author gets mentioned in comment for GitHub notification
- Consecutive failures trigger backoff (handles rate limits)

## Data Files

All stored in `/data/`:

### queue.json
```json
[
  {"repo": "owner/repo", "issue": 42, "added": "2026-01-04T10:30:00Z"},
  {"repo": "owner/repo", "issue": 43, "added": "2026-01-04T10:31:00Z"}
]
```

### investigated.json
```json
{
  "owner/repo": [1, 2, 5, 42],
  "owner/other": [10, 11]
}
```

### worker.lock
Contains PID of running worker process. Used to prevent multiple workers.

## Trigger Flow (server.js)

When `/investigate` webhook arrives:

1. **Receive** `{repo, issue}` from webhook

2. **Add to queue** (if not already queued or investigated)
   - Load queue.json and investigated.json
   - Skip if issue already in queue or already investigated
   - Append to queue.json if new

3. **Catchup scan**
   - Run: `gh issue list --repo {repo} --state open --json number`
   - For each open issue, check if in investigated.json
   - Add uninvestigated issues to queue (deduped)

4. **Start worker if not running**
   - Check worker.lock - does PID exist and is process alive?
   - If no worker running, spawn worker.sh (detached)
   - If worker already running, do nothing (it will pick up new items)

5. **Return 200 immediately**
   - Response: `{"status": "queued", "queue_length": N}`

## Worker Flow (worker.sh)

### Lifecycle

1. **Startup**
   - Write own PID to worker.lock
   - Log: "Worker started"

2. **Main loop**
   - Load queue.json
   - If empty → exit (cleanup lock file)
   - Take first item from queue (FIFO)

3. **Process one issue**
   - Call investigation logic (clone/update repo, run Claude)
   - On success:
     - Add issue to investigated.json
     - Remove from queue.json
     - Log: "Completed owner/repo#42"
   - On failure:
     - Leave in queue (will retry next cycle)
     - Log error
     - Continue to next item

4. **Loop back to step 2**

5. **Cleanup on exit**
   - Remove worker.lock
   - Log: "Worker finished, queue empty"

### Failure Handling

Track consecutive failures:
- On success: reset counter to 0
- On failure: increment counter

**Backoff logic:**
- `consecutive_failures >= 3`: Sleep 30 minutes, reset counter, retry
- `consecutive_failures >= 6`: Exit worker, leave items in queue for next trigger

This handles:
- Single bad issue: fails once, moves on, counter resets on next success
- Rate limits: fails 3x → waits 30 min → Claude likely available again
- Prolonged outage: fails 6x → gives up, retries on next webhook

### Stale Lock Detection

Before spawning worker, check if PID in lock file is actually alive.
If process is dead but lock exists, remove stale lock and start fresh.

## Issue Author Notification

Before running Claude, fetch the issue author:

```bash
ISSUE_AUTHOR=$(gh issue view $ISSUE --repo $REPO --json author --jq '.author.login')
```

Update comment template to mention them:

```
## Investigation Findings

@{author} _(investigation complete)_

**Relevant Files:**
...
```

## File Changes

### Modified

| File | Changes |
|------|---------|
| `server.js` | Replace direct spawn with queue management, catchup scan, worker spawning |
| `investigate.sh` | Extract core logic, add author fetch, update comment template |

### New

| File | Purpose |
|------|---------|
| `worker.sh` | Queue processor - loops until empty, handles failures |
| `queue.sh` | Helper functions for queue/state file operations |

## End-to-End Example

```
User @ gym: Create issues #44, #45, #46
     ↓
Webhook for #44 → server.js
     ↓
Queue: [#44] + catchup finds #45, #46 → [#44, #45, #46]
     ↓
Worker spawns, processes #44
     ↓
(Claude rate limited after #44)
     ↓
#45 fails, #46 fails, #47 fails → backoff 30min
     ↓
Retry → #45 succeeds, #46 succeeds
     ↓
Queue empty → worker exits
     ↓
User @ home: 3 GitHub notifications with investigation findings
```
