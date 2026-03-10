import { AlertConfig, AlertMetric, CollectorEvent } from '../types';
import { store } from './Store';
import { eventBus } from './EventBus';

export class AlertEngine {
    private cooldowns = new Map<string, number>();
    private recentCalls = new Map<string, { total: number; errors: number; latencies: number[] }>();

    constructor(private config: AlertConfig) { }

    start() {
        eventBus.on('tool_call', (event: CollectorEvent) => this.onToolCall(event));
    }

    private onToolCall(event: CollectorEvent) {
        const key = `${event.serverName}:${event.toolName}`;
        let bucket = this.recentCalls.get(key);
        if (!bucket) {
            bucket = { total: 0, errors: 0, latencies: [] };
            this.recentCalls.set(key, bucket);
        }

        bucket.total++;
        bucket.latencies.push(event.latencyMs);
        if (event.status === 'error') bucket.errors++;

        // Trim old data every 100 calls per tool to keep memory bounded
        if (bucket.latencies.length > 200) {
            const half = Math.floor(bucket.latencies.length / 2);
            bucket.latencies = bucket.latencies.slice(half);
            bucket.total = bucket.latencies.length;
            bucket.errors = Math.max(0, bucket.errors - half);
        }

        const sorted = [...bucket.latencies].sort((a, b) => a - b);
        const p95Idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
        const p95 = sorted[p95Idx];
        if (p95 > this.config.latencyP95Ms) {
            this.maybeFireAlert(event.toolName, event.serverName, 'latency_p95', p95, this.config.latencyP95Ms);
        }

        const errorRate = (bucket.errors / bucket.total) * 100;
        if (bucket.total >= 5 && errorRate > this.config.errorRatePercent) {
            this.maybeFireAlert(event.toolName, event.serverName, 'error_rate', errorRate, this.config.errorRatePercent);
        }
    }

    private maybeFireAlert(
        toolName: string, serverName: string,
        metric: AlertMetric, value: number, threshold: number
    ) {
        const key = `${toolName}:${metric}`;
        const lastFired = this.cooldowns.get(key) ?? 0;
        const cooldownMs = this.config.cooldownMinutes * 60 * 1000;

        if (Date.now() - lastFired < cooldownMs) return;

        this.cooldowns.set(key, Date.now());
        store.insertAlert({ toolName, serverName, metric, value, threshold, firedAt: new Date().toISOString() });
        console.error(`[alert] ${serverName}/${toolName} ${metric}=${value} > ${threshold}`);
        eventBus.emit('alert', { toolName, serverName, metric, value, threshold });
    }
}
