import fs from 'fs';
import path from 'path';
import { Config } from './types';

const DEFAULT_CONFIG: Config = {
    servers: [],
    dashboard: { port: 4242 },
    alerts: {
        latencyP95Ms: 2000,
        errorRatePercent: 10,
        checkIntervalSeconds: 30,
        cooldownMinutes: 5,
    },
};

export function loadConfig(configPath?: string): Config {
    const resolved = configPath ?? path.join(process.cwd(), 'mcp-monitor.config.json');

    if (!fs.existsSync(resolved)) {
        console.error(`[config] No config file found at ${resolved}, using defaults`);
        return DEFAULT_CONFIG;
    }

    const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const config: Config = {
        servers: raw.servers ?? [],
        dashboard: { port: raw.dashboard?.port ?? 4242 },
        alerts: {
            latencyP95Ms: raw.alerts?.latencyP95Ms ?? 2000,
            errorRatePercent: raw.alerts?.errorRatePercent ?? 10,
            checkIntervalSeconds: raw.alerts?.checkIntervalSeconds ?? 30,
            cooldownMinutes: raw.alerts?.cooldownMinutes ?? 5,
        },
    };

    // Substitute env vars in server env fields ($VAR_NAME → process.env.VAR_NAME)
    for (const server of config.servers) {
        if (server.env) {
            for (const [key, value] of Object.entries(server.env)) {
                if (typeof value === 'string' && value.startsWith('$')) {
                    server.env[key] = process.env[value.slice(1)] ?? '';
                }
            }
        }
    }

    return config;
}
