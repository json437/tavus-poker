import { describe, expect, it } from 'vitest'
import { applyHeroAction, legalActions, matchWinner, startHoldemHand, toCall } from './holdem'
import { createOpponentBrain, ingestRavenSignal, observeHeroAction, recordTavusDecision, settleHandReads } from './opponentBrain'

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

describe('opponent brain', () => {
  it('does not turn one Raven cue into an active tell before the player commits an action', () => {
    const game = startHoldemHand(undefined, seededRandom(101))
    const brain = ingestRavenSignal(createOpponentBrain(), game, {
      kind: 'gaze',
      label: 'brief gaze shift',
      detail: 'The user glanced away once while thinking.',
      intensity: 0.72,
    })

    expect(brain.reads.find((read) => read.id === 'hesitation-bluff')?.confidence).toBeLessThan(0.4)
    expect(brain.strategy.readIds).not.toContain('hesitation-bluff')
    expect(brain.strategy.rationale).toContain('No behavioral read is active')
  })

  it('strengthens a tell only after repeated Raven cues bind to matching actions', () => {
    let brain = createOpponentBrain()

    for (const seed of [102, 103, 104]) {
      const game = startHoldemHand(undefined, seededRandom(seed))
      brain = ingestRavenSignal(brain, game, {
        kind: 'voice',
        label: 'voice tension',
        detail: 'The user sounded tense while facing pressure.',
        intensity: 0.76,
      })
      brain = observeHeroAction(brain, game, {
        action: 'fold',
        latencyMs: 7200,
        saidAction: 'I guess I fold',
      })
    }

    const read = brain.reads.find((item) => item.id === 'pressure-fold')
    expect(read?.confidence).toBeGreaterThan(0.55)
    expect(read?.evidenceIds.length).toBeGreaterThanOrEqual(4)
    expect(brain.strategy.readIds).toContain('pressure-fold')
    expect(brain.strategy.pressureBias).toBeGreaterThan(0.05)
  })

  it('suppresses a pressure read when later evidence contradicts it', () => {
    let brain = createOpponentBrain()
    const first = startHoldemHand(undefined, seededRandom(105))
    brain = observeHeroAction(brain, first, {
      action: 'fold',
      latencyMs: 7600,
      saidAction: 'fine, you got it',
    })
    const strengthened = brain.reads.find((read) => read.id === 'pressure-fold')?.confidence ?? 0

    for (const seed of [106, 107, 108]) {
      const game = startHoldemHand(undefined, seededRandom(seed))
      const call = legalActions(game).find((action) => action.action === 'call')
      brain = observeHeroAction(brain, game, {
        action: 'call',
        amount: call?.amount,
        latencyMs: 1800,
        saidAction: 'call',
      })
    }

    const contradicted = brain.reads.find((read) => read.id === 'pressure-fold')
    expect(contradicted?.confidence).toBeLessThan(strengthened)
    expect(contradicted?.status).toBe('weakened')
    expect(brain.strategy.readIds).not.toContain('pressure-fold')
  })

  it('turns a hero tell into evidence-backed strategy', () => {
    const game = startHoldemHand(undefined, seededRandom(11))
    const brain = createOpponentBrain()
    const next = observeHeroAction(brain, game, {
      action: 'fold',
      latencyMs: 7200,
      saidAction: 'I think you have it',
    })
    const pressureRead = next.reads.find((read) => read.id === 'pressure-fold')

    expect(next.signals.length).toBeGreaterThanOrEqual(3)
    expect(pressureRead?.confidence).toBeGreaterThan(0.3)
    expect(pressureRead?.evidenceIds.length).toBeGreaterThan(0)
    expect(next.strategy.evidenceIds.length).toBeGreaterThan(0)
    expect(next.strategy.pressureBias).toBeGreaterThan(0)
  })

  it('changes Tavus strategy for the same cards when behavior changes', () => {
    const game = startHoldemHand(undefined, seededRandom(12))
    const brain = createOpponentBrain()
    const raise = legalActions(game).find((action) => action.action === 'raise')

    const snapCall = observeHeroAction(brain, game, { action: 'call', latencyMs: 800 })
    const tankRaise = observeHeroAction(brain, game, { action: 'raise', amount: raise?.amount, latencyMs: 7800 })

    expect(snapCall.strategy.trapBias).toBeGreaterThan(tankRaise.strategy.trapBias)
    expect(tankRaise.strategy.callDownBias).toBeGreaterThan(snapCall.strategy.callDownBias)
    expect(tankRaise.strategy.rationale).not.toBe(snapCall.strategy.rationale)
  })

  it('records raise evidence with target sizing', () => {
    const game = startHoldemHand(undefined, seededRandom(121))
    const brain = createOpponentBrain()
    const raise = legalActions(game).find((action) => action.action === 'raise')
    const next = observeHeroAction(brain, game, { action: 'raise', amount: raise?.amount, latencyMs: 2200 })
    const actionSignal = next.signals.find((signal) => signal.source === 'game-action')

    expect(actionSignal?.detail).toContain(`raise to $${raise?.amount}`)
  })

  it('records Tavus decisions with behavioral evidence when a read is active', () => {
    const game = startHoldemHand(undefined, seededRandom(13))
    const brain = observeHeroAction(createOpponentBrain(), game, {
      action: 'call',
      latencyMs: 900,
      saidAction: 'call, let us see it',
    })
    const result = applyHeroAction(game, 'call', legalActions(game).find((action) => action.action === 'call')?.amount, 900, seededRandom(14), brain.strategy)
    const traced = recordTavusDecision(brain, result.game)
    const trace = traced.traces.at(-1)

    expect(result.game.lastTavusDecision).toBeDefined()
    expect(trace?.evidenceIds.length).toBeGreaterThan(0)
    expect(trace?.behavioralReason).toContain('Behavioral read being tested')
  })

  it('records every Tavus decision when auto-play crosses streets in one hero action', () => {
    let foundMultiDecisionHand = false

    for (let seed = 2; seed < 80 && !foundMultiDecisionHand; seed += 1) {
      const random = seededRandom(seed)
      let brain = createOpponentBrain()
      let game = startHoldemHand(undefined, random, brain.strategy)
      brain = recordTavusDecision(brain, game)

      for (let actionCount = 0; actionCount < 180 && !matchWinner(game); actionCount += 1) {
        const tavusActions = game.actionLog.filter((entry) => entry.actor === 'tavus' && !entry.action.includes('blind'))
        const traces = brain.traces.filter((trace) => trace.handNumber === game.handNumber)

        if (tavusActions.length >= 2) {
          foundMultiDecisionHand = true
          expect(traces.map((trace) => trace.sequence)).toEqual(tavusActions.map((_entry, index) => index + 1))
          expect(traces).toHaveLength(tavusActions.length)
          break
        }

        if (game.street === 'Complete') {
          game = startHoldemHand(game, random, brain.strategy)
          brain = recordTavusDecision(brain, game)
          continue
        }

        const actions = legalActions(game)
        const action = toCall(game, 'hero') === 0 ? actions.find((item) => item.action !== 'fold') ?? actions[0] : actions[0]
        brain = observeHeroAction(brain, game, { action: action.action, amount: action.amount, latencyMs: 1800 })
        game = applyHeroAction(game, action.action, action.amount, 1800, random, brain.strategy).game
        brain = settleHandReads(recordTavusDecision(brain, game), game)
      }
    }

    expect(foundMultiDecisionHand).toBe(true)
  })

  it('ingests Raven perception without fabricating a poker action', () => {
    const game = startHoldemHand(undefined, seededRandom(15))
    const brain = createOpponentBrain()
    const next = ingestRavenSignal(brain, game, {
      kind: 'gaze',
      label: 'gaze shift',
      detail: 'The user looked away and paused while facing pressure.',
      intensity: 0.74,
    })

    expect(next.signals).toHaveLength(1)
    expect(next.decisionWindows).toHaveLength(1)
    expect(next.signals[0].source).toBe('raven')
    expect(next.signals[0].kind).toBe('gaze')
    expect(next.signals[0].decisionWindowId).toBe(next.decisionWindows[0].id)
    expect(next.decisionWindows[0].committedAction).toBeUndefined()
    expect(next.strategy.readIds).toEqual([])
    expect(next.strategy.evidenceIds).not.toContain(next.signals[0].id)
  })

  it('ignores Raven perception outside live hero decision windows', () => {
    const game = startHoldemHand(undefined, seededRandom(15))
    const completed = applyHeroAction(game, 'fold', undefined, 900, seededRandom(151)).game
    const brain = createOpponentBrain()
    const signal = {
      kind: 'gaze' as const,
      label: 'post-hand gaze shift',
      detail: 'The user moved after the pot had already been awarded.',
      intensity: 0.74,
    }

    expect(ingestRavenSignal(brain, completed, signal)).toBe(brain)
    expect(
      ingestRavenSignal(brain, { ...game, toAct: 'tavus' }, signal),
    ).toBe(brain)
  })

  it('binds Raven, timing, words, poker context, and committed action to one decision window', () => {
    const game = startHoldemHand(undefined, seededRandom(16))
    const brain = ingestRavenSignal(createOpponentBrain(), game, {
      kind: 'voice',
      label: 'uncertain phrase',
      detail: 'The user said maybe and sounded tense while facing the blind.',
      intensity: 0.7,
    })
    const action = legalActions(game).find((item) => item.action === 'call') ?? legalActions(game)[0]
    const next = observeHeroAction(brain, game, {
      action: action.action,
      amount: action.amount,
      latencyMs: 7100,
      saidAction: 'maybe I call',
    })
    const window = next.decisionWindows[0]

    expect(next.decisionWindows).toHaveLength(1)
    expect(window.facingBet).toBeGreaterThan(0)
    expect(window.pot).toBe(game.pot)
    expect(window.committedAction?.action).toBe(action.action)
    expect(window.signalIds.length).toBeGreaterThanOrEqual(4)
    expect(next.signals.every((signal) => signal.decisionWindowId === window.id)).toBe(true)
  })

  it('banks decision evidence when the hand ends before Tavus can spend the read', () => {
    const game = startHoldemHand(undefined, seededRandom(17))
    const brain = observeHeroAction(createOpponentBrain(), game, {
      action: 'fold',
      latencyMs: 7200,
      saidAction: 'I think you have it',
    })
    const result = applyHeroAction(game, 'fold', undefined, 7200, seededRandom(18), brain.strategy)
    const settled = settleHandReads(recordTavusDecision(brain, result.game), result.game)
    const debrief = settled.debriefs.at(-1)

    expect(settled.traces).toHaveLength(0)
    expect(debrief?.title).toBe('Read banked for later')
    expect(debrief?.summary).toContain('did not get a later decision')
    expect(debrief?.evidenceIds.length).toBeGreaterThan(0)
    expect(debrief?.readIds).toContain('pressure-fold')
  })
})
