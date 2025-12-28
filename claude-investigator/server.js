const http = require('http');
const { spawn } = require('child_process');
const url = require('url');

const PORT = 8099;

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (req.method === 'POST' && parsedUrl.pathname === '/investigate') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const repo = data.repo;
                const issue = data.issue;

                if (!repo || !issue) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing repo or issue' }));
                    return;
                }

                console.log(`Starting investigation: ${repo} #${issue}`);

                // Spawn investigation in background
                const child = spawn('/investigate.sh', [repo, String(issue)], {
                    detached: true,
                    stdio: ['ignore', 'inherit', 'inherit'],
                    env: process.env
                });
                child.unref();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'started', repo, issue }));
            } catch (e) {
                console.error('Error:', e);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else if (req.method === 'GET' && parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Investigation server listening on port ${PORT}`);
});
