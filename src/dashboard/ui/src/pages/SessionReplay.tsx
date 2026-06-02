import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { lcsDiff, prettyLines, DiffLine } from '../lib/diff';

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
    errorClass?: string | null;
    errorCode?: number | null;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
}

// Render a unified or split line diff between two values (zero-dep, see lib/diff).
function DiffBlock({ title, a, b }: { title: string; a: unknown; b: unknown }) {
    const [split, setSplit] = useState(true);
    const diff = useMemo(() => lcsDiff(prettyLines(a), prettyLines(b)), [a, b]);
    const changed = diff.some(d => d.type !== 'eq');

    return (
        <div className="call-detail-section">
            <div className="flex items-center justify-between">
                <h4>{title} {changed ? '' : <span style={{ color: 'var(--text-muted)' }}>(identical)</span>}</h4>
                <button className="btn" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={() => setSplit(s => !s)}>
                    {split ? 'Unified' : 'Split'}
                </button>
            </div>
            {split ? <SplitDiff diff={diff} /> : <UnifiedDiff diff={diff} />}
        </div>
    );
}

function UnifiedDiff({ diff }: { diff: DiffLine[] }) {
    return (
        <pre className="diff-pre">
            {diff.map((d, i) => (
                <div key={i} className={`diff-line diff-${d.type}`}>
                    <span className="diff-gutter">{d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' '}</span>
                    {d.line}
                </div>
            ))}
        </pre>
    );
}

function SplitDiff({ diff }: { diff: DiffLine[] }) {
    return (
        <div className="diff-cols">
            <pre className="diff-pre">
                {diff.filter(d => d.type !== 'add').map((d, i) => (
                    <div key={i} className={`diff-line ${d.type === 'del' ? 'diff-del' : 'diff-eq'}`}>{d.line}</div>
                ))}
            </pre>
            <pre className="diff-pre">
                {diff.filter(d => d.type !== 'del').map((d, i) => (
                    <div key={i} className={`diff-line ${d.type === 'add' ? 'diff-add' : 'diff-eq'}`}>{d.line}</div>
                ))}
            </pre>
        </div>
    );
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
    const [compareIds, setCompareIds] = useState<number[]>([]);

    const expandedRowRef = useRef<HTMLTableRowElement>(null);

    // Toggle a call into/out of the (max two) comparison slots.
    const toggleCompare = (id: number) => {
        setCompareIds(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            if (prev.length >= 2) return [prev[1], id]; // keep most-recent two
            return [...prev, id];
        });
    };

    // "Diff vs previous call of the same tool": find the closest earlier call
    // (by timestamp) with the same toolName and load both into the diff.
    const diffVsPrevious = (call: ToolCall) => {
        const earlier = calls
            .filter(c => c.toolName === call.toolName && new Date(c.timestamp) < new Date(call.timestamp))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
        if (earlier) setCompareIds([earlier.id, call.id]);
    };

    const compareCalls = compareIds
        .map(id => calls.find(c => c.id === id))
        .filter((c): c is ToolCall => !!c)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

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
                setCompareIds([]);

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

    useEffect(() => {
        if (expandedCall && expandedRowRef.current) {
            expandedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [expandedCall]);

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

                            {compareCalls.length === 2 && (
                                <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
                                    <div className="flex items-center justify-between mb-2">
                                        <h4>
                                            Diff: <span className="mono">{formatTime(compareCalls[0].timestamp)}</span>
                                            {' → '}
                                            <span className="mono">{formatTime(compareCalls[1].timestamp)}</span>
                                            {compareCalls[0].toolName !== compareCalls[1].toolName && (
                                                <span style={{ color: 'var(--warning)' }}> ⚠ different tools</span>
                                            )}
                                        </h4>
                                        <button className="btn" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => setCompareIds([])}>
                                            ✕ Close diff
                                        </button>
                                    </div>
                                    <div className="call-detail-grid">
                                        <DiffBlock title="Arguments" a={compareCalls[0].arguments} b={compareCalls[1].arguments} />
                                        <DiffBlock
                                            title="Response"
                                            a={compareCalls[0].response?.data ?? compareCalls[0].response}
                                            b={compareCalls[1].response?.data ?? compareCalls[1].response}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="card-body">
                                <table>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '4%' }} title="Select two calls to diff">⇄</th>
                                            <th onClick={() => toggleSort('timestamp')} style={{ cursor: 'pointer', width: '11%' }}>
                                                Time{sortIcon('timestamp')}
                                            </th>
                                            <th onClick={() => toggleSort('toolName')} style={{ cursor: 'pointer', width: '24%' }}>
                                                Tool{sortIcon('toolName')}
                                            </th>
                                            <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer', width: '12%' }}>
                                                Status{sortIcon('status')}
                                            </th>
                                            <th onClick={() => toggleSort('latencyMs')} style={{ cursor: 'pointer', width: '12%' }}>
                                                Latency{sortIcon('latencyMs')}
                                            </th>
                                            <th style={{ width: '12%' }}>Cost</th>
                                            <th style={{ width: '25%' }}>Duration</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedCalls.map(call => (
                                            <React.Fragment key={call.id}>
                                                <tr
                                                    onClick={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
                                                    style={{ cursor: 'pointer' }}
                                                    className={compareIds.includes(call.id) ? 'row-selected' : ''}
                                                >
                                                    <td onClick={e => { e.stopPropagation(); toggleCompare(call.id); }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={compareIds.includes(call.id)}
                                                            readOnly
                                                            title="Select for diff (pick two)"
                                                        />
                                                    </td>
                                                    <td className="mono" style={{ fontSize: '12px' }}>{formatTime(call.timestamp)}</td>
                                                    <td className="mono" style={{ color: 'var(--text-primary)' }}>{call.toolName}</td>
                                                    <td>
                                                        <span className={`badge ${call.status === 'success' ? 'badge-success' : 'badge-error'}`}>
                                                            {call.status}
                                                        </span>
                                                        {call.errorClass && (
                                                            <span className={`badge badge-class-${call.errorClass}`} style={{ marginLeft: '4px' }}>
                                                                {call.errorClass.replace('_', ' ')}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="mono">{call.latencyMs}ms</td>
                                                    <td className="mono" title={`${(call.inputTokens ?? 0) + (call.outputTokens ?? 0)} est. tokens`}>
                                                        ${(call.costUsd ?? 0).toFixed(4)}
                                                    </td>
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
                                                    <tr ref={expandedRowRef}>
                                                        <td colSpan={7} style={{ padding: 0 }}>
                                                            <div className="call-detail">
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <div className="flex items-center gap-2" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                                        <span>~{call.inputTokens ?? 0} in / {call.outputTokens ?? 0} out tokens (est.)</span>
                                                                        <span>·</span>
                                                                        <span>${(call.costUsd ?? 0).toFixed(6)}</span>
                                                                    </div>
                                                                    <button
                                                                        className="btn"
                                                                        style={{ padding: '4px 10px', fontSize: '11px' }}
                                                                        onClick={() => diffVsPrevious(call)}
                                                                    >
                                                                        ⇄ Diff vs previous {call.toolName}
                                                                    </button>
                                                                </div>
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
                                                                        <h4 style={{ color: 'var(--error)', fontSize: '11px', marginBottom: '4px' }}>
                                                                            Error{call.errorClass ? ` — ${call.errorClass.replace('_', ' ')}` : ''}
                                                                            {call.errorCode != null ? ` (code ${call.errorCode})` : ''}
                                                                        </h4>
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
