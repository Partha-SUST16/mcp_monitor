import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import LiveFeed from './pages/LiveFeed';
import SessionReplay from './pages/SessionReplay';
import ToolAnalytics from './pages/ToolAnalytics';
import ServerHealth from './pages/ServerHealth';
import Alerts from './pages/Alerts';

export default function App() {
    return (
        <BrowserRouter>
            <div className="app-layout">
                <aside className="sidebar">
                    <div className="sidebar-logo">
                        <h1>MCP Monitor</h1>
                        <span>Observability</span>
                    </div>
                    <nav className="sidebar-nav">
                        <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <span className="nav-icon">⚡</span> Live Feed
                        </NavLink>
                        <NavLink to="/sessions" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <span className="nav-icon">📋</span> Sessions
                        </NavLink>
                        <NavLink to="/tools" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <span className="nav-icon">📊</span> Tool Analytics
                        </NavLink>
                        <NavLink to="/servers" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <span className="nav-icon">🖥️</span> Server Health
                        </NavLink>
                        <NavLink to="/alerts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <span className="nav-icon">🔔</span> Alerts
                        </NavLink>
                    </nav>
                </aside>
                <main className="main-content">
                    <Routes>
                        <Route path="/" element={<LiveFeed />} />
                        <Route path="/sessions" element={<SessionReplay />} />
                        <Route path="/tools" element={<ToolAnalytics />} />
                        <Route path="/servers" element={<ServerHealth />} />
                        <Route path="/alerts" element={<Alerts />} />
                    </Routes>
                </main>
            </div>
        </BrowserRouter>
    );
}
