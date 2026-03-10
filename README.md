# MCP Monitor

**Transparent observability for agentic AI pipelines.**

MCP Monitor intercepts every tool call made by an AI agent — whether the agent uses the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) or calls Python functions directly — and surfaces metrics, session replays, and alerts through a local web dashboard.

**Zero changes to your agent. Zero changes to your MCP servers.**

![Dashboard Live Feed](docs/dashboard-live-feed.png)

---

## Features

- ⚡ **Live Feed** — Real-time SSE-powered stream of all tool calls with status badges and latency
- 📋 **Session Replay** — Browse sessions, view call timelines with a Gantt chart, expand any call to inspect arguments and responses
- 📊 **Tool Analytics** — P50/P95/P99 latency charts, call volume, and error rate trends via Chart.js
- 🖥️ **Server Health** — Per-server status cards (healthy / degraded / down) with auto-refresh
- 🔔 **Alerts** — Configurable P95 latency and error rate thresholds with cooldown-based alerting
- 🔒 **Secret Sanitization** — Automatically redacts tokens, passwords, API keys from stored arguments
- ✂️ **Response Truncation** — Large responses (>10KB) are intelligently truncated before storage
- 🐍 **Python SDK** — Zero-dependency pip package to monitor any Python agent (QwenAgent, LangChain, custom)
- 💾 **SQLite Storage** — Single-file database with WAL mode for fast concurrent reads

---

## Architecture

```
Agent (Claude, Cursor, Python)
    │
    ├── MCP stdio ──► StdioProxy ──┐
    ├── MCP HTTP  ──► HttpProxy  ──┤── collector.handle() ──► SQLite
    └── Python fn ──► Python SDK ──┘         │
                                        EventBus.emit()
                                             │
                                        SSE push to
                                        Dashboard UI
```

**Core constraint:** SQLite has exactly one writer (the Collector). The StdioProxy and HttpProxy call `collector.handle()` directly (in-process). The Python SDK POSTs to `/api/ingest` over HTTP.

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Install & Run

```bash
git clone <repo-url> mcp-monitor
cd mcp-monitor

# Install backend dependencies
npm install

# Install and build the dashboard UI
cd src/dashboard/ui && npm install && npx vite build && cd ../../..

# Start the monitor
npx ts-node src/cli.ts start
```

The dashboard will be available at **http://localhost:4242**.

### Send a Test Event

```bash
curl -X POST http://localhost:4242/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId": "test-session",
    "agentType": "python-sdk",
    "serverName": "my-server",
    "toolName": "read_file",
    "method": "read_file",
    "arguments": {"path": "/tmp/test.txt"},
    "response": null,
    "status": "success",
    "latencyMs": 150,
    "timestamp": "2026-03-09T10:00:00Z"
  }'
```

---

## Connecting Agents

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

The agent connects to `mcp-monitor` as if it were the MCP server. The proxy spawns the real server, pipes stdin/stdout through, and records every JSON-RPC call.

### Python Agent (QwenAgent)

```python
from agent_monitor import patch_qwen_agent

patch_qwen_agent(server_name="my-agent")  # call once before creating agent
# rest of agent code unchanged
```

### Generic Python Tool

```python
from agent_monitor import monitor

@monitor(server_name="my-tools")
def query_database(sql: str) -> dict:
    ...
```

### Python SDK Installation

```bash
cd sdk/python
pip install -e .
```

The SDK has **zero external dependencies** — it uses only Python stdlib (`urllib`, `threading`, `json`).

---

## Configuration

Create `mcp-monitor.config.json` in the project root:

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

Environment variable substitution is supported in `env` fields — `$VAR_NAME` is replaced with `process.env.VAR_NAME`.

---

## CLI Commands

```bash
# Start monitoring all configured servers + dashboard
npx ts-node src/cli.ts start [-c path/to/config.json]

# Start a single MCP proxy (used in agent config)
npx ts-node src/cli.ts proxy --name filesystem --cmd "npx @modelcontextprotocol/server-filesystem /tmp"

# List recent sessions
npx ts-node src/cli.ts sessions [--limit 20]

# Replay a session's tool calls
npx ts-node src/cli.ts replay <session-id>

# Show per-tool stats
npx ts-node src/cli.ts stats [--sort latency_p95|error_rate|call_count] [--since 1h|6h|24h|7d]

# Export data
npx ts-node src/cli.ts export [--format json|csv] [--since 24h] [--output file.json]
```

---

## REST API

| Endpoint | Description |
|---|---|
| `GET /api/overview` | Aggregated stats: total calls, error rate, avg/p95 latency, recent calls |
| `GET /api/sessions` | Paginated session list with call counts (`?limit=20&offset=0`) |
| `GET /api/sessions/:id/calls` | All tool calls for a session in chronological order |
| `GET /api/tools/stats` | Per-tool latency percentiles and error rates (`?since=24h`) |
| `GET /api/servers` | Server health status derived from last 5 minutes of data |
| `GET /api/alerts` | Fired alert history (`?limit=50&offset=0`) |
| `GET /api/stream` | SSE endpoint — pushes `tool_call` and `alert` events in real time |
| `POST /api/ingest` | Accepts `CollectorEvent` JSON (used by Python SDK) |

---

## Project Structure

```
mcp-monitor/
├── src/
│   ├── types.ts                          # All shared TypeScript interfaces
│   ├── config.ts                         # Config loader with env var substitution
│   ├── cli.ts                            # Commander.js entry point
│   ├── core/
│   │   ├── Store.ts                      # SQLite (better-sqlite3) CRUD
│   │   ├── Collector.ts                  # Sanitize → truncate → persist → emit
│   │   ├── SessionManager.ts            # Session lifecycle + idle timeout
│   │   ├── EventBus.ts                  # Node.js EventEmitter singleton
│   │   └── AlertEngine.ts              # P95 latency & error rate monitoring
│   ├── ingestion/
│   │   ├── mcp/
│   │   │   ├── ProtocolInterceptor.ts   # JSON-RPC request/response matching
│   │   │   ├── StdioProxy.ts            # MCP stdio transport proxy
│   │   │   └── HttpProxy.ts            # MCP HTTP reverse proxy
│   │   └── IngestEndpoint.ts            # POST /api/ingest handler
│   └── dashboard/
│       ├── server.ts                     # Express + SSE + static serving
│       ├── routes/                       # API route handlers
│       └── ui/                           # React + Vite dashboard
│           └── src/pages/
│               ├── LiveFeed.tsx
│               ├── SessionReplay.tsx
│               ├── ToolAnalytics.tsx
│               ├── ServerHealth.tsx
│               └── Alerts.tsx
├── sdk/python/
│   ├── pyproject.toml
│   └── agent_monitor/
│       ├── __init__.py
│       ├── collector.py                  # Fire-and-forget POST to /api/ingest
│       └── decorators.py                # patch_qwen_agent() + @monitor
├── mcp-monitor.config.json
├── package.json
└── tsconfig.json
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| MCP Proxy | TypeScript (child_process, JSON-RPC parsing) |
| Core | TypeScript + Express 5 |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| Dashboard UI | React 19 + Vite + Chart.js |
| Real-time Push | Server-Sent Events (SSE) |
| Python SDK | Python 3.9+ (stdlib only) |
| CLI | Commander.js |

---

## Session Management

Sessions are created and managed automatically:

- **MCP connections:** A new session starts on every `initialize` JSON-RPC message
- **Idle timeout:** If 5+ minutes pass between tool calls, a new session is created
- **Explicit session ID:** Set `MCP_MONITOR_SESSION_ID` env var for deterministic session grouping
- **Python SDK:** Each Python process gets a unique UUID session, or set `AGENT_MONITOR_SESSION_ID`
- **Session end:** Marked when the proxied process exits or the connection closes

---

## Alert System

The AlertEngine polls every `checkIntervalSeconds` (default: 30s) and checks:

- **P95 Latency** per tool over the last 5 minutes → fires if above `latencyP95Ms` threshold
- **Error Rate** per tool over the last 5 minutes → fires if above `errorRatePercent` threshold

Cooldown logic prevents the same alert from re-firing within `cooldownMinutes` (default: 5 min). Alerts are persisted to SQLite and pushed to the dashboard via SSE.

---

## License

MIT
