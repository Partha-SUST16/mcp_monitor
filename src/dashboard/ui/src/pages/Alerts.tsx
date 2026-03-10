import { useState, useEffect } from 'react';

interface Alert {
    id: number;
    toolName: string;
    serverName: string;
    metric: string;
    value: number;
    threshold: number;
    firedAt: string;
}

function timeAgo(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}

function metricLabel(metric: string): string {
    return metric === 'latency_p95' ? 'P95 Latency' : 'Error Rate';
}

function formatValue(metric: string, value: number): string {
    return metric === 'latency_p95' ? `${Math.round(value)}ms` : `${value.toFixed(1)}%`;
}

export default function Alerts() {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        fetch('/api/alerts?limit=100')
            .then(r => r.json())
            .then(d => {
                setAlerts(d.alerts);
                setTotal(d.total);
            })
            .catch(() => { });
    }, []);

    return (
        <div>
            <div className="page-header">
                <h2>Alerts</h2>
                <p>Alert history — {total} total alerts fired</p>
            </div>

            <div className="card">
                {alerts.length === 0 ? (
                    <div className="empty-state">
                        <p>No alerts fired yet. Alerts trigger when P95 latency or error rate exceeds thresholds.</p>
                    </div>
                ) : (
                    <div className="card-body">
                        <table>
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Server / Tool</th>
                                    <th>Metric</th>
                                    <th>Value</th>
                                    <th>Threshold</th>
                                    <th>Severity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {alerts.map(alert => {
                                    const isHigh = alert.value > alert.threshold * 2;
                                    return (
                                        <tr key={alert.id} style={isHigh ? { background: 'var(--error-bg)' } : undefined}>
                                            <td className="mono" style={{ fontSize: '12px' }}>{timeAgo(alert.firedAt)}</td>
                                            <td>
                                                <span style={{ color: 'var(--text-primary)' }}>{alert.serverName}</span>
                                                <span style={{ color: 'var(--text-muted)' }}> / </span>
                                                <span className="mono">{alert.toolName}</span>
                                            </td>
                                            <td><span className="badge badge-warning">{metricLabel(alert.metric)}</span></td>
                                            <td className="mono" style={{ color: 'var(--error)', fontWeight: 600 }}>
                                                {formatValue(alert.metric, alert.value)}
                                            </td>
                                            <td className="mono" style={{ color: 'var(--text-muted)' }}>
                                                {formatValue(alert.metric, alert.threshold)}
                                            </td>
                                            <td>
                                                <span className={`badge ${isHigh ? 'badge-error' : 'badge-warning'}`}>
                                                    {isHigh ? 'CRITICAL' : 'WARNING'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
