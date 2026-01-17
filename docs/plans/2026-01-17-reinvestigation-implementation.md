# Reinvestigation on New Comments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the investigator to reinvestigate open issues when new comments/activity appear after initial investigation.

**Architecture:** Change `investigated.json` from storing issue numbers to storing objects with timestamps. During catchup scan, compare GitHub's `updatedAt` against our `investigatedAt` to detect new activity.

**Tech Stack:** Node.js, Bash, GitHub CLI (`gh`)

---

### Task 1: Update queue.sh - Migrate and Update is_investigated()

**Files:**
- Modify: `claude-investigator/queue.sh:15-23` (is_investigated function)
- Modify: `claude-investigator/queue.sh:9-13` (queue_init function)

**Step 1: Add migration function to queue.sh**

Add after line 13 (after `queue_init` function):

```bash
# Migrate old investigated format (array) to new format (object with timestamps)
# Old: { "repo": [1, 2, 3] }
# New: { "repo": { "1": { "investigatedAt": "..." }, "2": { ... } } }
migrate_investigated_format() {
    [ -f "$INVESTIGATED_FILE" ] || return 0

    # Check if migration needed (if any value is an array)
    if jq -e 'to_entries | map(select(.value | type == "array")) | length > 0' "$INVESTIGATED_FILE" > /dev/null 2>&1; then
        echo "Migrating investigated.json to new format..."
        local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        local tmp="$(mktemp)"
        jq --arg ts "$timestamp" '
          to_entries | map(
            if (.value | type) == "array" then
              .value = (.value | map({key: (. | tostring), value: {investigatedAt: $ts}}) | from_entries)
            else .
            end
          ) | from_entries
        ' "$INVESTIGATED_FILE" > "$tmp" && mv "$tmp" "$INVESTIGATED_FILE"
        echo "Migration complete"
    fi
}
```

**Step 2: Update queue_init to call migration**

Replace `queue_init` function:

```bash
# Initialize state files if they don't exist
queue_init() {
    [ -f "$QUEUE_FILE" ] || echo '[]' > "$QUEUE_FILE"
    [ -f "$INVESTIGATED_FILE" ] || echo '{}' > "$INVESTIGATED_FILE"
    migrate_investigated_format
}
```

**Step 3: Update is_investigated function**

Replace `is_investigated` function:

```bash
# Check if issue is already investigated
# Usage: is_investigated "owner/repo" 42
is_investigated() {
    local repo="$1"
    local issue="$2"
    queue_init
    jq -e --arg repo "$repo" --arg issue "$issue" \
        '.[$repo][$issue] != null' "$INVESTIGATED_FILE" > /dev/null 2>&1
}
```

**Step 4: Test migration locally**

```bash
# Create test old-format file
echo '{"test/repo": [1, 2, 3]}' > /tmp/test-investigated.json
INVESTIGATED_FILE=/tmp/test-investigated.json
source claude-investigator/queue.sh
queue_init
cat /tmp/test-investigated.json
# Expected: {"test/repo": {"1": {"investigatedAt": "..."}, "2": {...}, "3": {...}}}
```

**Step 5: Commit**

```bash
git add claude-investigator/queue.sh
git commit -m "feat: add migration and update is_investigated for timestamp format"
```

---

### Task 2: Update queue.sh - Update mark_investigated()

**Files:**
- Modify: `claude-investigator/queue.sh:79-88` (mark_investigated function)

**Step 1: Update mark_investigated function**

Replace `mark_investigated` function:

```bash
# Mark issue as investigated with timestamp
# Usage: mark_investigated "owner/repo" 42
mark_investigated() {
    local repo="$1"
    local issue="$2"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    queue_init
    local tmp="$(mktemp)"
    jq --arg repo "$repo" --arg issue "$issue" --arg ts "$timestamp" \
        '.[$repo][$issue] = {investigatedAt: $ts}' "$INVESTIGATED_FILE" > "$tmp" \
        && mv "$tmp" "$INVESTIGATED_FILE"
    echo "Marked $repo#$issue as investigated at $timestamp"
}
```

**Step 2: Commit**

```bash
git add claude-investigator/queue.sh
git commit -m "feat: update mark_investigated to store timestamp"
```

---

### Task 3: Add get_investigated_time helper to queue.sh

**Files:**
- Modify: `claude-investigator/queue.sh` (add new function after mark_investigated)

**Step 1: Add get_investigated_time function**

Add after `mark_investigated`:

```bash
# Get the timestamp when issue was last investigated
# Usage: ts=$(get_investigated_time "owner/repo" 42)
# Returns: ISO timestamp or empty if not investigated
get_investigated_time() {
    local repo="$1"
    local issue="$2"
    queue_init
    jq -r --arg repo "$repo" --arg issue "$issue" \
        '.[$repo][$issue].investigatedAt // empty' "$INVESTIGATED_FILE"
}
```

**Step 2: Commit**

```bash
git add claude-investigator/queue.sh
git commit -m "feat: add get_investigated_time helper"
```

---

### Task 4: Update server.js - Migration and isInvestigated()

**Files:**
- Modify: `claude-investigator/server.js:36-40` (isInvestigated function)
- Modify: `claude-investigator/server.js:12-20` (initState function)

**Step 1: Add migration function to server.js**

Add after `writeJson` function (after line 34):

```javascript
// Migrate old investigated format (array) to new format (object with timestamps)
function migrateInvestigatedFormat() {
    const investigated = readJson(INVESTIGATED_FILE, {});
    let needsMigration = false;

    for (const repo in investigated) {
        if (Array.isArray(investigated[repo])) {
            needsMigration = true;
            break;
        }
    }

    if (needsMigration) {
        console.log('Migrating investigated.json to new format...');
        const timestamp = new Date().toISOString();
        const migrated = {};

        for (const repo in investigated) {
            if (Array.isArray(investigated[repo])) {
                migrated[repo] = {};
                for (const issue of investigated[repo]) {
                    migrated[repo][issue.toString()] = { investigatedAt: timestamp };
                }
            } else {
                migrated[repo] = investigated[repo];
            }
        }

        writeJson(INVESTIGATED_FILE, migrated);
        console.log('Migration complete');
    }
}
```

**Step 2: Update initState to call migration**

Replace `initState` function:

```javascript
// Initialize state files
function initState() {
    if (!fs.existsSync(QUEUE_FILE)) {
        fs.writeFileSync(QUEUE_FILE, '[]');
    }
    if (!fs.existsSync(INVESTIGATED_FILE)) {
        fs.writeFileSync(INVESTIGATED_FILE, '{}');
    }
    migrateInvestigatedFormat();
}
```

**Step 3: Update isInvestigated function**

Replace `isInvestigated` function:

```javascript
// Check if issue is investigated
function isInvestigated(repo, issue) {
    const investigated = readJson(INVESTIGATED_FILE, {});
    const repoData = investigated[repo];
    return repoData && repoData[issue.toString()] !== undefined;
}
```

**Step 4: Commit**

```bash
git add claude-investigator/server.js
git commit -m "feat: add migration and update isInvestigated in server.js"
```

---

### Task 5: Add getInvestigatedTime and hasNewActivity to server.js

**Files:**
- Modify: `claude-investigator/server.js` (add after isInvestigated)

**Step 1: Add helper functions**

Add after `isInvestigated`:

```javascript
// Get timestamp when issue was last investigated
function getInvestigatedTime(repo, issue) {
    const investigated = readJson(INVESTIGATED_FILE, {});
    const repoData = investigated[repo];
    if (repoData && repoData[issue.toString()]) {
        return repoData[issue.toString()].investigatedAt;
    }
    return null;
}

// Get open issues with their updatedAt timestamps
function getOpenIssuesWithUpdates(repo) {
    try {
        const output = execSync(
            `gh issue list --repo "${repo}" --state open --json number,updatedAt`,
            { encoding: 'utf8', timeout: 30000 }
        );
        return JSON.parse(output);
    } catch (e) {
        console.error(`Failed to fetch open issues for ${repo}:`, e.message);
        return [];
    }
}

// Check if issue has new activity since last investigation
function hasNewActivity(repo, issue, investigatedAt) {
    try {
        const output = execSync(
            `gh issue view ${issue} --repo "${repo}" --json updatedAt`,
            { encoding: 'utf8', timeout: 15000 }
        );
        const data = JSON.parse(output);
        const issueUpdatedAt = new Date(data.updatedAt);
        const lastInvestigated = new Date(investigatedAt);
        return issueUpdatedAt > lastInvestigated;
    } catch (e) {
        console.error(`Failed to check activity for ${repo}#${issue}:`, e.message);
        return false;
    }
}
```

**Step 2: Commit**

```bash
git add claude-investigator/server.js
git commit -m "feat: add getInvestigatedTime and hasNewActivity helpers"
```

---

### Task 6: Update addToQueue to support reinvestigation flag

**Files:**
- Modify: `claude-investigator/server.js:49-61` (addToQueue function)

**Step 1: Update addToQueue to accept reinvestigation flag**

Replace `addToQueue` function:

```javascript
// Add to queue
function addToQueue(repo, issue, reinvestigation = false) {
    if (isQueued(repo, issue)) {
        return false;
    }
    // Skip if already investigated (unless this is a reinvestigation)
    if (!reinvestigation && isInvestigated(repo, issue)) {
        return false;
    }
    const queue = readJson(QUEUE_FILE, []);
    queue.push({
        repo,
        issue,
        added: new Date().toISOString(),
        reinvestigation: reinvestigation
    });
    writeJson(QUEUE_FILE, queue);
    return true;
}
```

**Step 2: Commit**

```bash
git add claude-investigator/server.js
git commit -m "feat: support reinvestigation flag in addToQueue"
```

---

### Task 7: Update catchup scan to check for new activity

**Files:**
- Modify: `claude-investigator/server.js:107-149` (handleInvestigate function)

**Step 1: Replace the catchup scan logic**

Replace the catchup scan section in `handleInvestigate` (lines ~113-127):

```javascript
    // Catchup scan with reinvestigation support
    console.log(`Scanning for issues needing investigation in ${repo}...`);
    const openIssues = getOpenIssuesWithUpdates(repo);
    let catchupCount = 0;
    let reinvestigateCount = 0;

    for (const issueData of openIssues) {
        const issueNum = issueData.number;

        if (!isInvestigated(repo, issueNum)) {
            // New issue, never investigated
            if (addToQueue(repo, issueNum)) {
                console.log(`Catchup: added ${repo}#${issueNum} (new)`);
                catchupCount++;
            }
        } else {
            // Already investigated - check for new activity
            const investigatedAt = getInvestigatedTime(repo, issueNum);
            if (investigatedAt) {
                const issueUpdatedAt = new Date(issueData.updatedAt);
                const lastInvestigated = new Date(investigatedAt);

                if (issueUpdatedAt > lastInvestigated) {
                    if (addToQueue(repo, issueNum, true)) {
                        console.log(`Reinvestigate: added ${repo}#${issueNum} (updated since ${investigatedAt})`);
                        reinvestigateCount++;
                    }
                }
            }
        }
    }
```

**Step 2: Update the response to include reinvestigation count**

Update the response JSON (around line 141):

```javascript
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'queued',
        repo,
        issue,
        queue_length: queue.length,
        catchup_added: catchupCount,
        reinvestigate_added: reinvestigateCount,
        worker: workerStatus
    }));
```

**Step 3: Commit**

```bash
git add claude-investigator/server.js
git commit -m "feat: check for new activity on investigated issues during catchup"
```

---

### Task 8: Update investigate-issue.sh to handle reinvestigation

**Files:**
- Modify: `claude-investigator/investigate-issue.sh`

**Step 1: Read the current investigate-issue.sh**

First, read the file to understand its structure.

**Step 2: Add reinvestigation context to Claude prompt**

The worker passes the queue item to investigate-issue.sh. Update it to check for reinvestigation flag and adjust the prompt accordingly.

Add near the top after argument parsing:

```bash
REINVESTIGATION="${3:-false}"
```

And update the Claude prompt section to include reinvestigation context when applicable:

```bash
if [ "$REINVESTIGATION" = "true" ]; then
    REINVESTIGATION_CONTEXT="

IMPORTANT: This issue was previously investigated but has new activity (comments or updates) since then.
Focus on what's NEW since the last investigation. Check recent comments for:
- Additional context from the issue author
- Clarifying questions that were answered
- New information about the problem
- Feedback on previous investigation findings"
else
    REINVESTIGATION_CONTEXT=""
fi
```

Then include `$REINVESTIGATION_CONTEXT` in the prompt passed to Claude.

**Step 3: Commit**

```bash
git add claude-investigator/investigate-issue.sh
git commit -m "feat: add reinvestigation context to Claude prompt"
```

---

### Task 9: Update worker.sh to pass reinvestigation flag

**Files:**
- Modify: `claude-investigator/worker.sh:30-31`

**Step 1: Extract reinvestigation flag and pass to investigate-issue.sh**

Update the item parsing and investigation call:

```bash
    REPO=$(echo "$ITEM" | jq -r '.repo')
    ISSUE=$(echo "$ITEM" | jq -r '.issue')
    REINVESTIGATION=$(echo "$ITEM" | jq -r '.reinvestigation // false')
```

And update the investigation call:

```bash
    if /investigate-issue.sh "$REPO" "$ISSUE" "$REINVESTIGATION"; then
```

**Step 2: Commit**

```bash
git add claude-investigator/worker.sh
git commit -m "feat: pass reinvestigation flag to investigate-issue.sh"
```

---

### Task 10: Update queue.sh catchup to support reinvestigation

**Files:**
- Modify: `claude-investigator/queue.sh` (add queue_add_reinvestigation function)
- Modify: `claude-investigator/investigate.sh:39-48` (catchup scan)

**Step 1: Add reinvestigation support to queue_add**

Update `queue_add` function to accept optional reinvestigation flag:

```bash
# Add issue to queue (if not already queued or investigated)
# Usage: queue_add "owner/repo" 42 [reinvestigation]
# Returns: 0 if added, 1 if skipped
queue_add() {
    local repo="$1"
    local issue="$2"
    local reinvestigation="${3:-false}"
    queue_init

    # Skip if not reinvestigation and already investigated
    if [ "$reinvestigation" != "true" ] && is_investigated "$repo" "$issue"; then
        echo "Issue $repo#$issue already investigated, skipping"
        return 1
    fi

    if is_queued "$repo" "$issue"; then
        echo "Issue $repo#$issue already in queue, skipping"
        return 1
    fi

    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local tmp="$(mktemp)"
    jq --arg repo "$repo" --argjson issue "$issue" --arg ts "$timestamp" --argjson reinv "$reinvestigation" \
        '. + [{"repo": $repo, "issue": $issue, "added": $ts, "reinvestigation": $reinv}]' "$QUEUE_FILE" > "$tmp" \
        && mv "$tmp" "$QUEUE_FILE"
    echo "Added $repo#$issue to queue (reinvestigation: $reinvestigation)"
    return 0
}
```

**Step 2: Update investigate.sh catchup scan**

Replace the catchup scan section in `investigate.sh`:

```bash
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
            echo "Found uninvestigated issue: #$issue_num"
            queue_add "$REPO" "$issue_num" false || true
        else
            # Check if issue has new activity
            investigated_at=$(get_investigated_time "$REPO" "$issue_num")
            if [ -n "$investigated_at" ]; then
                # Compare timestamps (using date for portability)
                issue_ts=$(date -d "$issue_updated" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$issue_updated" +%s 2>/dev/null || echo 0)
                investigated_ts=$(date -d "$investigated_at" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$investigated_at" +%s 2>/dev/null || echo 0)

                if [ "$issue_ts" -gt "$investigated_ts" ]; then
                    echo "Found issue with new activity: #$issue_num (updated since $investigated_at)"
                    queue_add "$REPO" "$issue_num" true || true
                fi
            fi
        fi
    done
else
    echo "Could not fetch open issues (gh CLI error or no issues)"
fi
```

**Step 3: Commit**

```bash
git add claude-investigator/queue.sh claude-investigator/investigate.sh
git commit -m "feat: add reinvestigation support to queue.sh and investigate.sh"
```

---

### Task 11: Final testing and version bump

**Step 1: Test locally if possible**

Create test investigated.json with old format and verify migration works.

**Step 2: Update version in any config files if applicable**

**Step 3: Final commit with all changes**

```bash
git status
# Verify all changes are committed
```

**Step 4: Push to main**

```bash
git push origin main
```

---

## Post-Implementation

After pushing:
1. Rebuild the add-on in Home Assistant
2. Trigger a test investigation to verify:
   - Migration works (check /data/investigated.json format)
   - New issues get queued
   - Previously investigated issues with new comments get requeued with `reinvestigation: true`
