import { CollectorEvent, ResponsePayload, PricingConfig } from '../types';
import { store } from './Store';
import { eventBus } from './EventBus';
import { classifyError } from './classify';

const DEFAULT_PRICING: PricingConfig = {
    charsPerToken: 4,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
};

const SECRET_KEYS = ['token', 'key', 'secret', 'password', 'auth', 'api_key',
    'apikey', 'credential', 'bearer', 'authorization'];

function sanitize(value: unknown, depth = 0): unknown {
    if (depth > 5) return value;
    if (typeof value !== 'object' || value === null) return value;
    if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));

    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const isSecret = SECRET_KEYS.some(s => k.toLowerCase().includes(s));
        clean[k] = isSecret ? '[REDACTED]' : sanitize(v, depth + 1);
    }
    return clean;
}

function truncateResponse(raw: unknown): ResponsePayload {
    const serialized = JSON.stringify(raw);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');
    const LIMIT = 10_000;

    if (sizeBytes <= LIMIT) {
        return { data: raw, truncated: false, sizeBytes };
    }

    if (Array.isArray(raw)) {
        const kept: unknown[] = [];
        let size = 2;
        for (const item of raw) {
            const itemSize = Buffer.byteLength(JSON.stringify(item), 'utf8');
            if (size + itemSize > LIMIT) break;
            kept.push(item);
            size += itemSize + 1;
        }
        return { data: kept, truncated: true, sizeBytes };
    }

    if (typeof raw === 'object' && raw !== null) {
        const kept: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            kept[k] = typeof v === 'string' ? v.slice(0, 500) : v;
        }
        return { data: kept, truncated: true, sizeBytes };
    }

    return { data: String(raw).slice(0, LIMIT), truncated: true, sizeBytes };
}

class Collector {
    private pricing: PricingConfig = DEFAULT_PRICING;

    // Called once at dashboard startup (cli.ts `start`). Because every ingestion
    // path — multiplexer, per-server proxy, Python SDK — converges on this single
    // handle() in the dashboard process, configuring pricing here enriches all of
    // them. Pricing is intentionally a single source of truth in the dashboard.
    configure(pricing?: PricingConfig) {
        if (pricing) this.pricing = { ...this.pricing, ...pricing };
    }

    handle(event: CollectorEvent) {
        const sanitizedArgs = sanitize(event.arguments);
        const response = event.response
            ? (event.response.truncated !== undefined ? event.response : truncateResponse(event.response))
            : (event.response === null ? null : truncateResponse(event.response));

        const { inputTokens, outputTokens, costUsd } = this.estimateUsage(
            sanitizedArgs,
            response as ResponsePayload | null,
            event.serverName,
        );

        const processed: CollectorEvent = {
            ...event,
            arguments: sanitizedArgs,
            response: response as ResponsePayload | null,
            inputTokens,
            outputTokens,
            costUsd,
            errorClass: classifyError(event),
        };

        store.insertToolCall(processed);
        eventBus.emit('tool_call', processed);
    }

    // Estimate tokens from byte size. We deliberately use the ORIGINAL pre-truncation
    // size for output (response.sizeBytes) — truncation is a display/storage concern,
    // not an accounting one; the model still consumed the full payload.
    private estimateUsage(args: unknown, response: ResponsePayload | null, serverName: string) {
        const cpt = this.pricing.charsPerToken || 4;
        const argBytes = Buffer.byteLength(JSON.stringify(args ?? null), 'utf8');
        const outBytes = response?.sizeBytes ?? 0;

        const inputTokens = Math.ceil(argBytes / cpt);
        const outputTokens = Math.ceil(outBytes / cpt);

        const rate = this.pricing.perServer?.[serverName] ?? this.pricing;
        const costUsd =
            (inputTokens / 1_000_000) * rate.inputPerMillion +
            (outputTokens / 1_000_000) * rate.outputPerMillion;

        return { inputTokens, outputTokens, costUsd };
    }
}

export const collector = new Collector();
