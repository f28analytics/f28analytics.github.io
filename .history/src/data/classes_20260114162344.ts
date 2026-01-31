export type GameClassKey =
  | 'warrior'
  | 'mage'
  | 'scout'
  | 'assassin'
  | 'battle-mage'
  | 'berserker'
  | 'demon-hunter'
  | 'bard'
  | 'druid'
  | 'necromancer'
  | 'paladin'

export type ClassMeta = {
  id: number
  key: GameClassKey
  label: string
  iconUrl: string
}

const DRIVE: Record<GameClassKey, string> = {
  assassin: '1NMQRDwxhfL1cxL679JKuvIjmeF50jJOu',
  bard: '1mQR0It-3zhxBn8-he695_VvN61JGOoY4',
  'battle-mage': '1BDs3RzQGwXCMY588g6dL32DgvQes2Q0Z',
  berserker: '1MADOyse6jZUVkbBBrkTweQILVUhrBdY6',
  'demon-hunter': '1FLzwU5xvm4D_FLNzr9MXEkeTdYM9Oa2k',
  druid: '1ECvaeY_UzbF9wYH0QbHsCNcYA1Pa9eiq',
  mage: '1sZ1ifX3V2V6KBZubOcCgkkhqW7oWpijS',
  necromancer: '1mZKuTZKPEJTuwWhbhVsmFfs6vfnv2Wi9',
  paladin: '1dx7zcadr6xFLNudjojKVerP19Vt6_lbB',
  scout: '12eL2NkyvJg2CL8GUbA8whKOA7TLBoa6x',
  warrior: '13Q4lC2CqjYjWjIhbGU8kunApX1I3_TDt',
}

const driveViewUrl = (id: string) => `https://drive.google.com/uc?export=view&id=${id}`

const getDriveId = (input?: unknown): string | null => {
  if (input == null) return null
  const value = typeof input === 'string' ? input : String(input)
  if (!value.trim()) return null
  if (/^[a-zA-Z0-9_-]{20,}$/.test(value)) return value
  const fileMatch = value.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/)
  if (fileMatch?.[1]) return fileMatch[1]
  const idMatch = value.match(/[?&]id=([a-zA-Z0-9_-]{20,})/)
  if (idMatch?.[1]) return idMatch[1]
  const ucMatch = value.match(/\/uc\?[^#]*\bid=([a-zA-Z0-9_-]{20,})/)
  if (ucMatch?.[1]) return ucMatch[1]
  return null
}

const toDriveThumb = (urlOrId?: unknown, size = 64): string | undefined => {
  if (urlOrId == null) return undefined
  const id = getDriveId(urlOrId)
  if (!id) return typeof urlOrId === 'string' ? urlOrId : undefined
  const w = Math.max(32, Math.round(size))
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`
}

const viaImgProxy = (url: string, size = 64) => {
  const params = new URLSearchParams()
  params.set('url', url)
  params.set('w', String(Math.max(1, Math.floor(size))))
  params.set('h', String(Math.max(1, Math.floor(size))))
  params.set('fit', 'contain')
  return `https://images.weserv.nl/?${params.toString()}`
}

const toDriveThumbProxy = (urlOrId?: unknown, size = 64): string | undefined => {
  const thumb = toDriveThumb(urlOrId, size)
  return thumb ? viaImgProxy(thumb, size) : undefined
}

export const CLASSES: ClassMeta[] = [
  { id: 1, key: 'warrior', label: 'Warrior', iconUrl: driveViewUrl(DRIVE.warrior) },
  { id: 2, key: 'mage', label: 'Mage', iconUrl: driveViewUrl(DRIVE.mage) },
  { id: 3, key: 'scout', label: 'Scout', iconUrl: driveViewUrl(DRIVE.scout) },
  { id: 4, key: 'assassin', label: 'Assassin', iconUrl: driveViewUrl(DRIVE.assassin) },
  { id: 5, key: 'battle-mage', label: 'Battle Mage', iconUrl: driveViewUrl(DRIVE['battle-mage']) },
  { id: 6, key: 'berserker', label: 'Berserker', iconUrl: driveViewUrl(DRIVE.berserker) },
  { id: 7, key: 'demon-hunter', label: 'Demon Hunter', iconUrl: driveViewUrl(DRIVE['demon-hunter']) },
  { id: 8, key: 'bard', label: 'Bard', iconUrl: driveViewUrl(DRIVE.bard) },
  { id: 9, key: 'druid', label: 'Druid', iconUrl: driveViewUrl(DRIVE.druid) },
  { id: 10, key: 'necromancer', label: 'Necromancer', iconUrl: driveViewUrl(DRIVE.necromancer) },
  { id: 11, key: 'paladin', label: 'Paladin', iconUrl: driveViewUrl(DRIVE.paladin) },
]

export const CLASS_BY_ID = Object.fromEntries(
  CLASSES.map((meta) => [meta.id, meta]),
) as Record<number, ClassMeta>

export const getClassMeta = (classId?: number | null): ClassMeta | null => {
  if (typeof classId !== 'number' || !Number.isFinite(classId)) {
    return null
  }
  const normalized = Math.trunc(classId)
  return CLASS_BY_ID[normalized] ?? null
}

export const getClassIconUrl = (classId?: number | null): string | undefined => {
  const meta = getClassMeta(classId)
  if (!meta?.iconUrl) return undefined
  return toDriveThumbProxy(meta.iconUrl, 64)
}

export const getClassLabel = (classId?: number | null): string | undefined =>
  getClassMeta(classId)?.label
