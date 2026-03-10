#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config';
import { createDashboardServer } from './dashboard/server';
import { StdioProxy } from './ingestion/mcp/StdioProxy';
import { HttpProxy } from './ingestion/mcp/HttpProxy';
import { AlertEngine } from './core/AlertEngine';
import { store } from './core/Store';
import { collector } from './core/Collector';
import { sessionManager } from './core/SessionManager';
import { RemoteCollector } from './core/RemoteCollector';
import { v4 as randomUUID } from 'uuid';

const program = new Command();

program
    .name('mcp-monitor')
    .description('Transparent observability for agentic AI pipelines')
    .version('0.1.0');

program
    .command('start')
    .description('Start monitoring all servers defined in config')
    .option('-c, --config <path>', 'config file path', './mcp-monitor.config.json')
    .action((opts) => {
        const config = loadConfig(opts.config);
        createDashboardServer(config.dashboard.port);

        const alertEngine = new AlertEngine(config.alerts);
        alertEngine.start();

        for (const server of config.servers) {
            if (server.transport === 'stdio' && server.command) {
                console.error(`[mcp-monitor] Starting stdio proxy for ${server.name}`);
                new StdioProxy({ name: server.name, command: server.command, env: server.env }, collector, sessionManager).start();
            } else if (server.transport === 'http' && server.targetUrl) {
                console.error(`[mcp-monitor] Starting HTTP proxy for ${server.name}`);
                new HttpProxy({
                    name: server.name,
                    targetUrl: server.targetUrl,
                    listenPort: server.listenPort ?? 4243,
                }).start();
            }
        }
    });

program
    .command('proxy')
    .description('Start a proxy for a single MCP server (used in agent config)')
    .requiredOption('--name <name>', 'logical name for this server')
    .requiredOption('--cmd <command>', 'command to spawn the real MCP server')
    .option('--session-id <id>', 'explicit session ID')
    .option('--dashboard-url <url>', 'dashboard server URL', 'http://localhost:4242')
    .action((opts) => {
        const remoteCollector = new RemoteCollector(opts.dashboardUrl);

        // Lightweight in-memory session manager (no SQLite dependency)
        const sessionId = opts.sessionId ?? process.env.MCP_MONITOR_SESSION_ID ?? randomUUID();
        const lightSessionMgr = {
            getOrCreate(_key: string, _isInit?: boolean) { return sessionId; },
        };

        const proxy = new StdioProxy({ name: opts.name, command: opts.cmd }, remoteCollector, lightSessionMgr);
        proxy.start();
    });

program
    .command('sessions')
    .description('List recent sessions')
    .option('--limit <n>', 'number of sessions', '20')
    .action(async (opts) => {
        const data = store.getSessions(parseInt(opts.limit), 0);
        console.log(JSON.stringify(data, null, 2));
    });

program
    .command('replay <id>')
    .description('Replay a session\'s tool calls')
    .action(async (id: string) => {
        const data = store.getSessionCalls(id);
        if (!data) {
            console.error('Session not found');
            process.exit(1);
        }
        console.log(JSON.stringify(data, null, 2));
    });

program
    .command('stats')
    .option('--sort <field>', 'sort by: latency_p95 | error_rate | call_count', 'latency_p95')
    .option('--since <duration>', '1h | 6h | 24h | 7d', '24h')
    .action(async (opts) => {
        const sinceMap: Record<string, number> = {
            '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000,
        };
        const since = new Date(Date.now() - (sinceMap[opts.since] ?? 86400000)).toISOString();
        const data = store.getToolStats(since);

        const sorted = data.tools.sort((a: any, b: any) => {
            if (opts.sort === 'error_rate') return b.errorRatePct - a.errorRatePct;
            if (opts.sort === 'call_count') return b.callCount - a.callCount;
            return b.p95LatencyMs - a.p95LatencyMs;
        });

        console.log(JSON.stringify({ tools: sorted }, null, 2));
    });

program
    .command('export')
    .option('--format <fmt>', 'json | csv', 'json')
    .option('--since <duration>', '1h | 6h | 24h | 7d', '24h')
    .option('--output <path>', 'output file path')
    .action(async (opts) => {
        const sinceMap: Record<string, number> = {
            '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000,
        };
        const since = new Date(Date.now() - (sinceMap[opts.since] ?? 86400000)).toISOString();
        const data = store.getToolStats(since);

        let output: string;
        if (opts.format === 'csv') {
            const header = 'toolName,serverName,callCount,errorRatePct,p50LatencyMs,p95LatencyMs,p99LatencyMs';
            const rows = data.tools.map((t: any) =>
                `${t.toolName},${t.serverName},${t.callCount},${t.errorRatePct},${t.p50LatencyMs},${t.p95LatencyMs},${t.p99LatencyMs}`
            );
            output = [header, ...rows].join('\n');
        } else {
            output = JSON.stringify(data, null, 2);
        }

        if (opts.output) {
            require('fs').writeFileSync(opts.output, output);
            console.error(`Exported to ${opts.output}`);
        } else {
            console.log(output);
        }
    });

program.parse();
