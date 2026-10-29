/**
 * Milestone names are not stored by the contract. They travel in the share link (?m=) and are
 * cached in this browser, so a grant opened without them falls back to "Milestone N".
 */
const SEPARATOR = '|'
export const MAX_NAME_LENGTH = 32
const MAX_ENCODED_QUERY = 900

const storageKey = (grantId: string) => `tranche:milestones:${grantId}`

export function encodeNames(names: string[]): string {
  return names.map((n) => n.split(SEPARATOR).join(' ').trim().slice(0, MAX_NAME_LENGTH)).join(SEPARATOR)
}

export function decodeNames(encoded: string | null | undefined): string[] {
  if (!encoded) return []
  return encoded.split(SEPARATOR).map((n) => n.trim().slice(0, MAX_NAME_LENGTH))
}

/** The query string to append to a grant link, or '' if the names would not fit. */
export function namesQuery(names: string[]): string {
  const encoded = encodeNames(names)
  const query = `?m=${encodeURIComponent(encoded)}`
  return encoded.split(SEPARATOR).join('').length === 0 || query.length > MAX_ENCODED_QUERY ? '' : query
}

export function saveNames(grantId: string, names: string[]): void {
  try {
    localStorage.setItem(storageKey(grantId), encodeNames(names))
  } catch {
    // Storage can be unavailable (private mode); the link still carries the names.
  }
}

export function loadNames(grantId: string, fromQuery: string | null): string[] {
  const fromLink = decodeNames(fromQuery)
  if (fromLink.length > 0) return fromLink
  try {
    return decodeNames(localStorage.getItem(storageKey(grantId)))
  } catch {
    return []
  }
}
