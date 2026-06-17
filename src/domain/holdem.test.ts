import { describe, expect, it } from 'vitest'
import { STARTING_STACK, applyHeroAction, blindsForHand, buildHoldemTavusContext, estimateTavusEquity, legalActions, matchWinner, startHoldemHand, visibleTavusCards } from './holdem'
import { cardLabel } from './poker'
import type { CardCode } from './poker'

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

function playSeededMatch(seed: number): { winner: string | null; hands: number; actionCount: number; finalStacks: string } {
  const random = seededRandom(seed)
  let game = startHoldemHand(undefined, random)
  let hands = 1
  let actionCount = 0

  while (!matchWinner(game) && hands < 160 && actionCount < 2200) {
    if (game.street === 'Complete') {
      game = startHoldemHand(game, random)
      hands += 1
      continue
    }

    const actions = legalActions(game)
    const action = actions[Math.floor(random() * actions.length)]
    game = applyHeroAction(game, action.action, action.amount, Math.floor(random() * 9000), random).game
    actionCount += 1
  }

  return {
    winner: matchWinner(game),
    hands,
    actionCount,
    finalStacks: `${game.players.hero.stack}:${game.players.tavus.stack}:${game.pot}`,
  }
}

function riverDecision(heroCards: [CardCode, CardCode], tavusCards: [CardCode, CardCode], board: [CardCode, CardCode, CardCode, CardCode, CardCode], seed = 301) {
  const game = startHoldemHand(undefined, seededRandom(seed))
  game.street = 'River'
  game.board = [...board]
  game.deck = game.deck.filter((card) => !new Set([...heroCards, ...tavusCards, ...board]).has(card))
  game.players.hero.holeCards = [...heroCards]
  game.players.tavus.holeCards = [...tavusCards]
  game.players.hero.stack = 250
  game.players.tavus.stack = 250
  game.players.hero.contribution = 0
  game.players.tavus.contribution = 10
  game.players.hero.acted = false
  game.players.tavus.acted = true
  game.players.hero.folded = false
  game.players.tavus.folded = false
  game.players.hero.allIn = false
  game.players.tavus.allIn = false
  game.currentBet = 10
  game.minRaise = 10
  game.pot = 100
  game.toAct = 'hero'
  return applyHeroAction(game, 'call', 10, 1800, seededRandom(seed + 1)).game
}

describe('heads-up holdem engine', () => {
  it('starts a real hand with blinds, stacks, private cards, and no duplicates', () => {
    const game = startHoldemHand(undefined, seededRandom(1))
    const cards = [...game.players.hero.holeCards, ...game.players.tavus.holeCards, ...game.board, ...game.deck]

    expect(game.pot).toBe(15)
    expect(game.currentBet).toBe(10)
    expect(game.players.hero.holeCards).toHaveLength(2)
    expect(game.players.tavus.holeCards).toHaveLength(2)
    expect(new Set(cards).size).toBe(cards.length)
  })

  it('exposes legal hero actions only when action is on hero', () => {
    const game = startHoldemHand(undefined, seededRandom(3))
    const actions = legalActions(game).map((action) => action.action)

    expect(game.toAct).toBe('hero')
    expect(actions.length).toBeGreaterThan(0)
    expect(actions).toContain('fold')
    expect(actions).toContain(game.currentBet > game.players.hero.contribution ? 'call' : 'check')
  })

  it('keeps fold available when hero can check or open the betting', () => {
    const game = startHoldemHand(undefined, seededRandom(3))
    const call = legalActions(game).find((action) => action.action === 'call')
    const { game: flop } = applyHeroAction(game, 'call', call?.amount, 1000, seededRandom(1003))
    const actions = legalActions(flop).map((action) => action.action)

    expect(flop.toAct).toBe('hero')
    expect(flop.currentBet).toBe(0)
    expect(actions).toContain('fold')
    expect(actions).toContain('check')
    expect(actions).toContain('bet')
  })

  it('applies a hero action and preserves chip totals', () => {
    const game = startHoldemHand(undefined, seededRandom(5))
    const totalBefore = game.players.hero.stack + game.players.tavus.stack + game.pot
    const action = legalActions(game).find((item) => item.action === 'call') ?? legalActions(game)[0]
    const { game: next } = applyHeroAction(game, action.action, action.amount, 2400, seededRandom(6))
    const totalAfter = next.players.hero.stack + next.players.tavus.stack + next.pot

    expect(totalAfter).toBe(totalBefore)
    expect(next.actionLog.length).toBeGreaterThan(game.actionLog.length)
  })

  it('does not send hero hole cards to Tavus before showdown', () => {
    const game = startHoldemHand(undefined, seededRandom(6))
    const context = buildHoldemTavusContext(game)

    expect(context).toContain('User private hole cards: hidden from you until showdown')
    expect(context).toContain('Spoken legal actions:')
    expect(context).toContain('Ask the user to say their action out loud.')
    expect(context).toContain('Never tell the user to click')
    expect(context).not.toContain('before clicking')
    expect(context).not.toContain('use the slider')
    expect(context).toContain(game.players.tavus.holeCards.map(cardLabel).join(' '))
    for (const label of game.players.hero.holeCards.map(cardLabel)) {
      expect(context).not.toContain(label)
    }
  })

  it('keeps Tavus cards mucked when a hand ends by fold', () => {
    const game = startHoldemHand(undefined, seededRandom(11))
    const folded = applyHeroAction(game, 'fold', undefined, 1200, seededRandom(12)).game
    const context = buildHoldemTavusContext(folded)

    expect(folded.showdown?.cardsRevealed).toBe(false)
    expect(folded.showdown?.tavusHand).toBe('mucked')
    expect(visibleTavusCards(folded)).toBeNull()
    for (const label of game.players.hero.holeCards.map(cardLabel)) {
      expect(context).not.toContain(label)
    }
  })

  it.each([
    {
      name: 'flush beats straight',
      heroCards: ['Ah', 'Kh'],
      tavusCards: ['6c', '7d'],
      board: ['2h', '3h', '4h', '5s', '9c'],
      winner: 'hero',
      handText: /Flush/i,
    },
    {
      name: 'straight beats trips',
      heroCards: ['5s', '6d'],
      tavusCards: ['9d', 'Kc'],
      board: ['2c', '3d', '4h', '9s', '9c'],
      winner: 'hero',
      handText: /Straight/i,
    },
    {
      name: 'full house beats two pair',
      heroCards: ['2h', 'As'],
      tavusCards: ['Ks', 'Qd'],
      board: ['2c', '2d', '9h', '9s', 'Kc'],
      winner: 'hero',
      handText: /Full House/i,
    },
    {
      name: 'wheel straight is recognized',
      heroCards: ['Ah', '5c'],
      tavusCards: ['Kc', 'Qd'],
      board: ['2c', '3d', '4h', '9s', 'Kd'],
      winner: 'hero',
      handText: /Straight/i,
    },
    {
      name: 'kicker decides equal pair class',
      heroCards: ['Ks', '3h'],
      tavusCards: ['Qs', 'Jh'],
      board: ['Ah', 'Ad', '7s', '4c', '2d'],
      winner: 'hero',
      handText: /Pair/i,
    },
  ])('resolves $name', ({ heroCards, tavusCards, board, winner, handText }) => {
    const result = riverDecision(
      heroCards as [CardCode, CardCode],
      tavusCards as [CardCode, CardCode],
      board as [CardCode, CardCode, CardCode, CardCode, CardCode],
    )

    expect(result.street).toBe('Complete')
    expect(result.showdown?.winner).toBe(winner)
    expect(result.showdown?.heroHand).toMatch(handText)
    expect(result.players.hero.stack + result.players.tavus.stack + result.pot).toBe(600)
  })

  it('splits an exact tie and sends the odd chip to the out-of-position player', () => {
    const result = riverDecision(
      ['2c', '3c'],
      ['4d', '5d'],
      ['Ah', 'Kd', 'Qs', 'Jc', 'Td'],
      409,
    )

    expect(result.showdown?.winner).toBe('split')
    expect(result.showdown?.potAmount).toBe(110)
    expect(result.players.hero.stack).toBe(295)
    expect(result.players.tavus.stack).toBe(305)
    expect(result.showdown?.summary).not.toContain('Odd chip')
  })

  it('handles odd-chip split pots deterministically in heads-up play', () => {
    const game = startHoldemHand(undefined, seededRandom(500))
    game.dealer = 'hero'
    game.street = 'River'
    game.board = ['Ah', 'Kd', 'Qs', 'Jc', 'Td']
    game.players.hero.holeCards = ['2c', '3c']
    game.players.tavus.holeCards = ['4d', '5d']
    game.players.hero.stack = 250
    game.players.tavus.stack = 249
    game.players.hero.contribution = 0
    game.players.tavus.contribution = 10
    game.players.hero.acted = false
    game.players.tavus.acted = true
    game.currentBet = 10
    game.minRaise = 10
    game.pot = 101
    game.toAct = 'hero'

    const result = applyHeroAction(game, 'call', 10, 1200, seededRandom(501)).game

    expect(result.showdown?.winner).toBe('split')
    expect(result.showdown?.potAmount).toBe(111)
    expect(result.players.hero.stack).toBe(295)
    expect(result.players.tavus.stack).toBe(305)
    expect(result.showdown?.summary).toContain('Odd chip to Tavus')
    expect(result.players.hero.stack + result.players.tavus.stack + result.pot).toBe(600)
  })

  it('resolves a short blind all-in before offering bogus action', () => {
    const previous = startHoldemHand(undefined, seededRandom(12))
    previous.dealer = 'tavus'
    previous.players.hero.stack = 997
    previous.players.tavus.stack = 3
    const next = startHoldemHand(previous, seededRandom(13))

    expect(next.street).toBe('Complete')
    expect(next.toAct).toBeNull()
    expect(legalActions(next)).toEqual([])
    expect(next.actionLog).toContainEqual(expect.objectContaining({ actor: 'dealer', action: 'returns uncalled chips', amount: 2 }))
    expect(next.showdown?.cardsRevealed).toBe(true)
    expect(next.players.hero.stack + next.players.tavus.stack + next.pot).toBe(1000)
  })

  it('does not use hidden hero cards for Tavus river equity', () => {
    const base = startHoldemHand(undefined, seededRandom(13))
    const riverBoard = ['2c', '7d', '9h', 'Js', 'Qc'] as const
    const tavusHole = ['Ah', 'Ad'] as const
    const firstHeroHole = ['3s', '4s'] as const
    const secondHeroHole = ['Kh', 'Kd'] as const
    const firstRiver = {
      ...base,
      board: [...riverBoard],
      players: {
        hero: { ...base.players.hero, holeCards: [...firstHeroHole] },
        tavus: { ...base.players.tavus, holeCards: [...tavusHole] },
      },
    }
    const secondRiver = {
      ...firstRiver,
      players: {
        hero: { ...firstRiver.players.hero, holeCards: [...secondHeroHole] },
        tavus: { ...firstRiver.players.tavus },
      },
    }

    expect(estimateTavusEquity(firstRiver, seededRandom(14))).toBe(estimateTavusEquity(secondRiver, seededRandom(14)))
  })

  it('raises blinds through the match and refuses to restart after a winner', () => {
    const game = startHoldemHand(undefined, seededRandom(7))
    const handFiveBlinds = blindsForHand(5)
    const busted = {
      ...game,
      players: {
        ...game.players,
        hero: { ...game.players.hero, stack: 0 },
      },
    }

    expect(handFiveBlinds.bigBlind).toBeGreaterThan(game.bigBlind)
    expect(matchWinner(busted)).toBe('tavus')
    expect(() => startHoldemHand(busted, seededRandom(8))).toThrow(/winner/)
  })

  it('does not offer a raise when a short stack can only call all-in', () => {
    const game = startHoldemHand(undefined, seededRandom(9))
    game.players.hero.stack = 3
    const totalBefore = game.players.hero.stack + game.players.tavus.stack + game.pot
    const actions = legalActions(game)

    expect(actions.map((action) => action.action)).toEqual(['fold', 'call'])
    expect(actions.find((action) => action.action === 'call')).toMatchObject({ label: 'All-in $3', amount: 3 })

    const { game: next } = applyHeroAction(game, 'call', actions.find((action) => action.action === 'call')?.amount, 1700, seededRandom(10))
    const totalAfter = next.players.hero.stack + next.players.tavus.stack + next.pot

    expect(next.players.hero.allIn).toBe(true)
    expect(next.street).toBe('Complete')
    expect(next.actionLog).toContainEqual(expect.objectContaining({ actor: 'dealer', action: 'returns uncalled chips', amount: 2 }))
    expect(next.players.tavus.stack).toBeGreaterThanOrEqual(STARTING_STACK - 8)
    expect(totalAfter).toBe(totalBefore)
  })

  it('limits action over a short all-in raise to fold or call', () => {
    const game = startHoldemHand(undefined, seededRandom(19))
    game.players.hero.stack = 8
    const actions = legalActions(game)
    const allInRaise = actions.find((action) => action.action === 'raise')

    expect(allInRaise?.label).toBe('All-in $13')

    const raised = applyHeroAction(game, 'raise', allInRaise?.amount, 1800, seededRandom(20)).game

    expect(raised.street).toBe('Complete')
    expect(raised.actionLog.some((entry) => entry.actor === 'tavus' && entry.action === 'bets')).toBe(false)
    expect(raised.actionLog.some((entry) => entry.actor === 'tavus' && entry.action.startsWith('raises'))).toBe(false)
  })

  it('treats the big blind option as check or raise, not a bet', () => {
    const game = startHoldemHand(undefined, seededRandom(29))
    game.toAct = 'tavus'
    game.players.hero.contribution = game.bigBlind
    game.players.tavus.contribution = game.bigBlind
    game.players.hero.acted = true
    game.players.tavus.acted = false

    const actions = legalActions(game, 'tavus')

    expect(actions.map((action) => action.action)).toEqual(['check', 'raise'])
    expect(actions.some((action) => action.action === 'bet')).toBe(false)
  })

  it('logs raises by target amount, not just newly paid chips', () => {
    const game = startHoldemHand(undefined, seededRandom(30))
    const raise = legalActions(game).find((action) => action.action === 'raise')

    expect(raise?.amount).toBeDefined()

    const raised = applyHeroAction(game, 'raise', raise?.amount, 2000, seededRandom(31)).game
    const heroRaise = raised.actionLog.find((entry) => entry.actor === 'hero' && entry.action === 'raises to')

    expect(heroRaise).toMatchObject({ amount: raise?.amount })
    expect(heroRaise?.note).toContain(`Put in ${raise?.amount ? `$${raise.amount - game.players.hero.contribution}` : '$0'} more`)
  })

  it('plays deterministic matches to a winner without chip drift or stuck Tavus turns', () => {
    for (const seed of [1, 7, 13, 19, 23, 29, 31, 37]) {
      const random = seededRandom(seed)
      let game = startHoldemHand(undefined, random)
      let hands = 1
      let actionCount = 0

      while (!matchWinner(game) && hands < 160 && actionCount < 2200) {
        if (game.street === 'Complete') {
          game = startHoldemHand(game, random)
          hands += 1
          continue
        }

        expect(game.toAct).toBe('hero')
        const actions = legalActions(game)
        expect(actions.length).toBeGreaterThan(0)
        const action = actions[Math.floor(random() * actions.length)]
        const totalBefore = game.players.hero.stack + game.players.tavus.stack + game.pot
        game = applyHeroAction(game, action.action, action.amount, Math.floor(random() * 9000), random).game
        const totalAfter = game.players.hero.stack + game.players.tavus.stack + game.pot

        expect(totalAfter).toBe(totalBefore)
        expect(totalAfter).toBe(STARTING_STACK * 2)
        actionCount += 1
      }

      expect(matchWinner(game)).not.toBeNull()
      expect(game.players.hero.stack + game.players.tavus.stack + game.pot).toBe(STARTING_STACK * 2)
    }
  })

  it('deals 1000 seeded heads-up hands without duplicate cards or chip drift', () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const game = startHoldemHand(undefined, seededRandom(seed + 9000))
      const cards = [...game.players.hero.holeCards, ...game.players.tavus.holeCards, ...game.board, ...game.deck]

      expect(new Set(cards).size).toBe(cards.length)
      expect(game.players.hero.stack + game.players.tavus.stack + game.pot).toBe(STARTING_STACK * 2)
      expect(game.players.hero.holeCards).toHaveLength(2)
      expect(game.players.tavus.holeCards).toHaveLength(2)
      expect(game.toAct).toBe('hero')
    }
  })

  it('replays the same seeded match exactly', () => {
    expect(playSeededMatch(73)).toEqual(playSeededMatch(73))
  })
})
