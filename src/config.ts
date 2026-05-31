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
    // Defaults model a typical mid-tier frontier model ($3 / $15 per 1M tokens).
    // These are estimates — override per-server in config to match your backends.
    pricing: {
        charsPerToken: 4,
        inputPerMillion: 3.0,
        outputPerMillion: 15.0,
    },
};

export function loadConfig(configPath?: string): Config {
    // Resolution chain
    const pathsToTry = configPath
        ? [path.resolve(process.cwd(), configPath)]
        : [
            path.join(process.cwd(), 'mcp-monitor.config.json'),
            path.join(__dirname, '..', 'mcp-monitor.config.json'),
            path.join(__dirname, '..', '..', 'mcp-monitor.config.json')
        ];

    let resolved = '';
    for (const p of pathsToTry) {
        if (fs.existsSync(p)) {
            resolved = p;
            break;
        }
    }

    if (!resolved) {
        console.error(`[config] No config file found in tried paths:\n${pathsToTry.map(p => `  - ${p}`).join('\n')}\nUsing defaults.`);
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
        pricing: {
            charsPerToken: raw.pricing?.charsPerToken ?? 4,
            inputPerMillion: raw.pricing?.inputPerMillion ?? 3.0,
            outputPerMillion: raw.pricing?.outputPerMillion ?? 15.0,
            perServer: raw.pricing?.perServer ?? undefined,
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
