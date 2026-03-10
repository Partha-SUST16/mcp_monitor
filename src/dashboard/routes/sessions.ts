import { Router, Request, Response } from 'express';
import { store } from '../../core/Store';

export function createSessionsRouter(): Router {
    const router = Router();

    router.get('/sessions', (req: Request, res: Response) => {
        const limit = parseInt(req.query.limit as string) || 20;
        const offset = parseInt(req.query.offset as string) || 0;
        const serverName = req.query.serverName as string | undefined;
        const agentType = req.query.agentType as string | undefined;
        const data = store.getSessions(limit, offset, serverName, agentType);
        res.json(data);
    });

    router.get('/sessions/:id/calls', (req: Request, res: Response) => {
        const id = req.params.id as string;
        const data = store.getSessionCalls(id);
        if (!data) {
            res.status(404).json({ error: 'session not found' });
            return;
        }
        res.json(data);
    });

    return router;
}
