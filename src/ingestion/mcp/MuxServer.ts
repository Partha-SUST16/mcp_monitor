import { spawn, ChildProcess } from 'child_process';
import { RemoteCollector } from '../../core/RemoteCollector';
import { ServerConfig, CollectorEvent } from '../../types';
import { v4 as randomUUID } from 'uuid';

interface PendingCall {
    agentId: string | number;
    serverName: string;
    childId: number;
    toolName: string;
    method: string;
    args: unknown;
    startTime: number;
    timestamp: string;
}

interface ChildServer {
    name: string;
    process: ChildProcess;
    tools: any[];
    resources: any[];
    prompts: any[];
    ready: boolean;
    nextId: number;
    pending: Map<number, (result: any) => void>;
    buffer: string;
}

export class MuxServer {
    private children = new Map<string, ChildServer>();
    private toolToServer = new Map<string, { server: string, originalName: string }>();
    private pendingCalls = new Map<string, PendingCall>();
    private collector: RemoteCollector;
    private sessionId: string;
    private inputBuffer = '';

    constructor(
        private servers: ServerConfig[],
        private dashboardUrl: string,
    ) {
        this.collector = new RemoteCollector(dashboardUrl);
        this.sessionId = process.env.MCP_MONITOR_SESSION_ID ?? randomUUID();
    }

    async start() {
        for (const server of this.servers) {
            if (server.transport === 'stdio' && server.command) {
                this.spawnChild(server);
            }
        }

        process.stdin.on('data', (chunk: Buffer) => {
            this.inputBuffer += chunk.toString('utf8');
            const lines = this.inputBuffer.split('\n');
            this.inputBuffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    this.handleAgentMessage(JSON.parse(line));
                } catch { /* ignore non-JSON */ }
            }
        });

        process.stdin.on('end', () => {
            for (const child of this.children.values()) {
                child.process.kill();
            }
            process.exit(0);
        });
    }

    private spawnChild(server: ServerConfig) {
        const [cmd, ...args] = server.command!.split(' ');
        const child = spawn(cmd, args, {
            env: { ...process.env, ...server.env },
            stdio: ['pipe', 'pipe', 'inherit'],
        });

        const entry: ChildServer = {
            name: server.name,
            process: child,
            tools: [],
            resources: [],
            prompts: [],
            ready: false,
            nextId: 1,
            pending: new Map(),
            buffer: '',
        };

        child.stdout!.on('data', (chunk: Buffer) => {
            entry.buffer += chunk.toString('utf8');
            const lines = entry.buffer.split('\n');
            entry.buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    this.handleChildResponse(entry, JSON.parse(line));
                } catch { /* ignore */ }
            }
        });

        child.on('exit', () => {
            this.children.delete(server.name);
        });

        this.children.set(server.name, entry);
    }

    private sendToChild(child: ChildServer, msg: any): Promise<any> {
        return new Promise((resolve) => {
            const id = child.nextId++;
            child.pending.set(id, resolve);
            const outMsg = { ...msg, id, jsonrpc: '2.0' };
            child.process.stdin!.write(JSON.stringify(outMsg) + '\n');
        });
    }

    private sendToAgent(msg: any) {
        process.stdout.write(JSON.stringify(msg) + '\n');
    }

    private handleChildResponse(child: ChildServer, msg: any) {
        if (msg.id !== undefined && !msg.method) {
            const resolve = child.pending.get(msg.id);
            if (resolve) {
                child.pending.delete(msg.id);
                resolve(msg);
            }
        }

        // Forward notifications from children to agent
        if (msg.method && msg.id === undefined) {
            this.sendToAgent(msg);
        }
    }

    private async handleAgentMessage(msg: any) {
        if (msg.method === 'initialize') {
            await this.handleInitialize(msg);
        } else if (msg.method === 'initialized') {
            // Send initialized to all children
            for (const child of this.children.values()) {
                child.process.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
            }
        } else if (msg.method === 'tools/list') {
            await this.handleToolsList(msg);
        } else if (msg.method === 'tools/call') {
            await this.handleToolsCall(msg);
        } else if (msg.method === 'resources/list') {
            await this.handleResourcesList(msg);
        } else if (msg.method === 'resources/read') {
            await this.handleResourcesRead(msg);
        } else if (msg.method === 'prompts/list') {
            await this.handlePromptsList(msg);
        } else if (msg.method === 'prompts/get') {
            await this.handlePromptsGet(msg);
        } else if (msg.method === 'ping') {
            this.sendToAgent({ jsonrpc: '2.0', id: msg.id, result: {} });
        } else {
            // Unknown method — try forwarding to first child
            const first = this.children.values().next().value;
            if (first) {
                const res = await this.sendToChild(first, { method: msg.method, params: msg.params });
                this.sendToAgent({ jsonrpc: '2.0', id: msg.id, result: res.result, error: res.error });
            } else {
                this.sendToAgent({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'No servers available' } });
            }
        }
    }

    private async handleInitialize(msg: any) {
        // Initialize all children
        const initPromises = Array.from(this.children.values()).map(async (child) => {
            try {
                const res = await this.sendToChild(child, {
                    method: 'initialize',
                    params: msg.params,
                });
                child.ready = true;
                return res;
            } catch {
                return null;
            }
        });

        await Promise.all(initPromises);

        // Respond with merged capabilities
        this.sendToAgent({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: { listChanged: true },
                    resources: { subscribe: false, listChanged: true },
                    prompts: { listChanged: true },
                },
                serverInfo: {
                    name: 'mcp-monitor',
                    version: '0.1.0',
                },
            },
        });
    }

    private async handleToolsList(msg: any) {
        this.toolToServer.clear();
        const allTools: any[] = [];

        const promises = Array.from(this.children.values()).map(async (child) => {
            if (!child.ready) return;
            try {
                const res = await this.sendToChild(child, { method: 'tools/list', params: msg.params ?? {} });
                if (res.result?.tools) {
                    child.tools = res.result.tools;
                    for (const tool of res.result.tools) {
                        const prefixedName = `${child.name}_${tool.name}`;
                        this.toolToServer.set(prefixedName, { server: child.name, originalName: tool.name });
                        allTools.push({ ...tool, name: prefixedName });
                    }
                }
            } catch { /* skip unresponsive children */ }
        });

        await Promise.all(promises);
        this.sendToAgent({ jsonrpc: '2.0', id: msg.id, result: { tools: allTools } });
    }

    private async handleToolsCall(msg: any) {
        const requestedToolName = msg.params?.name;
        const mapping = this.toolToServer.get(requestedToolName);

        if (!mapping) {
            this.sendToAgent({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${requestedToolName}` } });
            return;
        }

        const child = this.children.get(mapping.server);
        if (!child) {
            this.sendToAgent({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `Server ${mapping.server} not available` } });
            return;
        }

        const startTime = Date.now();
        const timestamp = new Date().toISOString();

        // Pass the original tool name to the child
        const callParams = { ...msg.params, name: mapping.originalName };
        const res = await this.sendToChild(child, { method: 'tools/call', params: callParams });

        const latencyMs = Date.now() - startTime;
        const status = res.error ? 'error' : 'success';

        this.collector.handle({
            sessionId: this.sessionId,
            agentType: 'agent-proxy',
            serverName: mapping.server,
            toolName: mapping.originalName,
            method: 'tools/call',
            arguments: msg.params,
            response: res.error ?? res.result,
            errorMsg: res.error ? JSON.stringify(res.error) : undefined,
            status,
            latencyMs,
            timestamp,
        });

        this.sendToAgent({ jsonrpc: '2.0', id: msg.id, result: res.result, error: res.error });
    }

    private async handleResourcesList(msg: any) {
        const allResources: any[] = [];
        const promises = Array.from(this.children.values()).map(async (child) => {
            if (!child.ready) return;
            try {
                const res = await this.sendToChild(child, { method: 'resources/list', params: msg.params ?? {} });
                if (res.result?.resources) {
                    child.resources = res.result.resources;
                    allResources.push(...res.result.resources);
                }
            } catch { /* skip */ }
        });
        await Promise.all(promises);
        this.sendToAgent({ jsonrpc: '2.0', id: msg.id, result: { resources: allResources } });
    }

    private async handleResourcesRead(msg: any) {
        // Try each child until one responds
        for (const child of this.children.values()) {
            if (!child.ready) continue;
            try {
                const res = await this.sendToChild(child, { method: 'resources/read', params: msg.params });
                if (res.result) {
                    this.sendToAgent({ jsonrpc: '2.0', id: msg.id, result: res.result });
                    return;
                }
            } catch { /* try next */ }
        }
        this.sendToAgent({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Resource not found' } });
    }

    private async handlePromptsList(msg: any) {
        const allPrompts: any[] = [];
        const promises = Array.from(this.children.values()).map(async (child) => {
            if (!child.ready) return;
            try {
                const res = await this.sendToChild(child, { method: 'prompts/list', params: msg.params ?? {} });
                if (res.result?.prompts) {
                    child.prompts = res.result.prompts;
                    allPrompts.push(...res.result.prompts);
                }
            } catch { /* skip */ }
        });
        await Promise.all(promises);
        this.sendToAgent({ jsonrpc: '2.0', id: msg.id, result: { prompts: allPrompts } });
    }

    private async handlePromptsGet(msg: any) {
        for (const child of this.children.values()) {
            if (!child.ready) continue;
            try {
                const res = await this.sendToChild(child, { method: 'prompts/get', params: msg.params });
                if (res.result) {
                    this.sendToAgent({ jsonrpc: '2.0', id: msg.id, result: res.result });
                    return;
                }
            } catch { /* try next */ }
        }
        this.sendToAgent({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Prompt not found' } });
    }
}
