import { describe, expect, it } from 'vitest'
import { parseVoiceCommand, voiceTellLabel } from './voice'
import type { LegalAction } from './holdem'

const facingBet: LegalAction[] = [
  { action: 'fold', label: 'Fold' },
  { action: 'call', label: 'Call $30', amount: 30 },
  { action: 'raise', label: 'Raise to $90', amount: 90 },
]

const facingAllInCall: LegalAction[] = [
  { action: 'fold', label: 'Fold' },
  { action: 'call', label: 'All-in $18', amount: 18 },
]

const unopened: LegalAction[] = [
  { action: 'check', label: 'Check' },
  { action: 'bet', label: 'Bet $40', amount: 40 },
]

describe('voice poker commands', () => {
  it('maps natural speech to legal poker actions', () => {
    expect(parseVoiceCommand('I think you are full of it, call.', facingBet)).toMatchObject({
      kind: 'action',
      action: 'call',
      amount: 30,
    })
    expect(parseVoiceCommand('fold', facingBet)).toMatchObject({ kind: 'action', action: 'fold' })
    expect(parseVoiceCommand('check', unopened)).toMatchObject({ kind: 'action', action: 'check' })
  })

  it('parses spoken raise sizes', () => {
    expect(parseVoiceCommand('raise to seventy five', facingBet)).toMatchObject({
      kind: 'action',
      action: 'raise',
      amount: 75,
    })
    expect(parseVoiceCommand('make it 125', facingBet)).toMatchObject({
      kind: 'action',
      action: 'raise',
      amount: 125,
    })
  })

  it('supports video-call clarification amounts and table sizing words', () => {
    expect(parseVoiceCommand('forty', facingBet)).toMatchObject({
      kind: 'action',
      action: 'raise',
      amount: 40,
    })
    expect(parseVoiceCommand('all in', facingBet)).toMatchObject({
      kind: 'action',
      action: 'raise',
      sizing: 'all-in',
    })
    expect(parseVoiceCommand('pot', unopened)).toMatchObject({
      kind: 'action',
      action: 'bet',
      sizing: 'pot',
    })
    expect(parseVoiceCommand('let us go to fifty', facingBet)).toMatchObject({
      kind: 'action',
      action: 'raise',
      amount: 50,
    })
    expect(parseVoiceCommand('match it', facingBet)).toMatchObject({
      kind: 'action',
      action: 'call',
      amount: 30,
    })
  })

  it('maps all-in speech to a short-stack all-in call when no wager is legal', () => {
    expect(parseVoiceCommand('jam', facingAllInCall)).toMatchObject({
      kind: 'action',
      action: 'call',
      amount: 18,
    })
  })

  it('asks for a number instead of guessing raise size', () => {
    expect(parseVoiceCommand('I want to raise', facingBet)).toMatchObject({
      kind: 'unclear',
      reason: 'Name the raise amount.',
    })
  })

  it('rejects commands that are not legal in the current spot', () => {
    expect(parseVoiceCommand('check', facingBet)).toMatchObject({
      kind: 'unclear',
      reason: 'Check is not legal while facing a bet.',
    })
  })

  it('turns non-command table talk into tell evidence', () => {
    expect(parseVoiceCommand('you look nervous right now', facingBet)).toMatchObject({ kind: 'unclear' })
    expect(voiceTellLabel('I guess I call.')).toMatchObject({
      label: 'hedged speech',
      intensity: 0.62,
    })
  })
})
