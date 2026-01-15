import type { ScanSource } from './types'

export const scanSources: ScanSource[] = [
  {
    id: 'bot-testscan-2025-12-07',
    label: 'Testscan 2025-12-07 (Bot export)',
    path: 'scans/files_2025_12_07_12_31_02_593.json',
    notes: 'Large sample scan for parser validation.',
  },
  {
    id: 'bot-scan-2026-01-11',
    label: 'Scan 2026-01-11 (Bot export)',
    path: 'scans/files_2026_01_11_09_38_30_132.json',
    notes: 'New scan dataset.',
  },
  {
    id: 'serverscan-2026-01-02-eu-1-2-3-4',
    label: 'Serverscan 2.1.26 (Bot export)',
    path: 'scans/serverscan_eu_1_2_3_4_date_2_1_26.json',
    notes: 'Eu 1-4',
  },
  {
    id: 'serverscan-2025-12-05-eu-1-2-3-4',
    label: 'Serverscan 5.12.25 (Bot export)',
    path: 'scans/serverscan_eu_1_2_3_4_date_5_12_25.json',
    notes: 'Eu 1-4',
  },
]
