# Guild Analytics (Pilot)

Standalone analytics portal for guild progress snapshots. Data is loaded from `public/scans` using
a manifest-driven pipeline, normalized via adapters, and processed in a Web Worker so the UI stays
responsive.

## Quick start

```bash
npm install
npm run dev
```

## Data flow

1. UI loads `public/scans/manifest.json`.
2. Selected dataset is processed in `src/workers/scanWorker.ts`.
3. The worker fetches snapshot files, normalizes them, and computes time-series + metrics.

## Manifest format

`public/scans/manifest.json` contains datasets plus a flat list of snapshots:

```json
{
  "datasets": [
    { "id": "demo", "label": "Demo (Normalized)", "format": "normalized-demo", "scope": "allGuilds" },
    { "id": "custom", "label": "Custom Raw (stub)", "format": "custom-raw", "scope": "allGuilds" }
  ],
  "snapshots": [
    {
      "id": "demo-2025-01-05",
      "label": "Jan 2025",
      "date": "2025-01-05",
      "format": "normalized-demo",
      "path": "scans/demo/2025-01.json",
      "scope": "allGuilds",
      "datasetId": "demo"
    }
  ]
}
```

## Normalized snapshot format

Demo snapshots are already normalized:

```json
{
  "scannedAt": "2025-01-05T08:00:00Z",
  "guilds": [
    {
      "guildKey": "main",
      "guildName": "Solaris",
      "members": [
        {
          "playerKey": "1001",
          "name": "Aria",
          "server": "EU1",
          "playerId": "1001",
          "baseStats": 1200,
          "level": 20,
          "mine": 300,
          "treasury": 180
        }
      ]
    }
  ]
}
```

## Demo vs custom adapter

- Demo data uses `normalized-demo` and is parsed by `src/data/normalization/demoAdapter.ts`.
- Custom raw data should be implemented in `src/data/normalization/customAdapter.ts`.

The Import page will show a warning for the custom dataset until parsing is configured.

## Notes

- Web Worker: `src/workers/scanWorker.ts` handles heavy processing.
- Vite base is `./` for GitHub Pages compatibility.
