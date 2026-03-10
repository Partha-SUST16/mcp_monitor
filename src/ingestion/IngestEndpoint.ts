import { Router, Request, Response } from 'express';
import { collector } from '../core/Collector';
import { store } from '../core/Store';
import { CollectorEvent } from '../types';

export function createIngestRouter(): Router {
    const router = Router();

    router.post('/ingest', (req: Request, res: Response) => {
        const event = req.body as CollectorEvent;

        if (!event.sessionId || !event.toolName || !event.timestamp) {
            res.status(400).json({ error: 'missing required fields: sessionId, toolName, timestamp' });
            return;
        }

        if (!store.sessionExists(event.sessionId)) {
            store.createSession({
                id: event.sessionId,
                serverName: event.serverName || 'unknown',
                startedAt: event.timestamp,
            });
        }

        collector.handle(event);
        res.json({ ok: true });
    });

    return router;
}
