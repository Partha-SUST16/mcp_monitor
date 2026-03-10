import { useState, useEffect, useRef } from 'react';

interface ToolCall {
    sessionId: string;
    agentType: string;
    serverName: string;
    toolName: string;
    status: string;
    latencyMs: number;
    timestamp: string;
    errorMsg?: string;
}

function timeAgo(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
}

export default function LiveFeed() {
    const [calls, setCalls] = useState<ToolCall[]>([]);
    const [paused, setPaused] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [overview, setOverview] = useState<any>(null);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    useEffect(() => {
        fetch('/api/overview')
            .then(r => r.json())
            .then(data => {
                setOverview(data);
                if (data.recentCalls) {
                    setCalls(data.recentCalls.slice(0, 200));
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        const es = new EventSource('/api/stream');

        es.addEventListener('tool_call', (e) => {
            const call = JSON.parse(e.data);
            if (!pausedRef.current) {
                setCalls(prev => [call, ...prev].slice(0, 200));
            }
        });

        es.addEventListener('alert', (e) => {
            const alert = JSON.parse(e.data);
            setToast(`⚠️ Alert: ${alert.serverName}/${alert.toolName} — ${alert.metric}`);
            setTimeout(() => setToast(null), 5000);
        });

        return () => es.close();
    }, []);

    return (
        <div>
            {toast && <div className="toast">{toast}</div>}

            <div className="page-header">
                <h2>Live Feed</h2>
                <p>Real-time tool call stream across all agents</p>
            </div>

            {overview && (
                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-label">Calls (24h)</div>
                        <div className="stat-value accent">{overview.totalCalls24h.toLocaleString()}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Error Rate</div>
                        <div className={`stat-value ${overview.errorRate24h > 5 ? 'error' : 'success'}`}>
                            {overview.errorRate24h.toFixed(1)}%
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Avg Latency</div>
                        <div className="stat-value">{overview.avgLatencyMs}ms</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">P95 Latency</div>
                        <div className={`stat-value ${overview.p95LatencyMs > 2000 ? 'warning' : ''}`}>
                            {overview.p95LatencyMs}ms
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Active Servers</div>
                        <div className="stat-value accent">{overview.activeServers}</div>
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3 className="flex items-center gap-2">
                        <span className="pulse-dot"></span> Live Tool Calls
                    </h3>
                    <button className={`btn ${paused ? 'btn-primary' : ''}`} onClick={() => setPaused(!paused)}>
                        {paused ? '▶ Resume' : '⏸ Pause'}
                    </button>
                </div>
                <div className="card-body">
                    {calls.length === 0 ? (
                        <div className="empty-state">
                            <p>No tool calls yet. Connect an agent to start monitoring.</p>
                        </div>
                    ) : (
                        <table>
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Agent</th>
                                    <th>Server</th>
                                    <th>Tool</th>
                                    <th>Status</th>
                                    <th className="text-right">Latency</th>
                                </tr>
                            </thead>
                            <tbody>
                                {calls.map((call, i) => (
                                    <tr key={`${call.timestamp}-${i}`}>
                                        <td className="mono" style={{ fontSize: '12px' }}>{timeAgo(call.timestamp)}</td>
                                        <td><span className="badge badge-accent">{call.agentType}</span></td>
                                        <td>{call.serverName}</td>
                                        <td className="mono" style={{ color: 'var(--text-primary)' }}>{call.toolName}</td>
                                        <td>
                                            <span className={`badge ${call.status === 'success' ? 'badge-success' : call.status === 'error' ? 'badge-error' : 'badge-warning'}`}>
                                                {call.status}
                                            </span>
                                        </td>
                                        <td className="text-right mono">{call.latencyMs}ms</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
