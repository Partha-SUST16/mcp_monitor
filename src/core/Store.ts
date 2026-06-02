import Database from 'better-sqlite3';
import path from 'path';
import { ToolCallRow, AlertEvent, Session, AlertMetric, ErrorClass } from '../types';

class Store {
    private db: Database.Database;

    constructor(dbPath?: string) {
        const resolvedPath = dbPath ?? path.join(process.cwd(), 'mcp-monitor.db');
        this.db = new Database(resolvedPath);
        this.db.pragma('journal_mode = WAL');
        this.initialize();
        this.migrate();
    }

    private initialize() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT PRIMARY KEY,
        server_name  TEXT NOT NULL,
        started_at   TEXT NOT NULL,
        ended_at     TEXT,
        label        TEXT
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id    TEXT NOT NULL REFERENCES sessions(id),
        agent_type    TEXT NOT NULL,
        server_name   TEXT NOT NULL,
        tool_name     TEXT NOT NULL,
        method        TEXT NOT NULL,
        arguments     TEXT,
        response      TEXT,
        status        TEXT NOT NULL,
        latency_ms    INTEGER NOT NULL,
        timestamp     TEXT NOT NULL,
        error_msg     TEXT,
        error_code    INTEGER,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd      REAL NOT NULL DEFAULT 0,
        error_class   TEXT
      );

      CREATE TABLE IF NOT EXISTS alert_events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name    TEXT NOT NULL,
        server_name  TEXT NOT NULL,
        metric       TEXT NOT NULL,
        value        REAL NOT NULL,
        threshold    REAL NOT NULL,
        fired_at     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session    ON tool_calls(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_time  ON tool_calls(tool_name, timestamp);
      CREATE INDEX IF NOT EXISTS idx_time       ON tool_calls(timestamp);
      CREATE INDEX IF NOT EXISTS idx_server     ON tool_calls(server_name, timestamp);
    `);
    }

    // Idempotent column adds for databases created before token/cost/error-class
    // tracking existed. CREATE TABLE IF NOT EXISTS won't alter an existing table,
    // so we diff against PRAGMA table_info and ADD COLUMN for anything missing.
    // No-op on fresh DBs (the columns are already in the CREATE above). The
    // error_class index is created here — after the column is guaranteed present —
    // because on an old DB it would not yet exist when initialize() runs.
    private migrate() {
        const cols = this.db.pragma('table_info(tool_calls)') as { name: string }[];
        const has = (c: string) => cols.some(col => col.name === c);
        if (!has('error_code')) this.db.exec('ALTER TABLE tool_calls ADD COLUMN error_code INTEGER');
        if (!has('input_tokens')) this.db.exec('ALTER TABLE tool_calls ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0');
        if (!has('output_tokens')) this.db.exec('ALTER TABLE tool_calls ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0');
        if (!has('cost_usd')) this.db.exec('ALTER TABLE tool_calls ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0');
        if (!has('error_class')) this.db.exec('ALTER TABLE tool_calls ADD COLUMN error_class TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_error_class ON tool_calls(error_class, timestamp)');
    }

    sessionExists(sessionId: string): boolean {
        const row = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
        return !!row;
    }

    createSession(session: { id: string; serverName: string; startedAt: string; label?: string }) {
        this.db.prepare(
            'INSERT OR IGNORE INTO sessions (id, server_name, started_at, label) VALUES (?, ?, ?, ?)'
        ).run(session.id, session.serverName, session.startedAt, session.label ?? null);
    }

    endSession(sessionId: string) {
        this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?')
            .run(new Date().toISOString(), sessionId);
    }

    insertToolCall(event: {
        sessionId: string;
        agentType: string;
        serverName: string;
        toolName: string;
        method: string;
        arguments: unknown;
        response: unknown;
        status: string;
        latencyMs: number;
        timestamp: string;
        errorMsg?: string;
        errorCode?: number;
        inputTokens?: number;
        outputTokens?: number;
        costUsd?: number;
        errorClass?: ErrorClass | null;
    }) {
        this.db.prepare(`
      INSERT INTO tool_calls (session_id, agent_type, server_name, tool_name, method, arguments, response, status, latency_ms, timestamp, error_msg, error_code, input_tokens, output_tokens, cost_usd, error_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            event.sessionId,
            event.agentType,
            event.serverName,
            event.toolName,
            event.method,
            JSON.stringify(event.arguments),
            JSON.stringify(event.response),
            event.status,
            event.latencyMs,
            event.timestamp,
            event.errorMsg ?? null,
            event.errorCode ?? null,
            event.inputTokens ?? 0,
            event.outputTokens ?? 0,
            event.costUsd ?? 0,
            event.errorClass ?? null
        );
    }

    insertAlert(alert: { toolName: string; serverName: string; metric: AlertMetric; value: number; threshold: number; firedAt: string }) {
        this.db.prepare(
            'INSERT INTO alert_events (tool_name, server_name, metric, value, threshold, fired_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(alert.toolName, alert.serverName, alert.metric, alert.value, alert.threshold, alert.firedAt);
    }

    getOverview(since24h: string) {
        const stats = this.db.prepare(`
      SELECT
        COUNT(*) as totalCalls,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errorCount,
        AVG(latency_ms) as avgLatency,
        SUM(input_tokens + output_tokens) as totalTokens,
        SUM(cost_usd) as totalCost
      FROM tool_calls WHERE timestamp > ?
    `).get(since24h) as any;

        const latencies = this.db.prepare(
            'SELECT latency_ms FROM tool_calls WHERE timestamp > ? ORDER BY latency_ms ASC'
        ).all(since24h) as { latency_ms: number }[];

        const p95 = latencies.length > 0
            ? latencies[Math.floor(latencies.length * 0.95)]?.latency_ms ?? 0
            : 0;

        const serverCount = this.db.prepare(
            'SELECT COUNT(DISTINCT server_name) as cnt FROM tool_calls WHERE timestamp > ?'
        ).get(since24h) as { cnt: number };

        const recentCalls = this.db.prepare(
            'SELECT * FROM tool_calls ORDER BY timestamp DESC LIMIT 50'
        ).all();

        return {
            totalCalls24h: stats?.totalCalls ?? 0,
            errorRate24h: stats?.totalCalls > 0 ? ((stats.errorCount / stats.totalCalls) * 100) : 0,
            avgLatencyMs: Math.round(stats?.avgLatency ?? 0),
            p95LatencyMs: p95,
            activeServers: serverCount?.cnt ?? 0,
            totalTokens24h: stats?.totalTokens ?? 0,
            totalCostUsd24h: stats?.totalCost ?? 0,
            recentCalls: recentCalls.map(r => this.deserializeRow(r)),
        };
    }

    getSessions(limit: number, offset: number, serverName?: string, agentType?: string) {
        let query = `
      SELECT s.*, COUNT(t.id) as call_count
      FROM sessions s
      LEFT JOIN tool_calls t ON t.session_id = s.id
    `;
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (serverName) {
            conditions.push('s.server_name = ?');
            params.push(serverName);
        }
        if (agentType) {
            conditions.push('t.agent_type = ?');
            params.push(agentType);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' GROUP BY s.id ORDER BY s.started_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const sessions = this.db.prepare(query).all(...params);

        let countQuery = 'SELECT COUNT(DISTINCT s.id) as total FROM sessions s';
        if (serverName) {
            countQuery += ' WHERE s.server_name = ?';
        }
        const total = this.db.prepare(countQuery).get(...(serverName ? [serverName] : [])) as { total: number };

        return {
            sessions: sessions.map((s: any) => ({
                id: s.id,
                serverName: s.server_name,
                startedAt: s.started_at,
                endedAt: s.ended_at,
                label: s.label,
                callCount: s.call_count,
            })),
            total: total?.total ?? 0,
        };
    }

    getSessionCalls(sessionId: string) {
        const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
        if (!session) return null;

        const calls = this.db.prepare(
            'SELECT * FROM tool_calls WHERE session_id = ? ORDER BY timestamp ASC'
        ).all(sessionId);

        return {
            session: {
                id: session.id,
                serverName: session.server_name,
                startedAt: session.started_at,
                endedAt: session.ended_at,
                label: session.label,
            },
            calls: calls.map(r => this.deserializeRow(r)),
        };
    }

    getToolStats(since: string, toolName?: string) {
        let query = 'SELECT * FROM tool_calls WHERE timestamp > ?';
        const params: unknown[] = [since];
        if (toolName) {
            query += ' AND tool_name = ?';
            params.push(toolName);
        }
        query += ' ORDER BY timestamp ASC';

        const rows = this.db.prepare(query).all(...params) as any[];

        const byTool = new Map<string, any[]>();
        for (const row of rows) {
            const key = `${row.tool_name}::${row.server_name}`;
            if (!byTool.has(key)) byTool.set(key, []);
            byTool.get(key)!.push(row);
        }

        const tools = [];
        for (const [key, toolRows] of byTool) {
            const [name, serverName] = key.split('::');
            const latencies = toolRows.map(r => r.latency_ms).sort((a: number, b: number) => a - b);
            const errors = toolRows.filter(r => r.status === 'error').length;

            tools.push({
                toolName: name,
                serverName,
                callCount: toolRows.length,
                errorRatePct: toolRows.length > 0 ? (errors / toolRows.length) * 100 : 0,
                p50LatencyMs: this.percentile(latencies, 0.50),
                p95LatencyMs: this.percentile(latencies, 0.95),
                p99LatencyMs: this.percentile(latencies, 0.99),
                timeseriesLatency: this.buildTimeseries(toolRows, (bucket) => {
                    const lats = bucket.map((r: any) => r.latency_ms).sort((a: number, b: number) => a - b);
                    return { p50: this.percentile(lats, 0.50), p95: this.percentile(lats, 0.95) };
                }),
                timeseriesErrors: this.buildTimeseries(toolRows, (bucket) => ({
                    errorRatePct: bucket.length > 0
                        ? (bucket.filter((r: any) => r.status === 'error').length / bucket.length) * 100
                        : 0,
                })),
            });
        }

        return { tools };
    }

    getServerHealth(since5m: string) {
        const rows = this.db.prepare(`
      SELECT
        server_name,
        COUNT(*) as total_calls,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
        MAX(timestamp) as last_seen_at
      FROM tool_calls
      WHERE timestamp > ?
      GROUP BY server_name
    `).all(since5m) as any[];

        return rows.map(row => {
            const errorRate = row.total_calls > 0 ? (row.error_count / row.total_calls) * 100 : 0;

            const latencies = this.db.prepare(
                'SELECT latency_ms FROM tool_calls WHERE server_name = ? AND timestamp > ? ORDER BY latency_ms ASC'
            ).all(row.server_name, since5m) as { latency_ms: number }[];
            const p95 = this.percentile(latencies.map(l => l.latency_ms), 0.95);

            let status: 'healthy' | 'degraded' | 'down';
            if (errorRate > 20) status = 'down';
            else if (errorRate > 5 || p95 > 2000) status = 'degraded';
            else status = 'healthy';

            return {
                name: row.server_name,
                status,
                errorRatePct: Math.round(errorRate * 100) / 100,
                p95LatencyMs: p95,
                totalCalls5m: row.total_calls,
                lastSeenAt: row.last_seen_at,
            };
        });
    }

    getAlerts(limit: number, offset: number) {
        const alerts = this.db.prepare(
            'SELECT * FROM alert_events ORDER BY fired_at DESC LIMIT ? OFFSET ?'
        ).all(limit, offset) as any[];

        const total = this.db.prepare('SELECT COUNT(*) as cnt FROM alert_events').get() as { cnt: number };

        return {
            alerts: alerts.map(a => ({
                id: a.id,
                toolName: a.tool_name,
                serverName: a.server_name,
                metric: a.metric as AlertMetric,
                value: a.value,
                threshold: a.threshold,
                firedAt: a.fired_at,
            })),
            total: total?.cnt ?? 0,
        };
    }

    getP95LatencyByTool(since: string) {
        const rows = this.db.prepare(
            'SELECT tool_name, server_name, latency_ms FROM tool_calls WHERE timestamp > ? ORDER BY tool_name, latency_ms ASC'
        ).all(since) as any[];

        const byTool = new Map<string, { serverName: string; latencies: number[] }>();
        for (const row of rows) {
            if (!byTool.has(row.tool_name)) {
                byTool.set(row.tool_name, { serverName: row.server_name, latencies: [] });
            }
            byTool.get(row.tool_name)!.latencies.push(row.latency_ms);
        }

        return Array.from(byTool.entries()).map(([toolName, data]) => ({
            toolName,
            serverName: data.serverName,
            p95: this.percentile(data.latencies, 0.95),
        }));
    }

    getErrorRateByTool(since: string) {
        const rows = this.db.prepare(`
      SELECT tool_name, server_name,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
      FROM tool_calls WHERE timestamp > ?
      GROUP BY tool_name, server_name
    `).all(since) as any[];

        return rows.map(r => ({
            toolName: r.tool_name,
            serverName: r.server_name,
            rate: r.total > 0 ? (r.errors / r.total) * 100 : 0,
        }));
    }

    // ---- Token usage (Feature: per-agent-node token tracking) -------------------
    // A "node" is a (serverName, toolName) pair — a single addressable tool in the
    // agent's tool graph. We also break down by agentType. Token counts are summed
    // straight from the columns written at ingest time (no recompute on read).
    getTokenUsage(since: string) {
        const byNode = this.db.prepare(`
      SELECT server_name, tool_name,
        COUNT(*) as call_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cost_usd) as cost_usd
      FROM tool_calls WHERE timestamp > ?
      GROUP BY server_name, tool_name
      ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
    `).all(since) as any[];

        const byAgentType = this.db.prepare(`
      SELECT agent_type,
        COUNT(*) as call_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cost_usd) as cost_usd
      FROM tool_calls WHERE timestamp > ?
      GROUP BY agent_type
      ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
    `).all(since) as any[];

        const rows = this.db.prepare(
            'SELECT input_tokens, output_tokens, timestamp FROM tool_calls WHERE timestamp > ? ORDER BY timestamp ASC'
        ).all(since) as any[];

        return {
            byNode: byNode.map(r => ({
                serverName: r.server_name,
                toolName: r.tool_name,
                callCount: r.call_count,
                inputTokens: r.input_tokens ?? 0,
                outputTokens: r.output_tokens ?? 0,
                totalTokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
                costUsd: r.cost_usd ?? 0,
            })),
            byAgentType: byAgentType.map(r => ({
                agentType: r.agent_type,
                callCount: r.call_count,
                inputTokens: r.input_tokens ?? 0,
                outputTokens: r.output_tokens ?? 0,
                totalTokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
                costUsd: r.cost_usd ?? 0,
            })),
            timeseries: this.buildTimeseries(rows, (bucket) => ({
                inputTokens: bucket.reduce((s: number, r: any) => s + (r.input_tokens ?? 0), 0),
                outputTokens: bucket.reduce((s: number, r: any) => s + (r.output_tokens ?? 0), 0),
            })),
        };
    }

    // ---- Cost breakdown (Feature: cost estimator) -------------------------------
    getCostBreakdown(since: string) {
        const byNode = this.db.prepare(`
      SELECT server_name, tool_name,
        COUNT(*) as call_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cost_usd) as cost_usd
      FROM tool_calls WHERE timestamp > ?
      GROUP BY server_name, tool_name
      ORDER BY SUM(cost_usd) DESC
    `).all(since) as any[];

        const bySession = this.db.prepare(`
      SELECT t.session_id, s.server_name, s.started_at, s.label,
        COUNT(*) as call_count,
        SUM(t.cost_usd) as cost_usd,
        SUM(t.input_tokens + t.output_tokens) as total_tokens
      FROM tool_calls t LEFT JOIN sessions s ON s.id = t.session_id
      WHERE t.timestamp > ?
      GROUP BY t.session_id
      ORDER BY SUM(t.cost_usd) DESC
      LIMIT 50
    `).all(since) as any[];

        const rows = this.db.prepare(
            'SELECT cost_usd, timestamp FROM tool_calls WHERE timestamp > ? ORDER BY timestamp ASC'
        ).all(since) as any[];

        const total = this.db.prepare(
            'SELECT SUM(cost_usd) as cost, SUM(input_tokens + output_tokens) as tokens FROM tool_calls WHERE timestamp > ?'
        ).get(since) as any;

        return {
            byNode: byNode.map(r => ({
                serverName: r.server_name,
                toolName: r.tool_name,
                callCount: r.call_count,
                inputTokens: r.input_tokens ?? 0,
                outputTokens: r.output_tokens ?? 0,
                costUsd: r.cost_usd ?? 0,
            })),
            bySession: bySession.map(r => ({
                sessionId: r.session_id,
                serverName: r.server_name,
                startedAt: r.started_at,
                label: r.label,
                callCount: r.call_count,
                totalTokens: r.total_tokens ?? 0,
                costUsd: r.cost_usd ?? 0,
            })),
            timeseries: this.buildTimeseries(rows, (bucket) => ({
                costUsd: bucket.reduce((s: number, r: any) => s + (r.cost_usd ?? 0), 0),
            })),
            totalUsd: total?.cost ?? 0,
            totalTokens: total?.tokens ?? 0,
        };
    }

    // ---- Error classification (Feature: hallucination vs failure vs timeout) ----
    getErrorClassification(since: string) {
        const byClass = this.db.prepare(`
      SELECT COALESCE(error_class, 'unclassified') as error_class, COUNT(*) as count
      FROM tool_calls
      WHERE timestamp > ? AND status != 'success'
      GROUP BY error_class
    `).all(since) as any[];

        const errorRows = this.db.prepare(
            "SELECT error_class, timestamp FROM tool_calls WHERE timestamp > ? AND status != 'success' ORDER BY timestamp ASC"
        ).all(since) as any[];

        const recent = this.db.prepare(`
      SELECT id, session_id, server_name, tool_name, status, error_class, error_code, error_msg, timestamp
      FROM tool_calls
      WHERE timestamp > ? AND status != 'success'
      ORDER BY timestamp DESC LIMIT 50
    `).all(since) as any[];

        const CLASSES: ErrorClass[] = ['hallucination', 'tool_failure', 'timeout'];

        return {
            byClass: byClass.map(r => ({ errorClass: r.error_class as string, count: r.count })),
            timeseries: this.buildTimeseries(errorRows, (bucket) => {
                const out: Record<string, number> = {};
                for (const cls of CLASSES) {
                    out[cls] = bucket.filter((r: any) => r.error_class === cls).length;
                }
                return out;
            }),
            recentErrors: recent.map(r => ({
                id: r.id,
                sessionId: r.session_id,
                serverName: r.server_name,
                toolName: r.tool_name,
                status: r.status,
                errorClass: r.error_class as ErrorClass | null,
                errorCode: r.error_code ?? null,
                errorMsg: r.error_msg,
                timestamp: r.timestamp,
            })),
        };
    }

    private percentile(sorted: number[], pct: number): number {
        if (sorted.length === 0) return 0;
        const idx = Math.floor(sorted.length * pct);
        return sorted[Math.min(idx, sorted.length - 1)];
    }

    private buildTimeseries(rows: any[], aggregator: (bucket: any[]) => Record<string, number>) {
        // 15-minute buckets
        const buckets = new Map<string, any[]>();
        for (const row of rows) {
            const d = new Date(row.timestamp);
            d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
            const key = d.toISOString();
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key)!.push(row);
        }

        return Array.from(buckets.entries()).map(([bucket, items]) => ({
            bucket,
            ...aggregator(items),
        }));
    }

    private deserializeRow(row: any): ToolCallRow {
        return {
            id: row.id,
            sessionId: row.session_id,
            agentType: row.agent_type,
            serverName: row.server_name,
            toolName: row.tool_name,
            method: row.method,
            arguments: row.arguments ? JSON.parse(row.arguments) : null,
            response: row.response ? JSON.parse(row.response) : null,
            status: row.status,
            latencyMs: row.latency_ms,
            timestamp: row.timestamp,
            errorMsg: row.error_msg,
            errorCode: row.error_code ?? null,
            inputTokens: row.input_tokens ?? 0,
            outputTokens: row.output_tokens ?? 0,
            costUsd: row.cost_usd ?? 0,
            errorClass: row.error_class ?? null,
        };
    }

    close() {
        this.db.close();
    }
}

export const store = new Store();
