const http = require('http');
const { spawn, execSync } = require('child_process');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = 8099;
const QUEUE_FILE = '/data/queue.json';
const INVESTIGATED_FILE = '/data/investigated.json';
const WORKER_LOCK = '/data/worker.lock';

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

// Read JSON file safely
function readJson(file, defaultValue) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return defaultValue;
    }
}

// Write JSON file
function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

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

// Check if issue is investigated
function isInvestigated(repo, issue) {
    const investigated = readJson(INVESTIGATED_FILE, {});
    const repoData = investigated[repo];
    return repoData && repoData[issue.toString()] !== undefined;
}

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

// Check if issue is in queue
function isQueued(repo, issue) {
    const queue = readJson(QUEUE_FILE, []);
    return queue.some(item => item.repo === repo && item.issue === issue);
}

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

// Get open issues from GitHub
function getOpenIssues(repo) {
    try {
        const output = execSync(
            `gh issue list --repo "${repo}" --state open --json number --jq '.[].number'`,
            { encoding: 'utf8', timeout: 30000 }
        );
        return output.trim().split('\n').filter(Boolean).map(Number);
    } catch (e) {
        console.error(`Failed to fetch open issues for ${repo}:`, e.message);
        return [];
    }
}

// Check if worker is running
function isWorkerRunning() {
    if (!fs.existsSync(WORKER_LOCK)) return false;
    try {
        const pid = parseInt(fs.readFileSync(WORKER_LOCK, 'utf8').trim());
        process.kill(pid, 0); // Check if process exists
        return true;
    } catch {
        return false;
    }
}

// Start worker
function startWorker() {
    const logFile = `/data/logs/worker-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    const logStream = fs.openSync(logFile, 'a');

    const child = spawn('/worker.sh', [], {
        detached: true,
        stdio: ['ignore', logStream, logStream],
        env: process.env
    });
    child.unref();
    fs.closeSync(logStream);  // Close FD in parent after spawn

    console.log(`Worker started with PID ${child.pid}, logging to ${logFile}`);
    return child.pid;
}

// Handle investigate request
function handleInvestigate(repo, issue, res) {
    initState();

    const added = addToQueue(repo, issue);
    console.log(`Issue ${repo}#${issue}: ${added ? 'added to queue' : 'already queued/investigated'}`);

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

    const queue = readJson(QUEUE_FILE, []);
    console.log(`Queue length: ${queue.length}, catchup added: ${catchupCount}`);

    // Start worker if needed
    let workerStatus;
    if (isWorkerRunning()) {
        workerStatus = 'already_running';
        console.log('Worker already running');
    } else if (queue.length > 0) {
        startWorker();
        workerStatus = 'started';
    } else {
        workerStatus = 'not_needed';
    }

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
}

// Handle GitHub webhook for issue comments (reinvestigation trigger)
function handleIssueComment(repo, issue, commenter, res) {
    initState();

    // Ignore bot comments to prevent loops
    if (commenter.endsWith('[bot]') || commenter === 'github-actions') {
        console.log(`Ignoring bot comment from ${commenter} on ${repo}#${issue}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ignored', reason: 'bot_comment' }));
        return;
    }

    // Only reinvestigate if issue was previously investigated
    if (!isInvestigated(repo, issue)) {
        console.log(`Issue ${repo}#${issue} not previously investigated, skipping comment trigger`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ignored', reason: 'not_previously_investigated' }));
        return;
    }

    // Queue for reinvestigation
    const added = addToQueue(repo, issue, true);
    console.log(`Comment on ${repo}#${issue} by ${commenter}: ${added ? 'queued for reinvestigation' : 'already queued'}`);

    // Start worker if needed
    let workerStatus;
    const queue = readJson(QUEUE_FILE, []);
    if (isWorkerRunning()) {
        workerStatus = 'already_running';
    } else if (queue.length > 0) {
        startWorker();
        workerStatus = 'started';
    } else {
        workerStatus = 'not_needed';
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: added ? 'queued' : 'already_queued',
        repo,
        issue,
        trigger: 'comment',
        commenter,
        worker: workerStatus
    }));
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // GitHub webhook endpoint - handles raw GitHub payloads
    if (req.method === 'POST' && parsedUrl.pathname === '/webhook') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const event = req.headers['x-github-event'];
                const repo = payload.repository?.full_name;

                console.log(`Webhook received: event=${event}, repo=${repo}`);

                if (event === 'issues' && payload.action === 'opened') {
                    // New issue opened
                    const issue = payload.issue?.number;
                    if (repo && issue) {
                        handleInvestigate(repo, issue, res);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing repo or issue in payload' }));
                    }
                } else if (event === 'issue_comment' && payload.action === 'created') {
                    // New comment on issue
                    const issue = payload.issue?.number;
                    const commenter = payload.comment?.user?.login || 'unknown';
                    if (repo && issue) {
                        handleIssueComment(repo, issue, commenter, res);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing repo or issue in payload' }));
                    }
                } else {
                    // Unhandled event type - acknowledge but ignore
                    console.log(`Ignoring event: ${event}/${payload.action}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ignored', event, action: payload.action }));
                }
            } catch (e) {
                console.error('Webhook error:', e);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else if (req.method === 'POST' && parsedUrl.pathname === '/investigate') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const repo = data.repo;
                const issue = parseInt(data.issue);

                // Validate repo format (owner/repo)
                const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
                if (!repo || !repoPattern.test(repo)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid repo format (expected owner/repo)' }));
                    return;
                }

                if (!issue) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing repo or issue' }));
                    return;
                }

                handleInvestigate(repo, issue, res);
            } catch (e) {
                console.error('Error:', e);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else if (req.method === 'GET' && parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'GET' && parsedUrl.pathname === '/queue') {
        initState();
        const queue = readJson(QUEUE_FILE, []);
        const investigated = readJson(INVESTIGATED_FILE, {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            queue_length: queue.length,
            queue,
            investigated,
            worker_running: isWorkerRunning()
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Investigation server listening on port ${PORT}`);
    initState();
});
