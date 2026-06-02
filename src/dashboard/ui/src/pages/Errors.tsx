import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Title, Tooltip, Legend, Filler);

interface RecentError {
    id: number;
    sessionId: string;
    serverName: string;
    toolName: string;
    status: string;
    errorClass: string | null;
    errorCode: number | null;
    errorMsg: string | null;
    timestamp: string;
}

interface ErrorData {
    byClass: { errorClass: string; count: number }[];
    timeseries: { bucket: string; hallucination: number; tool_failure: number; timeout: number }[];
    recentErrors: RecentError[];
}

const TIME_RANGES = ['1h', '6h', '24h', '7d'] as const;

// Each class gets a stable color across the donut, trend, and badges.
const CLASS_COLORS: Record<string, string> = {
    hallucination: '#a855f7',
    tool_failure: '#f87171',
    timeout: '#f59e0b',
    unclassified: '#5f6680',
};

const CLASS_LABEL: Record<string, string> = {
    hallucination: 'Hallucination',
    tool_failure: 'Tool failure',
    timeout: 'Timeout',
    unclassified: 'Unclassified',
};

const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8b92a8', font: { size: 11 } } } },
    scales: {
        x: { ticks: { color: '#5f6680', font: { size: 10 } }, grid: { color: 'rgba(42,49,84,0.4)' } },
        y: { ticks: { color: '#5f6680', font: { size: 10 } }, grid: { color: 'rgba(42,49,84,0.4)' } },
    },
};

const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'right' as const, labels: { color: '#8b92a8', font: { size: 12 } } } },
};

function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString();
}

export default function Errors() {
    const [timeRange, setTimeRange] = useState<string>('24h');
    const [data, setData] = useState<ErrorData | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetch(`/api/errors/classification?since=${timeRange}`).then(r => r.json()).then(setData).catch(() => { });
    }, [timeRange]);

    const byClass = data?.byClass ?? [];
    const total = byClass.reduce((s, c) => s + c.count, 0);

    const donutData = {
        labels: byClass.map(c => CLASS_LABEL[c.errorClass] ?? c.errorClass),
        datasets: [{
            data: byClass.map(c => c.count),
            backgroundColor: byClass.map(c => CLASS_COLORS[c.errorClass] ?? '#5f6680'),
            borderColor: '#0f1117',
            borderWidth: 2,
        }],
    };

    const trendData = {
        labels: (data?.timeseries ?? []).map(t => formatTime(t.bucket)),
        datasets: [
            { label: 'Hallucination', data: (data?.timeseries ?? []).map(t => t.hallucination), borderColor: CLASS_COLORS.hallucination, backgroundColor: 'rgba(168,85,247,0.1)', fill: true, tension: 0.3 },
            { label: 'Tool failure', data: (data?.timeseries ?? []).map(t => t.tool_failure), borderColor: CLASS_COLORS.tool_failure, backgroundColor: 'rgba(248,113,113,0.1)', fill: true, tension: 0.3 },
            { label: 'Timeout', data: (data?.timeseries ?? []).map(t => t.timeout), borderColor: CLASS_COLORS.timeout, backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3 },
        ],
    };

    return (
        <div>
            <div className="page-header">
                <h2>Error Classification</h2>
                <p>Not all failures are equal. Hallucinations (invented tools / bad args) need prompt fixes; tool failures need backend fixes; timeouts need capacity fixes.</p>
            </div>

            <div className="controls-bar">
                <div className="btn-group">
                    {TIME_RANGES.map(r => (
                        <button key={r} className={`btn ${timeRange === r ? 'active' : ''}`} onClick={() => setTimeRange(r)}>{r}</button>
                    ))}
                </div>
            </div>

            {total === 0 ? (
                <div className="card">
                    <div className="empty-state"><p>No errors in this window. 🎉</p></div>
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '16px', marginBottom: '16px' }}>
                        <div className="card">
                            <div className="card-header"><h3>Errors by Class ({total})</h3></div>
                            <div className="chart-container"><Doughnut data={donutData} options={donutOptions} /></div>
                        </div>
                        <div className="card">
                            <div className="card-header"><h3>Error Class Over Time</h3></div>
                            <div className="chart-container"><Line data={trendData} options={lineOptions} /></div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><h3>Recent Errors</h3></div>
                        <div className="card-body">
                            <table>
                                <thead>
                                    <tr>
                                        <th style={{ width: '12%' }}>Time</th>
                                        <th style={{ width: '14%' }}>Class</th>
                                        <th style={{ width: '22%' }}>Tool</th>
                                        <th style={{ width: '8%' }}>Code</th>
                                        <th style={{ width: '44%' }}>Message</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(data?.recentErrors ?? []).map(e => (
                                        <tr
                                            key={e.id}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => navigate(`/sessions?id=${e.sessionId}&callTs=${encodeURIComponent(e.timestamp)}`)}
                                        >
                                            <td className="mono" style={{ fontSize: '12px' }}>{formatTime(e.timestamp)}</td>
                                            <td>
                                                <span className={`badge badge-class-${e.errorClass ?? 'unclassified'}`}>
                                                    {CLASS_LABEL[e.errorClass ?? 'unclassified'] ?? e.errorClass}
                                                </span>
                                            </td>
                                            <td className="mono">{e.serverName}/{e.toolName}</td>
                                            <td className="mono">{e.errorCode ?? '—'}</td>
                                            <td className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                {e.errorMsg ?? e.status}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
