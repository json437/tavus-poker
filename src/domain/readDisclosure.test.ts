import { describe, expect, it } from 'vitest'
import { assertReadDisclosureAllowed, postHandProofUnlocked, sealedReadLabel } from './readDisclosure'

describe('read disclosure guard', () => {
  it('throws if an exact learned read is routed to the live table', () => {
    expect(() =>
      assertReadDisclosureAllowed('Turn', 'live-table', {
        readIds: ['pressure-fold'],
        evidenceIds: ['h2-s3'],
        confidence: 0.61,
        rationale: 'Behavioral read being tested.',
      }),
    ).toThrow(/Live read leakage/)
  })

  it('allows exact proof only after the hand is complete', () => {
    expect(() =>
      assertReadDisclosureAllowed('Complete', 'post-hand-proof', {
        readIds: ['pressure-fold'],
        evidenceIds: ['h2-s3'],
        confidence: 0.61,
        rationale: 'Behavioral read being tested.',
      }),
    ).not.toThrow()
    expect(postHandProofUnlocked('River')).toBe(false)
    expect(postHandProofUnlocked('Complete')).toBe(true)
  })

  it('keeps live labels sealed and non-specific', () => {
    expect(sealedReadLabel('Flop', true)).toBe('Read sealed until showdown')
    expect(sealedReadLabel('Complete', true)).toBe('Proof available')
  })
})
