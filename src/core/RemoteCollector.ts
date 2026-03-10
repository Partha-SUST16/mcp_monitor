import http from 'http';
import { CollectorEvent } from '../types';

export class RemoteCollector {
    constructor(private dashboardUrl: string = 'http://localhost:4242') { }

    handle(event: CollectorEvent) {
        const data = JSON.stringify(event);
        const url = new URL(`${this.dashboardUrl}/api/ingest`);

        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            res.resume();
        });

        req.on('error', (err) => {
            process.stderr.write(`[mcp-monitor] Failed to send event to dashboard: ${err.message}\n`);
        });

        req.write(data);
        req.end();
    }
}
