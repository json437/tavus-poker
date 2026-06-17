import type { HoldemAction, LegalAction } from './holdem'

export type VoiceCommand =
  | { kind: 'action'; action: HoldemAction; amount?: number; sizing?: 'all-in' | 'pot'; confidence: number; transcript: string }
  | { kind: 'unclear'; confidence: number; transcript: string; reason: string }

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[$,]/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNumberPhrase(text: string): number | undefined {
  const normalized = normalize(text)
  const digits = normalized.match(/\b\d+\b/)
  if (digits) return Number(digits[0])

  const words = normalized.split(/\s|-/).filter(Boolean)
  let total = 0
  let current = 0
  let matched = false

  for (const word of words) {
    if (word === 'and') continue
    if (word === 'hundred') {
      current = Math.max(1, current) * 100
      matched = true
      continue
    }

    const value = NUMBER_WORDS[word]
    if (value === undefined) continue
    current += value
    matched = true
  }

  total += current
  return matched ? total : undefined
}

function legalFor(action: HoldemAction, legalActions: LegalAction[]): LegalAction | undefined {
  return legalActions.find((legal) => legal.action === action)
}

function isOnlyNumberPhrase(text: string): boolean {
  const normalized = normalize(text)
  if (!normalized) return false
  if (/^\d+$/.test(normalized)) return true
  const words = normalized.split(/\s|-/).filter(Boolean).filter((word) => word !== 'and')
  return words.length > 0 && words.every((word) => word === 'hundred' || NUMBER_WORDS[word] !== undefined)
}

export function parseVoiceCommand(transcript: string, legalActions: LegalAction[]): VoiceCommand {
  const normalized = normalize(transcript)
  if (!normalized) {
    return { kind: 'unclear', confidence: 0, transcript, reason: 'No speech captured.' }
  }

  const spokenAmount = parseNumberPhrase(normalized)
  if (spokenAmount !== undefined && isOnlyNumberPhrase(normalized)) {
    const action = legalFor('raise', legalActions) ?? legalFor('bet', legalActions)
    return action
      ? { kind: 'action', action: action.action, amount: spokenAmount, confidence: 0.86, transcript }
      : { kind: 'unclear', confidence: 0.35, transcript, reason: 'A number only matters when a bet or raise is legal.' }
  }

  if (/\bfold\b|\bmuck\b|\bi'?m out\b|\byou got it\b/.test(normalized)) {
    const legal = legalFor('fold', legalActions)
    return legal
      ? { kind: 'action', action: 'fold', confidence: 0.92, transcript }
      : { kind: 'unclear', confidence: 0.35, transcript, reason: 'Fold is not legal in this spot.' }
  }

  if (/\bcheck\b|\btap\b/.test(normalized)) {
    const legal = legalFor('check', legalActions)
    return legal
      ? { kind: 'action', action: 'check', confidence: 0.9, transcript }
      : { kind: 'unclear', confidence: 0.35, transcript, reason: 'Check is not legal while facing a bet.' }
  }

  if (/\bcall\b|\bmatch\b|\bflat\b|\bi'?ll see\b|\bsee it\b|\bpay\b/.test(normalized)) {
    const legal = legalFor('call', legalActions)
    return legal
      ? { kind: 'action', action: 'call', amount: legal.amount, confidence: 0.88, transcript }
      : { kind: 'unclear', confidence: 0.35, transcript, reason: 'Call is not legal in this spot.' }
  }

  if (/\ball in\b|\ball-in\b|\bjam\b|\bshove\b/.test(normalized)) {
    const wager = legalActions.find((item) => item.action === 'raise' || item.action === 'bet')
    if (wager) return { kind: 'action', action: wager.action, sizing: 'all-in', confidence: 0.9, transcript }

    const allInCall = legalActions.find((item) => item.action === 'call' && item.label.toLowerCase().startsWith('all-in'))
    return allInCall
      ? { kind: 'action', action: 'call', amount: allInCall.amount, confidence: 0.88, transcript }
      : { kind: 'unclear', confidence: 0.35, transcript, reason: 'No all-in action is legal in this spot.' }
  }

  if (/\bpot\b/.test(normalized)) {
    const legal = legalActions.find((item) => item.action === 'raise' || item.action === 'bet')
    return legal
      ? { kind: 'action', action: legal.action, sizing: 'pot', confidence: 0.86, transcript }
      : { kind: 'unclear', confidence: 0.3, transcript, reason: 'No pot-sized action is legal in this spot.' }
  }

  if (spokenAmount !== undefined && /\b(to|go|do|make|let'?s|for)\b/.test(normalized)) {
    const action = legalFor('raise', legalActions) ?? legalFor('bet', legalActions)
    if (action) {
      return {
        kind: 'action',
        action: action.action,
        amount: spokenAmount,
        confidence: 0.84,
        transcript,
      }
    }
  }

  if (/\braise\b|\bmake it\b|\bbet\b/.test(normalized)) {
    const action = legalFor('raise', legalActions) ?? legalFor('bet', legalActions)
    if (!action) {
      return { kind: 'unclear', confidence: 0.3, transcript, reason: 'No bet or raise is legal in this spot.' }
    }

    const amount = spokenAmount
    if (amount === undefined) {
      return {
        kind: 'unclear',
        confidence: 0.5,
        transcript,
        reason: `${action.action === 'raise' ? 'Name the raise amount.' : 'Name the bet amount.'}`,
      }
    }

    return {
      kind: 'action',
      action: action.action,
      amount,
      confidence: 0.9,
      transcript,
    }
  }

  return {
    kind: 'unclear',
    confidence: 0.2,
    transcript,
    reason: 'Speech is table talk, not a clear poker command.',
  }
}

export function voiceTellLabel(transcript: string): { label: string; detail: string; intensity: number } {
  const normalized = normalize(transcript)
  if (/\bguess\b|\bmaybe\b|\bi think\b|\bprobably\b|\bwhatever\b|\bfine\b/.test(normalized)) {
    return {
      label: 'hedged speech',
      detail: `The player phrased the action with uncertainty: "${transcript.slice(0, 90)}".`,
      intensity: 0.62,
    }
  }

  if (/\blol\b|\bhaha\b|\blaugh\b|\bfunny\b|\byou'?re bluffing\b|\bfull of/.test(normalized)) {
    return {
      label: 'performative table talk',
      detail: `The player used table talk while deciding: "${transcript.slice(0, 90)}".`,
      intensity: 0.58,
    }
  }

  if (/\bsnap\b|\bquick\b|\beasy\b|\bobvious\b|\binsta/.test(normalized)) {
    return {
      label: 'confident speech',
      detail: `The player sounded verbally committed: "${transcript.slice(0, 90)}".`,
      intensity: 0.56,
    }
  }

  return {
    label: 'spoken action',
    detail: `The player spoke at the table: "${transcript.slice(0, 90)}".`,
    intensity: 0.42,
  }
}
