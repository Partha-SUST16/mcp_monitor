import Database from 'better-sqlite3';
import path from 'path';
import { ToolCallRow, AlertEvent, Session, AlertMetric } from '../types';

class Store {
    private db: Database.Database;

    constructor(dbPath?: string) {
        const resolvedPath = dbPath ?? path.join(process.cwd(), 'mcp-monitor.db');
        this.db = new Database(resolvedPath);
        this.db.pragma('journal_mode = WAL');
        this.initialize();
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
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT NOT NULL REFERENCES sessions(id),
        agent_type   TEXT NOT NULL,
        server_name  TEXT NOT NULL,
        tool_name    TEXT NOT NULL,
        method       TEXT NOT NULL,
        arguments    TEXT,
        response     TEXT,
        status       TEXT NOT NULL,
        latency_ms   INTEGER NOT NULL,
        timestamp    TEXT NOT NULL,
        error_msg    TEXT
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
    }) {
        this.db.prepare(`
      INSERT INTO tool_calls (session_id, agent_type, server_name, tool_name, method, arguments, response, status, latency_ms, timestamp, error_msg)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            event.errorMsg ?? null
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
        AVG(latency_ms) as avgLatency
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
        };
    }

    close() {
        this.db.close();
    }
}

export const store = new Store();
