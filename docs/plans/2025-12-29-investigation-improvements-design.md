# Investigation Improvements Design

Date: 2025-12-29

## Overview

Improvements to Claude Investigator based on real-world usage observations. Key changes: fail-fast ADB logic, guardrails against destructive operations, confidence-based draft PR creation, and documentation updates.

---

## 1. ADB Connection Logic

### Problem
ADB connection attempts flood logs indefinitely when phone is unreachable.

### Solution
Fail-fast with limited retries:

1. **Pre-check** before starting socat:
   - `tailscale nc $PHONE_IP $PHONE_PORT` with 5s timeout
   - Up to 3 attempts
   - If all fail → mark ADB unavailable, skip socat entirely

2. **ADB connection** (only if pre-check passes):
   - Start socat proxy
   - `adb connect` with 5s timeout, up to 3 attempts
   - If fails → kill socat, mark unavailable

3. **Prompt instruction**: Do not attempt ADB commands if marked unavailable

**Total max wait:** ~30 seconds, then moves on.

---

## 2. Guardrails

### Explicit Prohibitions (in prompt)

```
NEVER do the following:
- git push to main or master (feature branches only)
- adb install or adb uninstall
- SQL: Only SELECT queries. No DROP, DELETE, UPDATE, INSERT.
- Attempt ADB commands if ADB was marked unavailable
```

### Structural Safeguards
- All PRs created as drafts (cannot merge without manual intervention)
- Claude runs as non-root user (already in place)
- Allowed tools: `Bash, Read, Write, Edit, Glob, Grep`

---

## 3. Confidence-Based Draft PR Creation

### Criteria (all must be true)

1. Identified specific file(s) and line(s)
2. Root cause understood, not just symptoms
3. Fix is localized (≤3 files)
4. No ambiguity in intended behavior from the issue

### Workflow

1. Create branch: `fix/issue-{number}`
2. Commit with message: `fix: {description} (closes #{number})`
3. Push branch
4. Create draft PR: `gh pr create --draft`
5. Include PR link in issue comment

### Guideline
Follow existing patterns in the codebase when implementing fixes.

---

## 4. Prompt Additions

### Root Cause Analysis

```
6. When analyzing, focus on ROOT CAUSE not symptoms:
   - Look for similar WORKING code to compare against
   - Trace data flow: where does the bad value originate?
   - State hypothesis clearly: "X causes this because Y"
```

### Confidence Assessment

```
7. Before deciding whether to prepare a fix, assess confidence:
   - Did you identify specific file(s) and line(s)?
   - Do you understand WHY the bug happens (not just what)?
   - Is the fix localized (≤3 files)?
   - Is the intended behavior unambiguous from the issue?

   If ALL are true → create a draft PR
   If ANY are false → comment with findings only, suggest manual next steps
```

### Fix Guidelines

```
8. When preparing a fix:
   - Follow existing patterns in the codebase
   - Create branch: fix/issue-{number}
   - Commit message: "fix: {description} (closes #{number})"
   - Use: gh pr create --draft --title "..." --body "..."
   - Reference the PR in your issue comment
```

---

## 5. Updated Issue Comment Format

```markdown
## Investigation Findings

**Relevant Files:**
- `path/to/file.kt:123` - description

**Root Cause:**
X causes this because Y

**Fix Prepared:** [Draft PR #N](link)  ← only if criteria met

**Suggested Next Steps:**
1. Review the draft PR / or manual steps if no PR

---
_Automated investigation by Claude Investigator_
```

---

## 6. Documentation

### A. claude-investigator-addon/CLAUDE.md (new)

Project context for working on the investigator itself.

### B. claude-investigator-addon/.claude-local.md (new, gitignored)

Local infrastructure details: IPs, SSH commands, Home Assistant URLs, Tailscale info.

### C. 531 tracker docs/bugs/README.md (update)

Add section on handling investigator-created draft PRs:
- Review draft PR linked in issue comment
- If good: mark ready, approve, merge
- If needs work: refine or close and fix manually

---

## Implementation Tasks

1. Update `investigate.sh`:
   - Add ADB pre-check with retries
   - Update prompt with guardrails, root cause guidance, confidence criteria
   - Add draft PR workflow instructions

2. Create `.gitignore` entry for `.claude-local.md`

3. Create `CLAUDE.md` for this project

4. Create `.claude-local.md` template

5. Update 531 tracker `docs/bugs/README.md`
