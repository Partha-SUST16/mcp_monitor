import { Router, Request, Response } from 'express';
import { store } from '../../core/Store';

const SINCE_MAP: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
};

export function createToolsRouter(): Router {
    const router = Router();

    router.get('/tools/stats', (req: Request, res: Response) => {
        const sinceKey = (req.query.since as string) || '24h';
        const sinceMs = SINCE_MAP[sinceKey] ?? SINCE_MAP['24h'];
        const since = new Date(Date.now() - sinceMs).toISOString();
        const toolName = req.query.toolName as string | undefined;
        const data = store.getToolStats(since, toolName);
        res.json(data);
    });

    return router;
}
