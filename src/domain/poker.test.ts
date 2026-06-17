import { describe, expect, it } from 'vitest'
import { availableActions, buildTavusContext, cardLabel, generateSpot, scoreDecision } from './poker'

function seededRandom(seed: number): () => number {
  let value = seed
  return () => {
    value |= 0
    value = (value + 0x6d2b79f5) | 0
    let next = Math.imul(value ^ (value >>> 15), 1 | value)
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

describe('tavusPoker domain', () => {
  it('generates a heads-up spot with hidden Tavus cards and legal actions', () => {
    const spot = generateSpot(7, seededRandom(42))

    expect(spot.heroCards).toHaveLength(2)
    expect(spot.tavusCards).toHaveLength(2)
    expect(spot.board.length).toBeGreaterThanOrEqual(3)
    expect(availableActions(spot)).toContain(spot.toCall > 0 ? 'call' : 'check')
  })

  it('scores the recommended action as a great decision', () => {
    const spot = generateSpot(1, seededRandom(9))
    const result = scoreDecision(spot, spot.recommendedAction, 2400)

    expect(result.quality).toBe('great')
    expect(result.score).toBe(100)
  })

  it('builds Tavus context without leaking the hidden cards too early in the UI path', () => {
    const spot = generateSpot(3, seededRandom(14))
    const context = buildTavusContext(spot)

    expect(context).toContain('Your private Tavus cards')
    expect(context).toContain('Do not say these unless')
    expect(context).toContain(spot.tavusAction.lineType)
    expect(context).toContain('User private hole cards: hidden from you until showdown')
    expect(context).not.toContain(spot.heroHand)
    for (const label of spot.heroCards.map(cardLabel)) {
      expect(context).not.toContain(label)
    }
  })

  it('samples varied Tavus lines so the opponent can actually deceive', () => {
    const lineTypes = new Set(Array.from({ length: 80 }, (_, index) => generateSpot(index + 1, seededRandom(index + 200)).tavusAction.lineType))

    expect(lineTypes.size).toBeGreaterThanOrEqual(3)
    expect([...lineTypes]).toContain('bluff')
  })
})
