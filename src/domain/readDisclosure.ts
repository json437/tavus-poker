import type { HoldemStreet } from './holdem'

export type ReadDisclosureSurface = 'live-table' | 'post-hand-proof'

export type ReadDisclosurePayload = {
  readIds?: string[]
  evidenceIds?: string[]
  confidence?: number | string
  rationale?: string
}

function hasExactRead(payload: ReadDisclosurePayload): boolean {
  return Boolean(
    payload.readIds?.length ||
      payload.evidenceIds?.length ||
      payload.confidence !== undefined ||
      payload.rationale?.trim(),
  )
}

export function assertReadDisclosureAllowed(
  street: HoldemStreet,
  surface: ReadDisclosureSurface,
  payload: ReadDisclosurePayload,
) {
  if (surface === 'live-table' && street !== 'Complete' && hasExactRead(payload)) {
    throw new Error('Live read leakage: exact Tavus reads may only render after the hand is complete.')
  }
}

export function postHandProofUnlocked(street: HoldemStreet): boolean {
  return street === 'Complete'
}

export function sealedReadLabel(street: HoldemStreet, hasEvidence: boolean): string {
  if (street === 'Complete') return hasEvidence ? 'Proof available' : 'No read spent'
  return hasEvidence ? 'Read sealed until showdown' : 'No live read exposed'
}
