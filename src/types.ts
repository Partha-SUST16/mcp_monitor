export type AgentType = 'mcp-stdio' | 'mcp-http' | 'python-sdk' | 'agent-proxy' | 'cline' | 'cursor' | 'other';
export type CallStatus = 'success' | 'error' | 'timeout';
export type AlertMetric = 'latency_p95' | 'error_rate';

// Why a failed call is split into three classes: each implies a different fix.
//  - hallucination: the model invented a tool that doesn't exist, or fabricated
//    arguments that don't match the schema → fix the prompt / tool descriptions.
//  - tool_failure:  the tool exists and was called correctly but errored internally
//    (file missing, 500, upstream down) → fix the backing service.
//  - timeout:       no response within the deadline → fix capacity / latency.
export type ErrorClass = 'timeout' | 'tool_failure' | 'hallucination';

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
    // JSON-RPC error code (e.g. -32601 method not found, -32602 invalid params).
    // Set by the interceptor/proxies; drives error classification.
    errorCode?: number;
    // Enrichment fields populated centrally in collector.handle() — see Collector.ts.
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    errorClass?: ErrorClass | null;
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
    errorCode: number | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    errorClass: ErrorClass | null;
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
    pricing: PricingConfig;
}

// Token & cost estimation settings. MCP carries no real LLM token counts, so we
// estimate tokens from payload byte size (bytes / charsPerToken) and price them
// per-million. perServer overrides let different MCP servers (≈ different backing
// models) carry different rates.
export interface PricingConfig {
    charsPerToken: number;
    inputPerMillion: number;
    outputPerMillion: number;
    perServer?: Record<string, { inputPerMillion: number; outputPerMillion: number }>;
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
