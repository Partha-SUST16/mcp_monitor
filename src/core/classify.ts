import { CollectorEvent, ErrorClass } from '../types';

// Matches server messages that indicate the agent reached for something that
// doesn't exist — i.e. a hallucinated tool or method name. Used as a fallback
// when no JSON-RPC error code is available (e.g. the Python SDK).
const HALLUCINATION_MSG = /unknown tool|tool not found|no such tool|unknown method|method not found|unrecognized/i;
const TIMEOUT_MSG = /timed?\s*out|timeout|deadline exceeded/i;

/**
 * Classify a failed tool call into one of three operationally-distinct buckets.
 * Returns null for successful calls (nothing to classify).
 *
 * The taxonomy maps to different remediations:
 *   - hallucination → fix the prompt / tool schema (the model's fault)
 *   - tool_failure  → fix the backing service (the tool's fault)
 *   - timeout       → fix capacity / latency (neither's fault, but actionable)
 */
export function classifyError(event: Pick<CollectorEvent, 'status' | 'errorCode' | 'errorMsg'>): ErrorClass | null {
    if (event.status === 'success') return null;
    if (event.status === 'timeout') return 'timeout';

    const code = event.errorCode;
    // -32601 = method not found, -32602 = invalid params. Both mean the model
    // either invented a tool name or fabricated arguments the schema rejects.
    if (code === -32601 || code === -32602) return 'hallucination';

    const msg = event.errorMsg ?? '';
    if (HALLUCINATION_MSG.test(msg)) return 'hallucination';
    if (TIMEOUT_MSG.test(msg)) return 'timeout';

    return 'tool_failure';
}
