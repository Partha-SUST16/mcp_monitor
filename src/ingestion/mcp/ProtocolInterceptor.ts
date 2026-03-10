import { CollectorEvent } from '../../types';

interface PendingRequest {
    method: string;
    params: unknown;
    startTime: number;
    timestamp: string;
}

export class ProtocolInterceptor {
    private pending = new Map<string | number, PendingRequest>();
    private agentBuffer = '';
    private serverBuffer = '';

    constructor(
        private serverName: string,
        private collector: { handle(e: CollectorEvent): void },
        private sessionManager: { getOrCreate(key: string, isInit?: boolean): string }
    ) { }

    onFromAgent(chunk: Buffer) {
        this.agentBuffer += chunk.toString('utf8');
        const lines = this.agentBuffer.split('\n');
        this.agentBuffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.method && msg.id !== undefined) {
                    const isInit = msg.method === 'initialize';
                    this.sessionManager.getOrCreate(this.serverName, isInit);
                    this.pending.set(msg.id, {
                        method: msg.method,
                        params: msg.params,
                        startTime: Date.now(),
                        timestamp: new Date().toISOString(),
                    });
                }
            } catch { /* non-JSON lines are normal in MCP */ }
        }
    }

    onFromServer(chunk: Buffer) {
        this.serverBuffer += chunk.toString('utf8');
        const lines = this.serverBuffer.split('\n');
        this.serverBuffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined && !msg.method) {
                    const req = this.pending.get(msg.id);
                    if (!req) continue;
                    this.pending.delete(msg.id);

                    const sessionId = this.sessionManager.getOrCreate(this.serverName);
                    const toolName = req.method === 'tools/call'
                        ? (req.params as any)?.name ?? req.method
                        : req.method;

                    this.collector.handle({
                        sessionId,
                        agentType: 'mcp-stdio',
                        serverName: this.serverName,
                        toolName,
                        method: req.method,
                        arguments: (req.params as any)?.arguments ?? req.params,
                        response: msg.result ?? null,
                        status: msg.error ? 'error' : 'success',
                        latencyMs: Date.now() - req.startTime,
                        timestamp: req.timestamp,
                        errorMsg: msg.error?.message,
                    });
                }
            } catch { /* non-JSON */ }
        }
    }
}
