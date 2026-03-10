import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

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

type SortField = 'timestamp' | 'toolName' | 'status' | 'latencyMs';
type SortDir = 'asc' | 'desc';

function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString();
}

export default function SessionReplay() {
    const [searchParams, setSearchParams] = useSearchParams();
    const selected = searchParams.get('id');

    const [sessions, setSessions] = useState<Session[]>([]);
    const [calls, setCalls] = useState<ToolCall[]>([]);
    const [sessionInfo, setSessionInfo] = useState<Session | null>(null);
    const [expandedCall, setExpandedCall] = useState<number | null>(null);
    const [sortField, setSortField] = useState<SortField>('timestamp');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [ganttVisible, setGanttVisible] = useState(true);

    const handleSelectSession = (id: string) => {
        setSearchParams({ id });
    };

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
                setSortField('timestamp');
                setSortDir('asc');

                // Auto-expand call if callTs is present in URL
                const callTs = searchParams.get('callTs');
                if (callTs) {
                    const callToExpand = d.calls.find((c: ToolCall) => c.timestamp === callTs);
                    if (callToExpand) {
                        setExpandedCall(callToExpand.id);
                    } else {
                        setExpandedCall(null);
                    }
                } else {
                    setExpandedCall(null);
                }
            })
            .catch(() => { });
    }, [selected, searchParams]);

    const sortedCalls = useMemo(() => {
        const sorted = [...calls].sort((a, b) => {
            let cmp = 0;
            switch (sortField) {
                case 'timestamp': cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); break;
                case 'toolName': cmp = a.toolName.localeCompare(b.toolName); break;
                case 'status': cmp = a.status.localeCompare(b.status); break;
                case 'latencyMs': cmp = a.latencyMs - b.latencyMs; break;
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return sorted;
    }, [calls, sortField, sortDir]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir(field === 'latencyMs' ? 'desc' : 'asc');
        }
    };

    const sortIcon = (field: SortField) => {
        if (sortField !== field) return ' ↕';
        return sortDir === 'asc' ? ' ↑' : ' ↓';
    };

    const maxLatency = Math.max(...calls.map(c => c.latencyMs), 1);
    const logNorm = (ms: number) => Math.max((Math.log(ms + 1) / Math.log(maxLatency + 1)) * 100, 3);

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
                                    onClick={() => handleSelectSession(s.id)}
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
                                    <div className="flex items-center gap-2">
                                        <span className="badge badge-accent">{calls.length} calls</span>
                                        {calls.length > 0 && (
                                            <button className="btn" onClick={() => setGanttVisible(v => !v)} style={{ padding: '4px 10px', fontSize: '11px' }}>
                                                {ganttVisible ? '▲ Hide Chart' : '▼ Show Chart'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {calls.length > 0 && ganttVisible && (
                                <div className="gantt-chart">
                                    {calls.slice(0, 20).map((call) => (
                                        <div key={call.id} className="gantt-bar" data-tooltip={`${call.toolName} — ${call.latencyMs}ms`} style={{ background: 'var(--bg-input)' }}>
                                            <div
                                                className="gantt-bar-fill"
                                                style={{
                                                    width: `${logNorm(call.latencyMs)}%`,
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
                                            <th onClick={() => toggleSort('timestamp')} style={{ cursor: 'pointer', width: '12%' }}>
                                                Time{sortIcon('timestamp')}
                                            </th>
                                            <th onClick={() => toggleSort('toolName')} style={{ cursor: 'pointer', width: '28%' }}>
                                                Tool{sortIcon('toolName')}
                                            </th>
                                            <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer', width: '12%' }}>
                                                Status{sortIcon('status')}
                                            </th>
                                            <th onClick={() => toggleSort('latencyMs')} style={{ cursor: 'pointer', width: '13%' }}>
                                                Latency{sortIcon('latencyMs')}
                                            </th>
                                            <th style={{ width: '35%' }}>Duration</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedCalls.map(call => (
                                            <React.Fragment key={call.id}>
                                                <tr
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
                                                    <tr>
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
                                            </React.Fragment>
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
