import type { JsonRecord, RawScanGroup, RawScanPlayer } from './types'

const CONVERT_OTHER_GROUP_FIELDS = [
  'prefix',
  'timestamp',
  'offset',
  'name',
  'rank',
  'names',
  'identifier',
  'group',
  'save',
] as const

const CONVERT_OTHER_PLAYER_FIELDS = [
  'prefix',
  'timestamp',
  'offset',
  'name',
  'identifier',
  'class',
  'groupname',
  'units',
  'fortressrank',
  'group',
  'version',
] as const

const OTHER_PLAYER_SAVE_LENGTH = 261
const CONVERT_PLAYER_SAVE: Array<number | null> = [
  1, 2, 7, 8, 9, 10, 11, null,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29,
  30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  null, null, null, null, null,
  null, null, null,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
  72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95,
  96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117,
  118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139,
  140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161,
  162, 163, 164, 165, 166, 167,
  286, 433, 435,
  null,
  438,
  null, null,
  443,
  444,
  447, 448, 449,
  null, null, null, null, null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null, null, null, null,
  493, 494, 495, null, null, null, 499, 500, 501,
  502,
  517, 521,
  null, null,
  524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535,
  null, null, null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null,
  581, 582,
  null, null, null,
  445,
]

export type OtherPlayer = Record<string, unknown>
export type OtherGroup = Record<string, unknown>

export const toOtherPlayer = (raw: RawScanPlayer): OtherPlayer => {
  const copy: OtherPlayer = { own: 0 }

  CONVERT_OTHER_PLAYER_FIELDS.forEach((field) => {
    if (field in raw) {
      copy[field] = (raw as JsonRecord)[field]
    }
  })

  const rawRecord = raw as JsonRecord
  const sourceSave = Array.isArray(rawRecord.save) ? (rawRecord.save as unknown[]) : []
  const isAlreadyOther = sourceSave.length === OTHER_PLAYER_SAVE_LENGTH

  if (Array.isArray(rawRecord.pets)) {
    const pets = rawRecord.pets as unknown[]
    copy.pets = isAlreadyOther ? [...pets] : [0, ...pets.slice(104, 109)]
  }

  if (isAlreadyOther) {
    copy.save = sourceSave.slice(0, OTHER_PLAYER_SAVE_LENGTH)
  } else {
    copy.save = CONVERT_PLAYER_SAVE.reduce<unknown[]>(
      (memo, sourceIndex, targetIndex) => {
        if (sourceIndex !== null && typeof sourceSave[sourceIndex] !== 'undefined') {
          memo[targetIndex] = sourceSave[sourceIndex]
        } else {
          memo[targetIndex] = 0
        }
        return memo
      },
      Array.from({ length: OTHER_PLAYER_SAVE_LENGTH }).fill(0),
    )
  }

  if (!copy.fortressrank && typeof sourceSave[583] !== 'undefined') {
    copy.fortressrank = sourceSave[583]
  }

  return copy
}

export const toOtherGroup = (raw: RawScanGroup): OtherGroup => {
  const copy: OtherGroup = { own: 0 }

  CONVERT_OTHER_GROUP_FIELDS.forEach((field) => {
    if (field in raw) {
      copy[field] = (raw as JsonRecord)[field]
    }
  })

  return copy
}
