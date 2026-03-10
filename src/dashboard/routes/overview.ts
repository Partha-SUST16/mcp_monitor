import { Router, Request, Response } from 'express';
import { store } from '../../core/Store';

export function createOverviewRouter(): Router {
    const router = Router();

    router.get('/overview', (_req: Request, res: Response) => {
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const data = store.getOverview(since24h);
        res.json(data);
    });

    return router;
}
