import { useState, useEffect } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

interface NodeUsage {
    serverName: string;
    toolName: string;
    callCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
    costUsd: number;
}

interface AgentUsage {
    agentType: string;
    callCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
}

interface SessionCost {
    sessionId: string;
    serverName: string;
    startedAt: string;
    label?: string;
    callCount: number;
    totalTokens: number;
    costUsd: number;
}

interface TokenUsage {
    byNode: NodeUsage[];
    byAgentType: AgentUsage[];
    timeseries: { bucket: string; inputTokens: number; outputTokens: number }[];
}

interface CostBreakdown {
    byNode: NodeUsage[];
    bySession: SessionCost[];
    timeseries: { bucket: string; costUsd: number }[];
    totalUsd: number;
    totalTokens: number;
}

const TIME_RANGES = ['1h', '6h', '24h', '7d'] as const;

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8b92a8', font: { size: 11 } } } },
    scales: {
        x: { stacked: true, ticks: { color: '#5f6680', font: { size: 10 } }, grid: { color: 'rgba(42,49,84,0.4)' } },
        y: { stacked: true, ticks: { color: '#5f6680', font: { size: 10 } }, grid: { color: 'rgba(42,49,84,0.4)' } },
    },
};

const lineOptions = {
    ...chartOptions,
    scales: {
        x: { ticks: { color: '#5f6680', font: { size: 10 } }, grid: { color: 'rgba(42,49,84,0.4)' } },
        y: { ticks: { color: '#5f6680', font: { size: 10 } }, grid: { color: 'rgba(42,49,84,0.4)' } },
    },
};

const fmtTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const nodeLabel = (n: NodeUsage) => `${n.serverName}/${n.toolName}`;

export default function TokenCost() {
    const [timeRange, setTimeRange] = useState<string>('24h');
    const [groupBy, setGroupBy] = useState<'node' | 'agent'>('node');
    const [usage, setUsage] = useState<TokenUsage | null>(null);
    const [cost, setCost] = useState<CostBreakdown | null>(null);

    useEffect(() => {
        fetch(`/api/tokens/usage?since=${timeRange}`).then(r => r.json()).then(setUsage).catch(() => { });
        fetch(`/api/cost/breakdown?since=${timeRange}`).then(r => r.json()).then(setCost).catch(() => { });
    }, [timeRange]);

    const nodes = usage?.byNode ?? [];
    const topNode = cost?.byNode?.[0];

    // Stacked input vs output tokens per node (or per agent type).
    const tokenBars = (() => {
        if (groupBy === 'agent') {
            const rows = usage?.byAgentType ?? [];
            return {
                labels: rows.map(r => r.agentType),
                datasets: [
                    { label: 'Input', data: rows.map(r => r.inputTokens), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 4 },
                    { label: 'Output', data: rows.map(r => r.outputTokens), backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4 },
                ],
            };
        }
        const rows = nodes.slice(0, 12);
        return {
            labels: rows.map(nodeLabel),
            datasets: [
                { label: 'Input', data: rows.map(r => r.inputTokens), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 4 },
                { label: 'Output', data: rows.map(r => r.outputTokens), backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4 },
            ],
        };
    })();

    const costBars = {
        labels: (cost?.byNode ?? []).slice(0, 12).map(nodeLabel),
        datasets: [{
            label: 'Cost (USD)',
            data: (cost?.byNode ?? []).slice(0, 12).map(n => n.costUsd),
            backgroundColor: 'rgba(245,158,11,0.7)',
            borderRadius: 4,
        }],
    };

    const costLine = {
        labels: (cost?.timeseries ?? []).map(t => new Date(t.bucket).toLocaleTimeString()),
        datasets: [{
            label: 'Cost (USD)',
            data: (cost?.timeseries ?? []).map(t => t.costUsd),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.1)',
            fill: true,
            tension: 0.3,
        }],
    };

    const hasData = nodes.length > 0;

    return (
        <div>
            <div className="page-header">
                <h2>Tokens &amp; Cost</h2>
                <p>Estimated token usage and spend per agent node. Tokens are estimated from payload size (≈4 chars/token); cost uses your configured pricing.</p>
            </div>

            <div className="controls-bar">
                <div className="btn-group">
                    <button className={`btn ${groupBy === 'node' ? 'active' : ''}`} onClick={() => setGroupBy('node')}>By node</button>
                    <button className={`btn ${groupBy === 'agent' ? 'active' : ''}`} onClick={() => setGroupBy('agent')}>By agent type</button>
                </div>
                <div className="btn-group">
                    {TIME_RANGES.map(r => (
                        <button key={r} className={`btn ${timeRange === r ? 'active' : ''}`} onClick={() => setTimeRange(r)}>{r}</button>
                    ))}
                </div>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">Total Tokens (est.)</div>
                    <div className="stat-value accent">{fmtTokens(cost?.totalTokens ?? 0)}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Total Cost (est.)</div>
                    <div className="stat-value">{fmtUsd(cost?.totalUsd ?? 0)}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Active Nodes</div>
                    <div className="stat-value">{nodes.length}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Top Node by Cost</div>
                    <div className="stat-value" style={{ fontSize: '14px' }}>
                        {topNode ? `${nodeLabel(topNode)} — ${fmtUsd(topNode.costUsd)}` : '—'}
                    </div>
                </div>
            </div>

            {hasData ? (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        <div className="card">
                            <div className="card-header"><h3>Token Usage — input vs output</h3></div>
                            <div className="chart-container"><Bar data={tokenBars} options={chartOptions} /></div>
                        </div>
                        <div className="card">
                            <div className="card-header"><h3>Cost per Node</h3></div>
                            <div className="chart-container"><Bar data={costBars} options={lineOptions} /></div>
                        </div>
                    </div>

                    <div className="card" style={{ marginBottom: '16px' }}>
                        <div className="card-header"><h3>Cost Over Time</h3></div>
                        <div className="chart-container"><Line data={costLine} options={lineOptions} /></div>
                    </div>

                    <div className="card">
                        <div className="card-header"><h3>Most Expensive Sessions</h3></div>
                        <div className="card-body">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Session</th><th>Server</th><th>Calls</th><th>Tokens</th><th>Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(cost?.bySession ?? []).slice(0, 15).map(s => (
                                        <tr key={s.sessionId}>
                                            <td className="mono" style={{ fontSize: '11px' }}>
                                                <a href={`/sessions?id=${s.sessionId}`}>{s.sessionId.slice(0, 8)}…</a>
                                            </td>
                                            <td>{s.serverName}</td>
                                            <td className="mono">{s.callCount}</td>
                                            <td className="mono">{fmtTokens(s.totalTokens)}</td>
                                            <td className="mono">{fmtUsd(s.costUsd)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            ) : (
                <div className="card">
                    <div className="empty-state"><p>No token data yet. Start monitoring to see usage and cost.</p></div>
                </div>
            )}
        </div>
    );
}
