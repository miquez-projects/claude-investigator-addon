# Reinvestigation on New Comments + Organization Webhooks

**Date:** 2026-01-17
**Issue:** #1 - Investigator should check comments on previously investigated open issues

## Overview

Two related enhancements:
1. Reinvestigate open issues when new comments/activity appear after initial investigation
2. Support organization-wide webhooks for monitoring multiple repos

## Step 1: Repository Transfer (Manual Prerequisite)

Transfer personal repos to a new GitHub organization to enable org-level webhooks.

**Repos to transfer:**
- 531-tracker
- resource-optimisation
- claude-investigator-addon
- andsons-stock-checker
- sql-interview-practice
- anti-procrastinator
- swarm-visualiser

```bash
ORG="your-new-org-name"
for repo in 531-tracker resource-optimisation claude-investigator-addon andsons-stock-checker sql-interview-practice anti-procrastinator swarm-visualiser; do
  gh repo transfer "miquez/$repo" "$ORG"
done
```

**Post-transfer:** Reconnect Render/Vercel deployments to new org paths.

## Step 2: Organization Webhook Setup

1. Go to: `github.com/organizations/YOUR_ORG/settings/hooks`
2. Add webhook:
   - **Payload URL:** Investigator endpoint
   - **Content type:** `application/json`
   - **Events:** Issues, Issue comments
   - **Active:** Yes

3. Update Home Assistant automation to extract `repository.full_name` from webhook payload.

## Step 3: Data Model Changes

### Current format (`investigated.json`):
```json
{
  "owner/repo": [1, 2, 3]
}
```

### New format:
```json
{
  "owner/repo": {
    "1": { "investigatedAt": "2026-01-17T12:00:00Z" },
    "2": { "investigatedAt": "2026-01-17T13:00:00Z" }
  }
}
```

**Migration:** On first run, detect old array format and convert. Use current time as `investigatedAt` for existing entries.

## Step 4: Reinvestigation Logic

During catchup scan, for each open issue already investigated:

1. Fetch issue update time:
   ```bash
   gh issue list --repo org/repo --state open --json number,updatedAt
   ```

2. Compare `updatedAt` against stored `investigatedAt`

3. If newer activity exists, add to queue with `reinvestigation: true` flag

**Rate limiting:** Use batch fetch of `updatedAt` times rather than individual API calls per issue.

## Files to Modify

| File | Changes |
|------|---------|
| `queue.sh` | Update `is_investigated()` and `mark_investigated()` for new format, add migration |
| `server.js` | Update `isInvestigated()`, add `hasNewActivity()`, modify catchup scan |
| `investigate-issue.sh` | Accept `reinvestigation` flag to adjust Claude's prompt |

## New Helper Functions

- `hasNewActivity(repo, issue)` - checks GitHub API for updates after `investigatedAt`
- `migrateInvestigatedFormat()` - one-time migration from array to object format

## No Changes Needed

- `worker.sh` - already calls `mark_investigated()`
- `Dockerfile` - no new dependencies
- `run.sh` - no changes
