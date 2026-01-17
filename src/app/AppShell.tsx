import { NavLink, Outlet } from 'react-router-dom'
import { useData } from '../data/store'
import './AppShell.css'

export default function AppShell() {
  const {
    datasets,
    selectedDatasetId,
    selectDataset,
    status,
    statusMessage,
    activeDataset,
  } = useData()

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">Guild Analytics</div>
          <div className="brand-subtitle">Pilot Guild Progress Portal</div>
        </div>
        <div className="topbar-controls">
          <label className="control">
            <span className="control-label">Dataset</span>
            <select
              className="select"
              value={selectedDatasetId ?? ''}
              onChange={(event) => selectDataset(event.target.value)}
            >
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.label}
                </option>
              ))}
            </select>
          </label>
          <div className={`status-badge status-${status}`}>
            {status === 'loading' && (statusMessage || 'Loading')}
            {status === 'ready' && `Ready - ${activeDataset?.label ?? ''}`}
            {status === 'custom' && 'Custom parsing not configured'}
            {status === 'error' && 'Dataset error'}
            {status === 'idle' && 'Idle'}
          </div>
        </div>
      </header>
      <aside className="sidebar">
        <div className="nav-group">
          <div className="nav-group-title">Fusion planner</div>
          <NavLink className="nav-link" to="/import">
            Import
          </NavLink>
          <NavLink className="nav-link" to="/memberlist">
            Memberlist
          </NavLink>
          <NavLink className="nav-link" to="/" end>
            Dashboard
          </NavLink>
          <NavLink className="nav-link" to="/ranking">
            Scouting
          </NavLink>
          <NavLink className="nav-link" to="/months">
            Months
          </NavLink>
        </div>
        <div className="nav-group">
          <div className="nav-group-title">Guild analytics</div>
          <NavLink className="nav-link" to="/guilds">
            Guilds
          </NavLink>
        </div>
        <NavLink className="nav-link" to="/toplists">
          Toplists
        </NavLink>
        <NavLink className="nav-link" to="/explorer">
          Explorer
        </NavLink>
        <NavLink className="nav-link" to="/export">
          Export
        </NavLink>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
