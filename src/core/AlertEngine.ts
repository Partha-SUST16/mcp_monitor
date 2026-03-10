import { AlertConfig, AlertMetric } from '../types';
import { store } from './Store';
import { eventBus } from './EventBus';

export class AlertEngine {
    private cooldowns = new Map<string, number>();
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(private config: AlertConfig) { }

    start() {
        this.timer = setInterval(() => this.run(), this.config.checkIntervalSeconds * 1000);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private run() {
        const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();

        const latencies = store.getP95LatencyByTool(since);
        for (const { toolName, serverName, p95 } of latencies) {
            if (p95 > this.config.latencyP95Ms) {
                this.maybeFireAlert(toolName, serverName, 'latency_p95', p95, this.config.latencyP95Ms);
            }
        }

        const errorRates = store.getErrorRateByTool(since);
        for (const { toolName, serverName, rate } of errorRates) {
            if (rate > this.config.errorRatePercent) {
                this.maybeFireAlert(toolName, serverName, 'error_rate', rate, this.config.errorRatePercent);
            }
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
