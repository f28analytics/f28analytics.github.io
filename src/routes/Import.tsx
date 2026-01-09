import { useData } from '../data/store'
import { formatDate } from '../ui/format'

export default function ImportPage() {
  const {
    manifest,
    datasets,
    snapshots,
    activeDataset,
    status,
    statusMessage,
    error,
    loadSelectedDataset,
  } = useData()

  if (!manifest) {
    return (
      <div className="page">
        <h1 className="page-title">Import & Datasets</h1>
        <div className="card">Loading manifest...</div>
      </div>
    )
  }

  const isCustom = activeDataset?.format === 'custom-raw'

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Import & Datasets</h1>
          <p className="page-subtitle">
            Manifest-driven datasets. Demo data is normalized; custom raw is a stub for future
            parsing.
          </p>
        </div>
        <button className="btn" onClick={loadSelectedDataset} disabled={isCustom}>
          Load Selected Dataset
        </button>
      </div>

      {(isCustom || status === 'custom') && (
        <div className="card warning">
          Custom parsing not configured. Implement parsing in
          <code> src/data/normalization/customAdapter.ts</code> and retry.
        </div>
      )}
      {status === 'error' && error && <div className="card warning">{error}</div>}
      {status === 'loading' && <div className="card">Worker: {statusMessage}</div>}

      <div className="grid two-col">
        <section className="card">
          <h2 className="card-title">Datasets</h2>
          <div className="list">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className={`list-item ${activeDataset?.id === dataset.id ? 'active' : ''}`}
              >
                <div>
                  <div className="list-title">{dataset.label}</div>
                  <div className="list-sub">
                    Format: {dataset.format} · Scope: {dataset.scope}
                  </div>
                  {dataset.notes && <div className="list-sub">{dataset.notes}</div>}
                </div>
                {activeDataset?.id === dataset.id && <span className="badge">Active</span>}
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2 className="card-title">Snapshots</h2>
          {snapshots.length === 0 ? (
            <div className="empty">No snapshots listed for this dataset.</div>
          ) : (
            <div className="list">
              {snapshots.map((snapshot) => (
                <div key={snapshot.id} className="list-item">
                  <div>
                    <div className="list-title">{snapshot.label}</div>
                    <div className="list-sub">
                      {formatDate(snapshot.date)} · {snapshot.format}
                    </div>
                    <div className="list-sub">{snapshot.path}</div>
                  </div>
                  {snapshot.notes && <span className="badge subtle">{snapshot.notes}</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
