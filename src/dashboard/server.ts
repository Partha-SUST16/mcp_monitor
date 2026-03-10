import express from 'express';
import path from 'path';
import { Request, Response } from 'express';
import { eventBus } from '../core/EventBus';
import { CollectorEvent, AlertEvent } from '../types';
import { createOverviewRouter } from './routes/overview';
import { createSessionsRouter } from './routes/sessions';
import { createToolsRouter } from './routes/tools';
import { createServersRouter } from './routes/servers';
import { createAlertsRouter } from './routes/alerts';
import { createIngestRouter } from '../ingestion/IngestEndpoint';

export function createDashboardServer(port: number) {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    app.use('/api', createOverviewRouter());
    app.use('/api', createSessionsRouter());
    app.use('/api', createToolsRouter());
    app.use('/api', createServersRouter());
    app.use('/api', createAlertsRouter());
    app.use('/api', createIngestRouter());

    app.get('/api/stream', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

        const onCall = (event: CollectorEvent) => {
            res.write(`event: tool_call\ndata: ${JSON.stringify(event)}\n\n`);
        };
        const onAlert = (alert: AlertEvent) => {
            res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
        };

        eventBus.on('tool_call', onCall);
        eventBus.on('alert', onAlert);

        req.on('close', () => {
            clearInterval(heartbeat);
            eventBus.off('tool_call', onCall);
            eventBus.off('alert', onAlert);
        });
    });

    // Serve React UI build output
    const uiDistPath = path.join(__dirname, 'ui', 'dist');
    app.use(express.static(uiDistPath));
    app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(uiDistPath, 'index.html'), (err) => {
            if (err) {
                res.status(200).send('Dashboard UI not built yet. Run the UI build first.');
            }
        });
    });

    app.listen(port, () => {
        console.error(`[mcp-monitor] Dashboard running at http://localhost:${port}`);
    });

    return app;
}
