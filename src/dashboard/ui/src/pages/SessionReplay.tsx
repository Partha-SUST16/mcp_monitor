import { useState, useEffect } from 'react';

interface Session {
    id: string;
    serverName: string;
    startedAt: string;
    endedAt?: string;
    callCount: number;
}

interface ToolCall {
    id: number;
    toolName: string;
    method: string;
    status: string;
    latencyMs: number;
    timestamp: string;
    arguments: any;
    response: any;
    errorMsg?: string;
}

function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString();
}

export default function SessionReplay() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [calls, setCalls] = useState<ToolCall[]>([]);
    const [sessionInfo, setSessionInfo] = useState<Session | null>(null);
    const [expandedCall, setExpandedCall] = useState<number | null>(null);

    useEffect(() => {
        fetch('/api/sessions?limit=50')
            .then(r => r.json())
            .then(d => setSessions(d.sessions))
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (!selected) return;
        fetch(`/api/sessions/${selected}/calls`)
            .then(r => r.json())
            .then(d => {
                setSessionInfo(d.session);
                setCalls(d.calls);
            })
            .catch(() => { });
    }, [selected]);

    const maxLatency = Math.max(...calls.map(c => c.latencyMs), 1);

    return (
        <div>
            <div className="page-header">
                <h2>Session Replay</h2>
                <p>Browse and replay agent sessions</p>
            </div>

            <div className="session-layout">
                <div className="card">
                    <div className="card-header"><h3>Sessions</h3></div>
                    <div className="card-body" style={{ padding: '8px' }}>
                        <div className="session-list">
                            {sessions.length === 0 && (
                                <div className="empty-state"><p>No sessions recorded yet.</p></div>
                            )}
                            {sessions.map(s => (
                                <div
                                    key={s.id}
                                    className={`session-item ${selected === s.id ? 'active' : ''}`}
                                    onClick={() => setSelected(s.id)}
                                >
                                    <div className="session-item-name">{s.serverName}</div>
                                    <div className="session-item-meta">
                                        {s.callCount} calls · {formatTime(s.startedAt)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="card">
                    {!selected ? (
                        <div className="empty-state" style={{ padding: '80px 20px' }}>
                            <p>Select a session to view its tool calls</p>
                        </div>
                    ) : (
                        <>
                            {sessionInfo && (
                                <div className="card-header">
                                    <h3>{sessionInfo.serverName} — {formatTime(sessionInfo.startedAt)}</h3>
                                    <span className="badge badge-accent">{calls.length} calls</span>
                                </div>
                            )}

                            {calls.length > 0 && (
                                <div className="gantt-chart">
                                    {calls.slice(0, 20).map((call) => (
                                        <div key={call.id} className="gantt-bar" style={{ background: 'var(--bg-input)' }}>
                                            <div
                                                className="gantt-bar-fill"
                                                style={{
                                                    width: `${Math.max((call.latencyMs / maxLatency) * 100, 2)}%`,
                                                    background: call.status === 'error'
                                                        ? 'var(--error)'
                                                        : 'var(--gradient-1)',
                                                }}
                                            />
                                            <span className="gantt-bar-label">{call.toolName}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="card-body">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Time</th>
                                            <th>Tool</th>
                                            <th>Status</th>
                                            <th>Latency</th>
                                            <th style={{ width: '30%' }}>Duration</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {calls.map(call => (
                                            <>
                                                <tr
                                                    key={call.id}
                                                    onClick={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <td className="mono" style={{ fontSize: '12px' }}>{formatTime(call.timestamp)}</td>
                                                    <td className="mono" style={{ color: 'var(--text-primary)' }}>{call.toolName}</td>
                                                    <td>
                                                        <span className={`badge ${call.status === 'success' ? 'badge-success' : 'badge-error'}`}>
                                                            {call.status}
                                                        </span>
                                                    </td>
                                                    <td className="mono">{call.latencyMs}ms</td>
                                                    <td>
                                                        <div className="latency-bar">
                                                            <div
                                                                className="latency-bar-fill"
                                                                style={{ width: `${(call.latencyMs / maxLatency) * 100}%` }}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                                {expandedCall === call.id && (
                                                    <tr key={`${call.id}-detail`}>
                                                        <td colSpan={5} style={{ padding: 0 }}>
                                                            <div className="call-detail">
                                                                {call.response?.truncated && (
                                                                    <div className="truncated-warning">
                                                                        ⚠ Response was truncated (original: {(call.response.sizeBytes / 1024).toFixed(1)}KB)
                                                                    </div>
                                                                )}
                                                                <div className="call-detail-grid">
                                                                    <div className="call-detail-section">
                                                                        <h4>Arguments</h4>
                                                                        <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                                                                    </div>
                                                                    <div className="call-detail-section">
                                                                        <h4>Response</h4>
                                                                        <pre>{JSON.stringify(call.response?.data ?? call.response, null, 2)}</pre>
                                                                    </div>
                                                                </div>
                                                                {call.errorMsg && (
                                                                    <div className="mt-2">
                                                                        <h4 style={{ color: 'var(--error)', fontSize: '11px', marginBottom: '4px' }}>Error</h4>
                                                                        <pre style={{ borderColor: 'var(--error)' }}>{call.errorMsg}</pre>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
