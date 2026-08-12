import { encodeProperties } from '@/lib/inscriber/cbor'
import type { InscriptionProperties } from '@/lib/inscriber/types'

export interface MetadataField {
  key: string
  value: string
}

export interface TraitFieldsResult {
  traits: Record<string, string>
  fields: MetadataField[]
  errors: string[]
}

export const TRAIT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
export const RESERVED_TRAIT_KEYS = new Set(['title', 'xcp'])
export const MAX_TRAIT_FIELDS = 20
export const MAX_TRAIT_VALUE_LENGTH = 200
export const MAX_TITLE_LENGTH = 120
export const MAX_COUNTERPARTY_COMPAT_PROPERTIES_BYTES = 520

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/

export function normalizeTraitKey(key: string): string {
  return key.trim().toLowerCase()
}

export function buildTraitFields(fields: MetadataField[]): TraitFieldsResult {
  const errors: string[] = []
  const traits: Record<string, string> = {}
  const normalizedFields: MetadataField[] = []
  const seen = new Set<string>()

  for (const field of fields) {
    const key = normalizeTraitKey(field.key)
    const value = field.value.trim()

    if (!key && !value) continue
    if (!key) {
      errors.push('Metadata fields with a value need a key.')
      continue
    }
    if (!value) continue

    const label = `Metadata key "${key}"`
    if (!TRAIT_KEY_PATTERN.test(key)) errors.push(`${label} must use lowercase snake_case, start with a letter, and be 40 characters or less.`)
    if (RESERVED_TRAIT_KEYS.has(key)) errors.push(`${label} is reserved.`)
    if (seen.has(key)) errors.push(`${label} is duplicated.`)
    if (CONTROL_CHAR_PATTERN.test(value)) errors.push(`${label} has unsupported control characters.`)
    if (value.length > MAX_TRAIT_VALUE_LENGTH) errors.push(`${label} value must be ${MAX_TRAIT_VALUE_LENGTH} characters or less.`)

    seen.add(key)
    traits[key] = value
    normalizedFields.push({ key, value })
  }

  if (normalizedFields.length > MAX_TRAIT_FIELDS) {
    errors.push(`Use ${MAX_TRAIT_FIELDS} metadata fields or fewer.`)
  }

  return { traits, fields: normalizedFields, errors }
}

export function validateInscriptionProperties(properties: InscriptionProperties): string[] {
  const errors: string[] = []

  if (properties.title !== undefined) {
    const title = properties.title.trim()
    if (!title) errors.push('Title is required.')
    if (title.length > MAX_TITLE_LENGTH) errors.push(`Title must be ${MAX_TITLE_LENGTH} characters or less.`)
    if (CONTROL_CHAR_PATTERN.test(title)) errors.push('Title has unsupported control characters.')
  }

  const fields = Object.entries(properties.traits || {}).map(([key, value]) => ({
    key,
    value: value === null ? '' : String(value),
  }))
  errors.push(...buildTraitFields(fields).errors)

  const encoded = encodeProperties(properties)
  if (encoded.length > MAX_COUNTERPARTY_COMPAT_PROPERTIES_BYTES) {
    errors.push(`Properties are ${encoded.length} bytes; keep them under ${MAX_COUNTERPARTY_COMPAT_PROPERTIES_BYTES} bytes for Counterparty parser compatibility.`)
  }

  return errors
}
