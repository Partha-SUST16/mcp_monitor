import http from 'http';
import https from 'https';
import { URL } from 'url';
import { collector } from '../../core/Collector';
import { sessionManager } from '../../core/SessionManager';
import { CollectorEvent } from '../../types';

export class HttpProxy {
    constructor(private config: { name: string; targetUrl: string; listenPort: number }) { }

    start() {
        const target = new URL(this.config.targetUrl);
        const isHttps = target.protocol === 'https:';

        const server = http.createServer((req, res) => {
            const startTime = Date.now();
            const timestamp = new Date().toISOString();

            let requestBody = '';
            req.on('data', (chunk) => { requestBody += chunk; });

            req.on('end', () => {
                const options: http.RequestOptions = {
                    hostname: target.hostname,
                    port: target.port || (isHttps ? 443 : 80),
                    path: req.url,
                    method: req.method,
                    headers: { ...req.headers, host: target.host },
                };

                const transport = isHttps ? https : http;
                const proxyReq = transport.request(options, (proxyRes) => {
                    let responseBody = '';
                    proxyRes.on('data', (chunk) => { responseBody += chunk; });

                    proxyRes.on('end', () => {
                        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
                        res.end(responseBody);

                        this.recordCall(requestBody, responseBody, startTime, timestamp);
                    });
                });

                proxyReq.on('error', (err) => {
                    res.writeHead(502);
                    res.end('Proxy error');
                    this.recordError(requestBody, err, startTime, timestamp);
                });

                if (requestBody) proxyReq.write(requestBody);
                proxyReq.end();
            });
        });

        server.listen(this.config.listenPort, () => {
            console.error(`[http-proxy] ${this.config.name} listening on port ${this.config.listenPort} → ${this.config.targetUrl}`);
        });
    }

    private recordCall(requestBody: string, responseBody: string, startTime: number, timestamp: string) {
        try {
            const reqJson = JSON.parse(requestBody);
            if (!reqJson.method) return;

            const sessionId = sessionManager.getOrCreate(this.config.name, reqJson.method === 'initialize');
            const toolName = reqJson.method === 'tools/call'
                ? reqJson.params?.name ?? reqJson.method
                : reqJson.method;

            let resJson: any = null;
            let status: 'success' | 'error' = 'success';
            let errorMsg: string | undefined;

            try {
                resJson = JSON.parse(responseBody);
                if (resJson.error) {
                    status = 'error';
                    errorMsg = resJson.error.message;
                }
            } catch { /* non-JSON response */ }

            const event: CollectorEvent = {
                sessionId,
                agentType: 'mcp-http',
                serverName: this.config.name,
                toolName,
                method: reqJson.method,
                arguments: reqJson.params?.arguments ?? reqJson.params,
                response: resJson?.result ?? null,
                status,
                latencyMs: Date.now() - startTime,
                timestamp,
                errorMsg,
            };

            collector.handle(event);
        } catch { /* ignore non-JSON requests */ }
    }

    private recordError(requestBody: string, err: Error, startTime: number, timestamp: string) {
        try {
            const reqJson = JSON.parse(requestBody);
            const sessionId = sessionManager.getOrCreate(this.config.name);

            collector.handle({
                sessionId,
                agentType: 'mcp-http',
                serverName: this.config.name,
                toolName: reqJson.method ?? 'unknown',
                method: reqJson.method ?? 'unknown',
                arguments: reqJson.params,
                response: null,
                status: 'error',
                latencyMs: Date.now() - startTime,
                timestamp,
                errorMsg: err.message,
            });
        } catch { /* ignore */ }
    }
}
