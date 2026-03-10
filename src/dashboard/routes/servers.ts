import { Router, Request, Response } from 'express';
import { store } from '../../core/Store';

export function createServersRouter(): Router {
    const router = Router();

    router.get('/servers', (_req: Request, res: Response) => {
        const since5m = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const servers = store.getServerHealth(since5m);
        res.json({ servers });
    });

    return router;
}
