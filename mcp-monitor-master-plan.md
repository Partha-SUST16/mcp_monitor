# MCP Monitor — Master Build Plan

> Complete specification for an AI coding agent. Read every section before writing any code.
> Follow the build phases in order. Do not skip ahead.

---

## What You Are Building

A transparent observability tool for agentic pipelines. It intercepts every tool call made by an AI agent — whether the agent uses the MCP protocol or calls Python functions directly — and surfaces metrics, session replays, and alerts through a local web dashboard.

**Core constraint:** Zero changes to the agent. Zero changes to the MCP server or tool implementation. Observability is injected at the transport boundary only.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| MCP Proxy | TypeScript | MCP SDK is TS-first |
| Core (store, alerts, API) | TypeScript + Express | Single process with the proxy |
| Dashboard UI | React + Chart.js | Served by Express as static files |
| Real-time push | Server-Sent Events (SSE) | No polling. No WebSockets needed. |
| Database | SQLite via `better-sqlite3` | Synchronous, single writer only |
| Python SDK | Python 3.9+ | Separate pip package, runs in agent process |
| CLI | Commander.js | Entry point for all commands |

---

## Repository Structure

```
mcp-monitor/
├── src/
│   ├── types.ts                       # CollectorEvent interface + all shared types
│   ├── config.ts                      # load + validate mcp-monitor.config.json
│   ├── ingestion/
│   │   ├── mcp/
│   │   │   ├── StdioProxy.ts          # MCP stdio transport interceptor
│   │   │   ├── HttpProxy.ts           # MCP HTTP/SSE transport interceptor
│   │   │   └── ProtocolInterceptor.ts # JSON-RPC parsing, request/response matching
│   │   └── IngestEndpoint.ts          # POST /api/ingest handler (used by Python SDK)
│   ├── core/
│   │   ├── Store.ts                   # ONLY place that reads/writes SQLite
│   │   ├── Collector.ts               # Receives CollectorEvent → Store + EventBus
│   │   ├── SessionManager.ts          # Session lifecycle and ID resolution
│   │   ├── AlertEngine.ts             # Threshold monitoring with cooldown
│   │   └── EventBus.ts                # Node.js EventEmitter singleton
│   ├── dashboard/
│   │   ├── server.ts                  # Express app, SSE endpoint, static serving
│   │   ├── routes/
│   │   │   ├── overview.ts
│   │   │   ├── sessions.ts
│   │   │   ├── tools.ts
│   │   │   ├── servers.ts
│   │   │   └── alerts.ts
│   │   └── ui/                        # React app (Vite build output goes here)
│   │       ├── src/
│   │       │   ├── App.tsx
│   │       │   ├── pages/
│   │       │   │   ├── LiveFeed.tsx
│   │       │   │   ├── SessionReplay.tsx
│   │       │   │   ├── ToolAnalytics.tsx
│   │       │   │   ├── ServerHealth.tsx
│   │       │   │   └── Alerts.tsx
│   │       │   └── components/
│   │       └── index.html
│   └── cli.ts                         # Commander.js entry point
├── sdk/
│   └── python/
│       ├── pyproject.toml
│       └── agent_monitor/
│           ├── __init__.py            # exports: patch_qwen_agent, monitor, new_session
│           ├── collector.py           # fire-and-forget POST to /api/ingest
│           └── decorators.py          # patch_qwen_agent(), @monitor
├── mcp-monitor.config.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Architecture

### High-Level Diagram

```
╔══════════════════════════════════════════════════════════════════╗
║                        AGENT LAYER                               ║
║                                                                  ║
║     Claude Code        Cursor          Custom Python Agent       ║
║     Claude Desktop     Windsurf        LangChain / QwenAgent     ║
╚══════════╤═════════════════╤═══════════════════╤════════════════╝
           │ MCP stdio        │ MCP HTTP           │ Python fn calls
           ▼                  ▼                    ▼
╔══════════════════╗  ╔═══════════════╗  ╔════════════════════════╗
║   STDIO PROXY    ║  ║  HTTP PROXY   ║  ║     PYTHON SDK         ║
║  (TypeScript)    ║  ║ (TypeScript)  ║  ║     (pip package)      ║
║                  ║  ║               ║  ║                        ║
║ spawns real MCP  ║  ║ reverse proxy ║  ║ wraps tool execution   ║
║ server, pipes    ║  ║ on local port ║  ║ measures latency       ║
║ stdin/stdout,    ║  ║ intercepts at ║  ║ fire-and-forget POST   ║
║ parses JSON-RPC  ║  ║ middleware    ║  ║ to /api/ingest         ║
╚════════╤═════════╝  ╚═══════╤═══════╝  ╚══════════╤═════════════╝
         │                    │                       │
         │   ALL three paths POST to /api/ingest      │
         └────────────────────┴───────────────────────┘
                                      │
                                      ▼
╔══════════════════════════════════════════════════════════════════╗
║                    CORE  (TypeScript)                            ║
║                                                                  ║
║  POST /api/ingest                                                ║
║       │                                                          ║
║       ▼                                                          ║
║  ┌─────────────┐    ┌──────────────┐    ┌────────────────────┐  ║
║  │  Collector  │───►│ SQLite Store │◄───│   Alert Engine     │  ║
║  │             │    │  (1 writer)  │    │  (cooldown logic)  │  ║
║  │ validates   │    │              │    │                    │  ║
║  │ normalizes  │    │ sessions     │    │ polls every 30s    │  ║
║  │ persists    │    │ tool_calls   │    │ p95 latency check  │  ║
║  │ emits event │    │ alert_events │    │ error rate check   │  ║
║  └─────────────┘    └──────┬───────┘    └────────────────────┘  ║
║                            │                                     ║
║              EventBus.emit('tool_call', event)                   ║
║                            │                                     ║
║                            ▼                                     ║
║                   ┌─────────────────┐                           ║
║                   │   Express API   │                           ║
║                   │                 │                           ║
║                   │ GET  /api/overview                          ║
║                   │ GET  /api/sessions                          ║
║                   │ GET  /api/sessions/:id/calls                ║
║                   │ GET  /api/tools/stats                       ║
║                   │ GET  /api/servers                           ║
║                   │ GET  /api/alerts                            ║
║                   │ GET  /api/stream   (SSE)                    ║
║                   │ POST /api/ingest   (all ingestion paths)    ║
║                   └────────┬────────┘                           ║
╚════════════════════════════╪═════════════════════════════════════╝
                             │ SSE push on each tool_call event
                             ▼
╔══════════════════════════════════════════════════════════════════╗
║                    DASHBOARD  (React)                            ║
║                                                                  ║
║   Live Feed   Session Replay   Tool Analytics   Server Health   ║
║                        Alerts                                    ║
╚══════════════════════════════════════════════════════════════════╝
```

### Critical Architecture Rule — Single Writer

**SQLite must have exactly one writer: the Collector inside the Core process.**

Both the StdioProxy and HttpProxy run in the same process as the Core, so they do NOT write to SQLite directly. They POST to `/api/ingest` like the Python SDK does. This prevents `SQLITE_BUSY` errors from concurrent writes.

```
StdioProxy ──► POST /api/ingest ──► Collector ──► SQLite
HttpProxy  ──► POST /api/ingest ──► Collector ──► SQLite
Python SDK ──► POST /api/ingest ──► Collector ──► SQLite
                                         │
                                   EventBus.emit
                                         │
                                    SSE clients
```

Since StdioProxy and HttpProxy are in the same process, their POST is an in-process function call (not an actual HTTP request) — call `collector.handle(event)` directly. Only the Python SDK makes a real HTTP POST.

---

## Data Flow

### MCP stdio path
```
Agent process
 │  reads config, sees mcp-monitor as the server command
 │  spawns: mcp-monitor proxy --name filesystem --cmd "npx ..."
 ▼
StdioProxy process (IS the mcp-monitor core process)
 ├── spawns real MCP server as child process
 ├── pipes agent stdin → child stdin
 ├── pipes child stdout → agent stdout
 └── ProtocolInterceptor reads every line in both directions
       │
       ├── line from agent:    parse JSON-RPC
       │                       if has { id, method } → pending.set(id, { method, params, startTime, timestamp })
       │
       └── line from server:   parse JSON-RPC
                               if has { id } and no method → it's a response
                               pending.get(id) → compute latencyMs
                               build CollectorEvent
                               collector.handle(event)
                                     │
                               store.insertToolCall()
                               eventBus.emit('tool_call', event)
                                     │
                               SSE: res.write(`data: ${JSON.stringify(event)}\n\n`)
```

### Python SDK path
```
Python agent process
 │
 ├── import agent_monitor; patch_qwen_agent()  ← called once at startup
 │   BaseTool.call is now wrapped
 │
 └── agent runs, tool gets called
       ├── wrapper records timestamp = datetime.utcnow().isoformat()
       ├── calls real function
       ├── measures latency
       └── spawns daemon thread:
             POST http://localhost:4242/api/ingest
             body: CollectorEvent JSON
             timeout: 2s
             on failure: silently swallow (never crash agent)

Core /api/ingest handler
 ├── validates body shape
 ├── calls collector.handle(event)
 ├── store.insertToolCall()
 ├── eventBus.emit('tool_call', event)
 └── SSE push to all open dashboard tabs
```

### SSE real-time push
```
collector.handle(event)
      │
      ├── store.insertToolCall(event)     ← synchronous SQLite write
      └── eventBus.emit('tool_call', e)   ← synchronous in-process emit
                  │
                  ▼
         for each client in sseClients:
           client.res.write(`data: ${JSON.stringify(e)}\n\n`)
```

---

## All Types — Define These First in `src/types.ts`

```typescript
// src/types.ts

export type AgentType = 'mcp-stdio' | 'mcp-http' | 'python-sdk';
export type CallStatus = 'success' | 'error' | 'timeout';
export type AlertMetric = 'latency_p95' | 'error_rate';

// The single shared contract. Every ingestion path produces this.
export interface CollectorEvent {
  sessionId:   string;        // UUID — set by agent or auto-generated per connection
  agentType:   AgentType;
  serverName:  string;        // logical name from config, e.g. 'filesystem', 'github'
  toolName:    string;        // e.g. 'read_file', 'search_code'
  method:      string;        // MCP: 'tools/call' | Python: function name
  arguments:   unknown;       // sanitized (secrets redacted), stored as-is
  response:    ResponsePayload | null;
  status:      CallStatus;
  latencyMs:   number;
  timestamp:   string;        // ISO 8601, set at point of interception — NOT server receipt time
  errorMsg?:   string;
}

// Response is stored as structured payload, not raw truncated string
export interface ResponsePayload {
  data:      unknown;   // full response if under 10KB, partial if over
  truncated: boolean;   // true if data was truncated
  sizeBytes: number;    // original size before truncation
}

export interface Session {
  id:          string;
  serverName:  string;
  startedAt:   string;
  endedAt?:    string;
  label?:      string;
  callCount?:  number;  // derived, not stored
}

export interface ToolCallRow {
  id:         number;
  sessionId:  string;
  agentType:  AgentType;
  serverName: string;
  toolName:   string;
  method:     string;
  arguments:  unknown;
  response:   ResponsePayload | null;
  status:     CallStatus;
  latencyMs:  number;
  timestamp:  string;
  errorMsg:   string | null;
}

export interface ServerHealth {
  name:            string;
  status:          'healthy' | 'degraded' | 'down';
  errorRatePct:    number;   // last 5 min
  p95LatencyMs:    number;   // last 5 min
  totalCalls5m:    number;
  lastSeenAt:      string | null;
}

export interface AlertEvent {
  id:         number;
  toolName:   string;
  metric:     AlertMetric;
  value:      number;
  threshold:  number;
  firedAt:    string;
}

export interface Config {
  servers: ServerConfig[];
  dashboard: { port: number };
  alerts: AlertConfig;
}

export interface ServerConfig {
  name:       string;
  transport:  'stdio' | 'http';
  command?:   string;   // stdio only
  env?:       Record<string, string>;  // stdio only
  targetUrl?: string;   // http only
  listenPort?: number;  // http only
}

export interface AlertConfig {
  latencyP95Ms:          number;   // default 2000
  errorRatePercent:      number;   // default 10
  checkIntervalSeconds:  number;   // default 30
  cooldownMinutes:       number;   // default 5 — no re-fire within this window
}
```

---

## Database Schema

```sql
-- Run this exactly once on startup via Store.ts initialize()

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  server_name  TEXT NOT NULL,
  started_at   TEXT NOT NULL,   -- ISO 8601
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
  arguments    TEXT,            -- JSON string
  response     TEXT,            -- JSON string: { data, truncated, sizeBytes }
  status       TEXT NOT NULL,   -- 'success' | 'error' | 'timeout'
  latency_ms   INTEGER NOT NULL,
  timestamp    TEXT NOT NULL,   -- ISO 8601, from CollectorEvent (not server receipt time)
  error_msg    TEXT
);

CREATE TABLE IF NOT EXISTS alert_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name    TEXT NOT NULL,
  server_name  TEXT NOT NULL,
  metric       TEXT NOT NULL,   -- 'latency_p95' | 'error_rate'
  value        REAL NOT NULL,
  threshold    REAL NOT NULL,
  fired_at     TEXT NOT NULL    -- ISO 8601
);

CREATE INDEX IF NOT EXISTS idx_session    ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_time  ON tool_calls(tool_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_time       ON tool_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_server     ON tool_calls(server_name, timestamp);
```

**Important notes for Store.ts implementation:**
- Use `better-sqlite3` (synchronous). Never use `sqlite3` (async, causes race conditions).
- Enable WAL mode on init: `db.pragma('journal_mode = WAL')` — faster concurrent reads.
- All JSON fields (arguments, response) are stored as serialized strings. Deserialize on read.
- `Store` class is a singleton. Import and use one instance everywhere.

---

## Session Management Rules

Implement these rules exactly in `SessionManager.ts`:

1. **MCP connection:** On `initialize` message, create a new session. Store session ID in memory keyed by the proxy instance (one proxy = one MCP server connection = potentially many sessions over time).

2. **Idle timeout:** If more than 5 minutes pass between tool calls on a connection, create a new session for the next call. This handles Claude Desktop's persistent connections.

3. **Explicit session ID from agent:** Check for env var `MCP_MONITOR_SESSION_ID` at proxy startup. If set, use it as the initial session ID. This lets agent wrappers inject a session ID per run for clean grouping.

4. **Python SDK:** Each Python process generates a UUID at import time (`_session_id = str(uuid.uuid4())`). This UUID is sent with every event from that process. The Core creates a session record on first receipt of a new session ID.

5. **Session end:** Mark `ended_at` when the proxy's child process exits or the HTTP connection closes.

```typescript
// SessionManager.ts key logic
class SessionManager {
  private sessions = new Map<string, { sessionId: string; lastCallAt: number }>();

  getOrCreate(connectionKey: string, isInitialize = false): string {
    const existing = this.sessions.get(connectionKey);
    const now = Date.now();
    const IDLE_MS = 5 * 60 * 1000;

    if (!existing || isInitialize || (now - existing.lastCallAt) > IDLE_MS) {
      const sessionId = process.env.MCP_MONITOR_SESSION_ID ?? randomUUID();
      store.createSession({ id: sessionId, serverName: connectionKey, startedAt: new Date().toISOString() });
      this.sessions.set(connectionKey, { sessionId, lastCallAt: now });
      return sessionId;
    }

    existing.lastCallAt = now;
    return existing.sessionId;
  }
}
```

---

## Response Truncation Rules

Implement in `Collector.ts` before storing:

```typescript
function truncateResponse(raw: unknown): ResponsePayload {
  const serialized = JSON.stringify(raw);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  const LIMIT = 10_000; // 10KB

  if (sizeBytes <= LIMIT) {
    return { data: raw, truncated: false, sizeBytes };
  }

  // Truncate at object level: if array, keep first N items; if object, keep top-level keys only
  if (Array.isArray(raw)) {
    const kept = [];
    let size = 2; // for "[]"
    for (const item of raw) {
      const itemSize = Buffer.byteLength(JSON.stringify(item), 'utf8');
      if (size + itemSize > LIMIT) break;
      kept.push(item);
      size += itemSize + 1;
    }
    return { data: kept, truncated: true, sizeBytes };
  }

  if (typeof raw === 'object' && raw !== null) {
    // Keep top-level keys, truncate their values to strings if needed
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const vs = typeof v === 'string' ? v.slice(0, 500) : v;
      kept[k] = vs;
    }
    return { data: kept, truncated: true, sizeBytes };
  }

  // Primitive — truncate as string
  return { data: String(raw).slice(0, LIMIT), truncated: true, sizeBytes };
}
```

---

## Secret Sanitization Rules

Implement in `Collector.ts` before storing arguments. Apply recursively to nested objects.

```typescript
const SECRET_KEYS = ['token', 'key', 'secret', 'password', 'auth', 'api_key',
                     'apikey', 'credential', 'bearer', 'authorization'];

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return value; // prevent infinite recursion
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as object)) {
    const isSecret = SECRET_KEYS.some(s => k.toLowerCase().includes(s));
    clean[k] = isSecret ? '[REDACTED]' : sanitize(v, depth + 1);
  }
  return clean;
}
```

---

## Alert Engine Rules

Implement in `AlertEngine.ts`. The cooldown prevents duplicate alert spam.

```typescript
class AlertEngine {
  // key: `${toolName}:${metric}`, value: last fired timestamp ms
  private cooldowns = new Map<string, number>();

  start() {
    setInterval(() => this.run(), this.config.checkIntervalSeconds * 1000);
  }

  private run() {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Check p95 latency per tool
    const latencies = store.getP95LatencyByTool(since);
    for (const { toolName, serverName, p95 } of latencies) {
      if (p95 > this.config.latencyP95Ms) {
        this.maybeFireAlert(toolName, serverName, 'latency_p95', p95, this.config.latencyP95Ms);
      }
    }

    // Check error rate per tool
    const errorRates = store.getErrorRateByTool(since);
    for (const { toolName, serverName, rate } of errorRates) {
      if (rate > this.config.errorRatePercent) {
        this.maybeFireAlert(toolName, serverName, 'error_rate', rate, this.config.errorRatePercent);
      }
    }
  }

  private maybeFireAlert(toolName: string, serverName: string,
                          metric: AlertMetric, value: number, threshold: number) {
    const key = `${toolName}:${metric}`;
    const lastFired = this.cooldowns.get(key) ?? 0;
    const cooldownMs = this.config.cooldownMinutes * 60 * 1000;

    if (Date.now() - lastFired < cooldownMs) return; // still in cooldown

    this.cooldowns.set(key, Date.now());
    store.insertAlert({ toolName, serverName, metric, value, threshold,
                        firedAt: new Date().toISOString() });
    console.error(`[alert] ${serverName}/${toolName} ${metric}=${value} > ${threshold}`);
    eventBus.emit('alert', { toolName, serverName, metric, value, threshold });
  }
}
```

---

## REST API — All Endpoints

### `GET /api/overview`
Returns aggregated stats for the dashboard home.

Response:
```json
{
  "totalCalls24h": 1482,
  "errorRate24h": 2.3,
  "avgLatencyMs": 340,
  "p95LatencyMs": 890,
  "activeServers": 3,
  "recentCalls": [ /* last 50 CollectorEvents */ ]
}
```

SQL for recentCalls: `SELECT * FROM tool_calls ORDER BY timestamp DESC LIMIT 50`

---

### `GET /api/sessions?limit=20&offset=0&serverName=&agentType=`
Returns paginated session list with call count derived from tool_calls.

Response:
```json
{
  "sessions": [
    {
      "id": "uuid",
      "serverName": "filesystem",
      "startedAt": "2026-03-09T10:00:00Z",
      "endedAt": "2026-03-09T10:05:00Z",
      "callCount": 23
    }
  ],
  "total": 142
}
```

SQL: 
```sql
SELECT s.*, COUNT(t.id) as call_count
FROM sessions s
LEFT JOIN tool_calls t ON t.session_id = s.id
GROUP BY s.id
ORDER BY s.started_at DESC
LIMIT ? OFFSET ?
```

---

### `GET /api/sessions/:id/calls`
Returns all tool calls for one session in chronological order. Used for session replay.

Response:
```json
{
  "session": { /* Session object */ },
  "calls": [ /* ToolCallRow[] ordered by timestamp ASC */ ]
}
```

SQL: `SELECT * FROM tool_calls WHERE session_id = ? ORDER BY timestamp ASC`

---

### `GET /api/tools/stats?since=24h&toolName=`
Returns per-tool latency percentiles and error rates.

`since` values: `1h`, `6h`, `24h`, `7d`. Parse to ISO timestamp in handler.

Response:
```json
{
  "tools": [
    {
      "toolName": "read_file",
      "serverName": "filesystem",
      "callCount": 340,
      "errorRatePct": 1.2,
      "p50LatencyMs": 120,
      "p95LatencyMs": 450,
      "p99LatencyMs": 890,
      "timeseriesLatency": [
        { "bucket": "2026-03-09T10:00:00Z", "p50": 110, "p95": 430 }
      ],
      "timeseriesErrors": [
        { "bucket": "2026-03-09T10:00:00Z", "errorRatePct": 0.5 }
      ]
    }
  ]
}
```

For percentiles, use SQLite's `ntile` window function or compute in TypeScript by sorting the latency array after fetching raw rows.

---

### `GET /api/servers`
Derived entirely from `tool_calls` in the last 5 minutes. No separate servers table.

```sql
SELECT
  server_name,
  COUNT(*) as total_calls,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
  MAX(timestamp) as last_seen_at,
  AVG(latency_ms) as avg_latency_ms
FROM tool_calls
WHERE timestamp > ?   -- 5 min ago
GROUP BY server_name
```

Compute `status` in TypeScript:
- `healthy`: error rate < 5% AND p95 < threshold
- `degraded`: error rate 5–20% OR p95 > threshold
- `down`: no calls in last 5 min OR error rate > 20%

Response:
```json
{
  "servers": [
    {
      "name": "filesystem",
      "status": "healthy",
      "errorRatePct": 0.8,
      "p95LatencyMs": 340,
      "totalCalls5m": 47,
      "lastSeenAt": "2026-03-09T10:04:55Z"
    }
  ]
}
```

---

### `GET /api/alerts?limit=50&offset=0`
Returns fired alert history from `alert_events` table.

Response:
```json
{
  "alerts": [
    {
      "id": 1,
      "toolName": "query_database",
      "serverName": "db-tools",
      "metric": "latency_p95",
      "value": 3400,
      "threshold": 2000,
      "firedAt": "2026-03-09T09:55:00Z"
    }
  ],
  "total": 12
}
```

---

### `GET /api/stream`
SSE endpoint. Keeps connection open and pushes events as they arrive.

```typescript
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send a heartbeat every 30s to prevent proxy timeouts
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  const onCall = (event: CollectorEvent) => {
    res.write(`event: tool_call\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const onAlert = (alert: AlertEvent) => {
    res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
  };

  eventBus.on('tool_call', onCall);
  eventBus.on('alert', onAlert);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off('tool_call', onCall);
    eventBus.off('alert', onAlert);
  });
});
```

---

### `POST /api/ingest`
Accepts CollectorEvent from Python SDK (and internal proxy calls).

```typescript
app.post('/api/ingest', (req, res) => {
  const event = req.body as CollectorEvent;

  // Validate required fields
  if (!event.sessionId || !event.toolName || !event.timestamp) {
    return res.status(400).json({ error: 'missing required fields' });
  }

  // Ensure session exists (Python SDK creates its own session IDs)
  if (!store.sessionExists(event.sessionId)) {
    store.createSession({
      id: event.sessionId,
      serverName: event.serverName,
      startedAt: event.timestamp
    });
  }

  collector.handle(event);
  res.json({ ok: true });
});
```

---

## StdioProxy Implementation

```typescript
// src/ingestion/mcp/StdioProxy.ts
import { spawn, ChildProcess } from 'child_process';
import { collector } from '../../core/Collector';
import { sessionManager } from '../../core/SessionManager';
import { ProtocolInterceptor } from './ProtocolInterceptor';

export class StdioProxy {
  private child: ChildProcess | null = null;
  private interceptor: ProtocolInterceptor;

  constructor(private config: { name: string; command: string; env?: Record<string, string> }) {
    this.interceptor = new ProtocolInterceptor(config.name, collector, sessionManager);
  }

  start() {
    const [cmd, ...args] = this.config.command.split(' ');
    this.child = spawn(cmd, args, {
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'inherit']  // inherit stderr so server logs go through
    });

    // Agent stdin → interceptor → child stdin
    process.stdin.on('data', (chunk: Buffer) => {
      this.interceptor.onFromAgent(chunk);
      this.child!.stdin!.write(chunk);
    });

    // Child stdout → interceptor → agent stdout
    this.child.stdout!.on('data', (chunk: Buffer) => {
      this.interceptor.onFromServer(chunk);
      process.stdout.write(chunk);
    });

    this.child.on('exit', (code) => {
      sessionManager.endSession(this.config.name);
      process.exit(code ?? 0);
    });

    process.on('exit', () => this.child?.kill());
  }
}
```

---

## ProtocolInterceptor Implementation

```typescript
// src/ingestion/mcp/ProtocolInterceptor.ts
import { CollectorEvent } from '../../types';

interface PendingRequest {
  method:     string;
  params:     unknown;
  startTime:  number;
  timestamp:  string;   // ISO 8601 at time of request
}

export class ProtocolInterceptor {
  private pending = new Map<string | number, PendingRequest>();
  private agentBuffer = '';
  private serverBuffer = '';

  constructor(
    private serverName: string,
    private collector: { handle(e: CollectorEvent): void },
    private sessionManager: { getOrCreate(key: string, isInit?: boolean): string }
  ) {}

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
            method:    msg.method,
            params:    msg.params,
            startTime: Date.now(),
            timestamp: new Date().toISOString()
          });
        }
      } catch { /* not JSON — MCP also sends non-JSON lines, ignore */ }
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
        // Responses have an id but no method
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
            agentType:  'mcp-stdio',
            serverName: this.serverName,
            toolName,
            method:     req.method,
            arguments:  (req.params as any)?.arguments ?? req.params,
            response:   msg.result ?? null,
            status:     msg.error ? 'error' : 'success',
            latencyMs:  Date.now() - req.startTime,
            timestamp:  req.timestamp,
            errorMsg:   msg.error?.message
          });
        }
      } catch { /* not JSON */ }
    }
  }
}
```

---

## Python SDK Implementation

### `sdk/python/agent_monitor/collector.py`

```python
import threading
import uuid
import os
import json
from datetime import datetime, timezone
from typing import Any, Optional

MONITOR_URL = os.getenv("AGENT_MONITOR_URL", "http://localhost:4242")

# One session per Python process
_session_id = os.getenv("AGENT_MONITOR_SESSION_ID", str(uuid.uuid4()))

SECRET_KEYS = {'token', 'key', 'secret', 'password', 'auth', 'api_key',
               'apikey', 'credential', 'bearer', 'authorization'}

def _sanitize(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return value
    if isinstance(value, dict):
        return {
            k: '[REDACTED]' if any(s in k.lower() for s in SECRET_KEYS)
               else _sanitize(v, depth + 1)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_sanitize(v, depth + 1) for v in value]
    return value

def _truncate_response(raw: Any) -> dict:
    serialized = json.dumps(raw)
    size_bytes = len(serialized.encode('utf-8'))
    limit = 10_000

    if size_bytes <= limit:
        return {"data": raw, "truncated": False, "sizeBytes": size_bytes}

    if isinstance(raw, list):
        kept, size = [], 2
        for item in raw:
            item_size = len(json.dumps(item).encode('utf-8'))
            if size + item_size > limit:
                break
            kept.append(item)
            size += item_size + 1
        return {"data": kept, "truncated": True, "sizeBytes": size_bytes}

    if isinstance(raw, dict):
        kept = {k: str(v)[:500] if isinstance(v, str) else v for k, v in raw.items()}
        return {"data": kept, "truncated": True, "sizeBytes": size_bytes}

    return {"data": str(raw)[:limit], "truncated": True, "sizeBytes": size_bytes}

def record(
    tool_name: str,
    server_name: str,
    arguments: Any,
    response: Any,
    status: str,
    latency_ms: float,
    timestamp: str,
    error: Optional[str] = None
):
    payload = {
        "sessionId":   _session_id,
        "agentType":   "python-sdk",
        "serverName":  server_name,
        "toolName":    tool_name,
        "method":      tool_name,
        "arguments":   _sanitize(arguments),
        "response":    _truncate_response(response) if response is not None else None,
        "status":      status,
        "latencyMs":   round(latency_ms),
        "timestamp":   timestamp,
        "errorMsg":    error,
    }
    threading.Thread(target=_post, args=(payload,), daemon=True).start()

def _post(payload: dict):
    try:
        import urllib.request
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            f"{MONITOR_URL}/api/ingest",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # monitoring must never crash the agent
```

Note: Uses only stdlib (`urllib`) — no `requests` dependency. This keeps the SDK lightweight.

### `sdk/python/agent_monitor/decorators.py`

```python
import time
from datetime import datetime, timezone
from .collector import record

def patch_qwen_agent(server_name: str = "python-agent"):
    """
    Monkey-patches QwenAgent's BaseTool.call to record all tool invocations.
    Call once at startup before creating any agent instances.
    """
    try:
        from qwen_agent.tools.base import BaseTool
    except ImportError:
        raise ImportError("qwen_agent is not installed. pip install qwen-agent")

    _original = BaseTool.call

    def _monitored(self, params, **kwargs):
        ts = datetime.now(timezone.utc).isoformat()
        start = time.perf_counter()
        try:
            result = _original(self, params, **kwargs)
            latency = (time.perf_counter() - start) * 1000
            record(
                tool_name=getattr(self, 'name', self.__class__.__name__),
                server_name=server_name,
                arguments=params,
                response=result,
                status='success',
                latency_ms=latency,
                timestamp=ts
            )
            return result
        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            record(
                tool_name=getattr(self, 'name', self.__class__.__name__),
                server_name=server_name,
                arguments=params,
                response=None,
                status='error',
                latency_ms=latency,
                timestamp=ts,
                error=str(e)
            )
            raise

    BaseTool.call = _monitored


def monitor(server_name: str = "python-agent"):
    """
    Generic decorator for any callable tool.
    Usage: @monitor() or @monitor(server_name="my-tools")
    """
    def decorator(fn):
        import functools
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            ts = datetime.now(timezone.utc).isoformat()
            start = time.perf_counter()
            try:
                result = fn(*args, **kwargs)
                record(fn.__name__, server_name, kwargs, result,
                       'success', (time.perf_counter() - start) * 1000, ts)
                return result
            except Exception as e:
                record(fn.__name__, server_name, kwargs, None,
                       'error', (time.perf_counter() - start) * 1000, ts, str(e))
                raise
        return wrapper
    return decorator
```

### `sdk/python/agent_monitor/__init__.py`

```python
from .decorators import patch_qwen_agent, monitor
from .collector import _session_id as session_id

__all__ = ['patch_qwen_agent', 'monitor', 'session_id']
```

---

## CLI Commands

```typescript
// src/cli.ts — implement with commander

program
  .command('start')
  .description('Start monitoring all servers defined in mcp-monitor.config.json')
  .option('-c, --config <path>', 'config file path', './mcp-monitor.config.json')
  .action(startAll);

// This is what goes in claude_desktop_config.json
program
  .command('proxy')
  .description('Start a proxy for a single MCP server')
  .requiredOption('--name <name>', 'logical name for this server')
  .requiredOption('--cmd <command>', 'command to spawn the real MCP server')
  .option('--session-id <id>', 'explicit session ID for this run')
  .action(startProxy);

program
  .command('sessions list')
  .option('--limit <n>', 'number of sessions', '20')
  .action(listSessions);

program
  .command('sessions replay <id>')
  .description('Print session tool calls to terminal')
  .action(replaySession);

program
  .command('stats')
  .option('--sort <field>', 'latency_p95 | error_rate | call_count', 'latency_p95')
  .option('--since <duration>', '1h | 6h | 24h | 7d', '24h')
  .action(showStats);

program
  .command('export')
  .option('--format <fmt>', 'json | csv', 'json')
  .option('--since <duration>', '1h | 6h | 24h | 7d', '24h')
  .option('--output <path>', 'output file path, defaults to stdout')
  .action(exportData);
```

---

## Dashboard Pages — Implementation Spec

### Live Feed (`LiveFeed.tsx`)
- Connect to `/api/stream` using `EventSource`
- On `tool_call` event: prepend to call list, keep max 200 in state
- On `alert` event: show toast notification
- Table columns: timestamp (relative), agent type badge, server name, tool name, status badge (green/red), latency (ms)
- Status badge colors: green = success, red = error, yellow = timeout
- Auto-scroll to top on new events (with a "pause scroll" toggle)

### Session Replay (`SessionReplay.tsx`)
- Left panel: session list from `GET /api/sessions`
- Right panel: call timeline for selected session from `GET /api/sessions/:id/calls`
- Timeline: ordered list of calls, each row shows tool name, status, latency bar (proportional width)
- Click any call: expand below the row to show arguments JSON and response JSON side by side
- If `response.truncated === true`: show a yellow warning banner "Response was truncated (original: Xkb)"
- Gantt chart at top: horizontal bars per call showing relative duration

### Tool Analytics (`ToolAnalytics.tsx`)
- Tool selector dropdown populated from `GET /api/tools/stats`
- Time range selector: 1h / 6h / 24h / 7d
- Chart 1: Line chart (Chart.js) — p50, p95, p99 latency over time
- Chart 2: Bar chart — call volume per time bucket
- Chart 3: Line chart — error rate % over time
- Summary cards: total calls, avg latency, p95 latency, error rate

### Server Health (`ServerHealth.tsx`)
- Card per server from `GET /api/servers`
- Status dot: green (healthy), yellow (degraded), red (down)
- Shows: error rate %, p95 latency, calls in last 5m, last seen timestamp
- Auto-refreshes every 30s via `GET /api/servers` (NOT SSE — this is low-frequency enough for polling)

### Alerts (`Alerts.tsx`)
- Table of alert history from `GET /api/alerts`
- Columns: time (relative), server/tool, metric, value vs threshold
- Red highlight for high-value alerts (value > 2x threshold)
- Current config thresholds shown at top (read from `GET /api/overview` which includes config)

---

## Config File

```json
{
  "servers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx @modelcontextprotocol/server-filesystem /tmp"
    },
    {
      "name": "github",
      "transport": "stdio",
      "command": "npx @modelcontextprotocol/server-github",
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
    },
    {
      "name": "remote-tools",
      "transport": "http",
      "targetUrl": "https://my-mcp-server.com",
      "listenPort": 4243
    }
  ],
  "dashboard": {
    "port": 4242
  },
  "alerts": {
    "latencyP95Ms": 2000,
    "errorRatePercent": 10,
    "checkIntervalSeconds": 30,
    "cooldownMinutes": 5
  }
}
```

Env var substitution: in `config.ts`, replace `$VAR_NAME` values in `env` fields with `process.env.VAR_NAME`.

---

## How Agents Connect

### Claude Desktop / Claude Code
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-monitor",
      "args": ["proxy", "--name", "filesystem",
               "--cmd", "npx @modelcontextprotocol/server-filesystem /tmp"]
    }
  }
}
```

### Any Python Agent (QwenAgent, LangChain, etc.)
```python
from agent_monitor import patch_qwen_agent
patch_qwen_agent(server_name="my-agent")  # call before creating agent

# rest of agent code unchanged
```

### Generic Python Tool (no framework)
```python
from agent_monitor import monitor

@monitor(server_name="my-tools")
def query_database(sql: str) -> dict:
    ...
```

---

## Setup Commands

```bash
mkdir mcp-monitor && cd mcp-monitor
npm init -y
npm install @modelcontextprotocol/sdk better-sqlite3 express commander
npm install -D typescript @types/node @types/express ts-node vitest
npx tsc --init --target ES2022 --module NodeNext --strict true

# For dashboard UI
npm install -D vite @vitejs/plugin-react
npm install react react-dom chart.js react-chartjs-2

# Test MCP server to develop against
npm install -g @modelcontextprotocol/server-filesystem
```

---

## Build Order

Build strictly in this order. Each phase has a clear done condition.

| Phase | What | Done When |
|---|---|---|
| 1 | `src/types.ts` — all interfaces | TypeScript compiles with no errors |
| 2 | `src/core/Store.ts` — SQLite schema + CRUD | Vitest: insert + query tool_call passes |
| 3 | `src/core/EventBus.ts` — EventEmitter singleton | Vitest: emit + receive event passes |
| 4 | `src/core/Collector.ts` — handle() method | Vitest: handle() writes to Store + emits event |
| 5 | `src/core/SessionManager.ts` | Vitest: idle timeout creates new session |
| 6 | `src/ingestion/mcp/ProtocolInterceptor.ts` | Vitest: parse request+response pair, emit CollectorEvent |
| 7 | `src/ingestion/mcp/StdioProxy.ts` | Manual: Claude Desktop routes through proxy, calls appear in DB |
| 8 | `src/dashboard/server.ts` — Express + SSE + all routes | Manual: `curl localhost:4242/api/overview` returns data |
| 9 | `src/ingestion/IngestEndpoint.ts` | Manual: `curl -X POST /api/ingest` with sample payload works |
| 10 | `sdk/python/agent_monitor/` — full Python SDK | Manual: Python script posts to /api/ingest, appears in DB |
| 11 | Dashboard UI — Live Feed page | Visual: tool calls appear in browser in real time |
| 12 | Dashboard UI — Session Replay page | Visual: can click session and see all calls with args/response |
| 13 | Dashboard UI — Tool Analytics page | Visual: latency chart renders with real data |
| 14 | Dashboard UI — Server Health + Alerts pages | Visual: health status correct, alerts shown |
| 15 | `src/core/AlertEngine.ts` | Manual: trigger slow call, alert appears in DB and console |
| 16 | `src/ingestion/mcp/HttpProxy.ts` | Manual: HTTP MCP server proxied correctly |
| 17 | `src/cli.ts` — all commands | Manual: all CLI commands work |
| 18 | README, demo GIF, npm publish | `npx mcp-monitor --help` works from any directory |

---

## Distribution

```bash
# TypeScript core
npm install -g mcp-monitor
# or without installing
npx mcp-monitor start

# Python SDK
pip install agent-monitor
```

`package.json` bin entry:
```json
{
  "bin": { "mcp-monitor": "./dist/cli.js" },
  "files": ["dist/", "sdk/python/"]
}
```

`sdk/python/pyproject.toml`:
```toml
[project]
name = "agent-monitor"
version = "0.1.0"
description = "Observability SDK for Python AI agents — pairs with mcp-monitor"
requires-python = ">=3.9"
dependencies = []   # zero dependencies — stdlib only
```
