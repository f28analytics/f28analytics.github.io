import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DataProvider } from './data/store'
import AppShell from './app/AppShell'
import Dashboard from './routes/Dashboard'
import ExportPage from './routes/Export'
import Explorer from './routes/Explorer'
import Guilds from './routes/Guilds'
import Memberlist from './routes/Memberlist'
import ImportPage from './routes/Import'
import Months from './routes/Months'
import PlayerDetail from './routes/PlayerDetail'
import Ranking from './routes/Ranking'
import Toplists from './routes/Toplists'

export function App() {
  return (
    <HashRouter>
      <DataProvider>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="memberlist" element={<Memberlist />} />
            <Route path="guilds" element={<Guilds />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="ranking" element={<Ranking />} />
            <Route path="months" element={<Months />} />
            <Route path="toplists" element={<Toplists />} />
            <Route path="explorer" element={<Explorer />} />
            <Route path="player/:playerKey" element={<PlayerDetail />} />
            <Route path="export" element={<ExportPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </DataProvider>
    </HashRouter>
  )
}
