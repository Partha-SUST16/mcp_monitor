import { useState, useEffect } from 'react';

interface Server {
    name: string;
    status: 'healthy' | 'degraded' | 'down';
    errorRatePct: number;
    p95LatencyMs: number;
    totalCalls5m: number;
    lastSeenAt: string | null;
}

function timeAgo(ts: string | null): string {
    if (!ts) return 'Never';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
}

export default function ServerHealth() {
    const [servers, setServers] = useState<Server[]>([]);

    const fetchServers = () => {
        fetch('/api/servers')
            .then(r => r.json())
            .then(d => setServers(d.servers))
            .catch(() => { });
    };

    useEffect(() => {
        fetchServers();
        const interval = setInterval(fetchServers, 30000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div>
            <div className="page-header">
                <h2>Server Health</h2>
                <p>Status of all monitored MCP servers (auto-refreshes every 30s)</p>
            </div>

            {servers.length === 0 ? (
                <div className="card">
                    <div className="empty-state">
                        <p>No server data in the last 5 minutes. Servers appear here once they handle tool calls.</p>
                    </div>
                </div>
            ) : (
                <div className="server-grid">
                    {servers.map(server => (
                        <div key={server.name} className="server-card">
                            <div className="flex items-center gap-3" style={{ marginBottom: '16px' }}>
                                <span className={`status-dot ${server.status}`}></span>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '16px' }}>{server.name}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                                        {server.status}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <div className="stat-label">Error Rate</div>
                                    <div style={{ fontSize: '18px', fontWeight: 600, color: server.errorRatePct > 5 ? 'var(--error)' : 'var(--success)' }}>
                                        {server.errorRatePct.toFixed(1)}%
                                    </div>
                                </div>
                                <div>
                                    <div className="stat-label">P95 Latency</div>
                                    <div style={{ fontSize: '18px', fontWeight: 600 }}>{server.p95LatencyMs}ms</div>
                                </div>
                                <div>
                                    <div className="stat-label">Calls (5m)</div>
                                    <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--accent-hover)' }}>
                                        {server.totalCalls5m}
                                    </div>
                                </div>
                                <div>
                                    <div className="stat-label">Last Seen</div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {timeAgo(server.lastSeenAt)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
