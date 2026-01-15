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
]
