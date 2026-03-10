import { CollectorEvent, ResponsePayload } from '../types';
import { store } from './Store';
import { eventBus } from './EventBus';

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
    handle(event: CollectorEvent) {
        const sanitizedArgs = sanitize(event.arguments);
        const response = event.response
            ? (event.response.truncated !== undefined ? event.response : truncateResponse(event.response))
            : (event.response === null ? null : truncateResponse(event.response));

        const processed: CollectorEvent = {
            ...event,
            arguments: sanitizedArgs,
            response: response as ResponsePayload | null,
        };

        store.insertToolCall(processed);
        eventBus.emit('tool_call', processed);
    }
}

export const collector = new Collector();
