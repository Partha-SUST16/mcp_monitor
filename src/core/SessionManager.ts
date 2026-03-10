import { v4 as randomUUID } from 'uuid';
import { store } from './Store';

class SessionManager {
    private sessions = new Map<string, { sessionId: string; lastCallAt: number }>();
    private static readonly IDLE_MS = 5 * 60 * 1000;

    getOrCreate(connectionKey: string, isInitialize = false): string {
        const existing = this.sessions.get(connectionKey);
        const now = Date.now();

        if (!existing || isInitialize || (now - existing.lastCallAt) > SessionManager.IDLE_MS) {
            const sessionId = process.env.MCP_MONITOR_SESSION_ID ?? randomUUID();
            store.createSession({
                id: sessionId,
                serverName: connectionKey,
                startedAt: new Date().toISOString(),
            });
            this.sessions.set(connectionKey, { sessionId, lastCallAt: now });
            return sessionId;
        }

        existing.lastCallAt = now;
        return existing.sessionId;
    }

    endSession(connectionKey: string) {
        const existing = this.sessions.get(connectionKey);
        if (existing) {
            store.endSession(existing.sessionId);
            this.sessions.delete(connectionKey);
        }
    }
}

export const sessionManager = new SessionManager();
