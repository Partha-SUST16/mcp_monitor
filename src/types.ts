export type AgentType = 'mcp-stdio' | 'mcp-http' | 'python-sdk' | 'agent-proxy' | 'cline' | 'cursor' | 'other';
export type CallStatus = 'success' | 'error' | 'timeout';
export type AlertMetric = 'latency_p95' | 'error_rate';

export interface CollectorEvent {
    sessionId: string;
    agentType: AgentType;
    serverName: string;
    toolName: string;
    method: string;
    arguments: unknown;
    response: ResponsePayload | null;
    status: CallStatus;
    latencyMs: number;
    timestamp: string;
    errorMsg?: string;
}

export interface ResponsePayload {
    data: unknown;
    truncated: boolean;
    sizeBytes: number;
}

export interface Session {
    id: string;
    serverName: string;
    startedAt: string;
    endedAt?: string;
    label?: string;
    callCount?: number;
}

export interface ToolCallRow {
    id: number;
    sessionId: string;
    agentType: AgentType;
    serverName: string;
    toolName: string;
    method: string;
    arguments: unknown;
    response: ResponsePayload | null;
    status: CallStatus;
    latencyMs: number;
    timestamp: string;
    errorMsg: string | null;
}

export interface ServerHealth {
    name: string;
    status: 'healthy' | 'degraded' | 'down';
    errorRatePct: number;
    p95LatencyMs: number;
    totalCalls5m: number;
    lastSeenAt: string | null;
}

export interface AlertEvent {
    id: number;
    toolName: string;
    serverName: string;
    metric: AlertMetric;
    value: number;
    threshold: number;
    firedAt: string;
}

export interface Config {
    servers: ServerConfig[];
    dashboard: { port: number };
    alerts: AlertConfig;
}

export interface ServerConfig {
    name: string;
    transport: 'stdio' | 'http';
    command?: string;
    env?: Record<string, string>;
    targetUrl?: string;
    listenPort?: number;
}

export interface AlertConfig {
    latencyP95Ms: number;
    errorRatePercent: number;
    checkIntervalSeconds: number;
    cooldownMinutes: number;
}
