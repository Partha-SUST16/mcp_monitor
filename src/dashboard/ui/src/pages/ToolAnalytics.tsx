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

interface ToolStat {
    toolName: string;
    serverName: string;
    callCount: number;
    errorRatePct: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    timeseriesLatency: { bucket: string; p50: number; p95: number }[];
    timeseriesErrors: { bucket: string; errorRatePct: number }[];
}

const TIME_RANGES = ['1h', '6h', '24h', '7d'] as const;

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { labels: { color: '#8b92a8', font: { size: 11 } } },
    },
    scales: {
        x: { ticks: { color: '#5f6680', font: { size: 10 } }, grid: { color: 'rgba(42,49,84,0.4)' } },
        y: { ticks: { color: '#5f6680', font: { size: 10 } }, grid: { color: 'rgba(42,49,84,0.4)' } },
    },
};

export default function ToolAnalytics() {
    const [tools, setTools] = useState<ToolStat[]>([]);
    const [selectedTool, setSelectedTool] = useState<string>('');
    const [timeRange, setTimeRange] = useState<string>('24h');

    useEffect(() => {
        fetch(`/api/tools/stats?since=${timeRange}`)
            .then(r => r.json())
            .then(d => {
                setTools(d.tools);
                if (!selectedTool && d.tools.length > 0) {
                    setSelectedTool(d.tools[0].toolName);
                }
            })
            .catch(() => { });
    }, [timeRange]);

    const tool = tools.find(t => t.toolName === selectedTool);

    const latencyData = tool ? {
        labels: tool.timeseriesLatency.map(t => new Date(t.bucket).toLocaleTimeString()),
        datasets: [
            {
                label: 'P50',
                data: tool.timeseriesLatency.map(t => t.p50),
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99,102,241,0.1)',
                fill: true,
                tension: 0.3,
            },
            {
                label: 'P95',
                data: tool.timeseriesLatency.map(t => t.p95),
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245,158,11,0.1)',
                fill: true,
                tension: 0.3,
            },
        ],
    } : null;

    const volumeData = tool ? {
        labels: tool.timeseriesLatency.map(t => new Date(t.bucket).toLocaleTimeString()),
        datasets: [{
            label: 'Calls',
            data: tool.timeseriesLatency.map(() => 1),
            backgroundColor: 'rgba(99,102,241,0.6)',
            borderRadius: 4,
        }],
    } : null;

    const errorData = tool ? {
        labels: tool.timeseriesErrors.map(t => new Date(t.bucket).toLocaleTimeString()),
        datasets: [{
            label: 'Error Rate %',
            data: tool.timeseriesErrors.map(t => t.errorRatePct),
            borderColor: '#f87171',
            backgroundColor: 'rgba(248,113,113,0.1)',
            fill: true,
            tension: 0.3,
        }],
    } : null;

    return (
        <div>
            <div className="page-header">
                <h2>Tool Analytics</h2>
                <p>Latency percentiles and error rates per tool</p>
            </div>

            <div className="controls-bar">
                <select
                    className="select"
                    value={selectedTool}
                    onChange={e => setSelectedTool(e.target.value)}
                >
                    {tools.map(t => (
                        <option key={t.toolName} value={t.toolName}>
                            {t.toolName} ({t.serverName})
                        </option>
                    ))}
                </select>

                <div className="btn-group">
                    {TIME_RANGES.map(r => (
                        <button
                            key={r}
                            className={`btn ${timeRange === r ? 'active' : ''}`}
                            onClick={() => setTimeRange(r)}
                        >
                            {r}
                        </button>
                    ))}
                </div>
            </div>

            {tool && (
                <>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <div className="stat-label">Total Calls</div>
                            <div className="stat-value accent">{tool.callCount.toLocaleString()}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">P50 Latency</div>
                            <div className="stat-value">{tool.p50LatencyMs}ms</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">P95 Latency</div>
                            <div className={`stat-value ${tool.p95LatencyMs > 2000 ? 'warning' : ''}`}>{tool.p95LatencyMs}ms</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">P99 Latency</div>
                            <div className={`stat-value ${tool.p99LatencyMs > 2000 ? 'error' : ''}`}>{tool.p99LatencyMs}ms</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Error Rate</div>
                            <div className={`stat-value ${tool.errorRatePct > 5 ? 'error' : 'success'}`}>
                                {tool.errorRatePct.toFixed(1)}%
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        <div className="card">
                            <div className="card-header"><h3>Latency Over Time</h3></div>
                            <div className="chart-container">
                                {latencyData && <Line data={latencyData} options={chartOptions} />}
                            </div>
                        </div>
                        <div className="card">
                            <div className="card-header"><h3>Call Volume</h3></div>
                            <div className="chart-container">
                                {volumeData && <Bar data={volumeData} options={chartOptions} />}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><h3>Error Rate Over Time</h3></div>
                        <div className="chart-container">
                            {errorData && <Line data={errorData} options={chartOptions} />}
                        </div>
                    </div>
                </>
            )}

            {!tool && tools.length === 0 && (
                <div className="card">
                    <div className="empty-state">
                        <p>No tool data available. Start monitoring to see analytics.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
