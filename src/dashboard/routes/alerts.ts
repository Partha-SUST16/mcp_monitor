import { Router, Request, Response } from 'express';
import { store } from '../../core/Store';

export function createAlertsRouter(): Router {
    const router = Router();

    router.get('/alerts', (req: Request, res: Response) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const data = store.getAlerts(limit, offset);
        res.json(data);
    });

    return router;
}
