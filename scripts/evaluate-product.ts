import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { STARTING_STACK, applyHeroAction, blindsForHand, buildHoldemTavusContext, estimateTavusEquity, legalActions, matchWinner, startHoldemHand, toCall, visibleTavusCards } from '../src/domain/holdem.ts'
import { buildBrainContext, createOpponentBrain, ingestRavenSignal, observeHeroAction, recordTavusDecision, settleHandReads } from '../src/domain/opponentBrain.ts'
import { availableActions, buildTavusContext, cardLabel, generateSpot, toPlayingCard } from '../src/domain/poker.ts'
import { buildTablePlayerPersonaBody, buildTavusConversationBody } from '../src/lib/tavusApiPayloads.ts'
import { userSpeechFromAppMessage } from '../src/lib/tavusEvents.ts'
import type { CardCode, PlayerAction } from '../src/domain/poker.ts'
import { parseVoiceCommand, voiceTellLabel } from '../src/domain/voice.ts'

type EvalResult = {
  name: string
  pass: boolean
  detail: string
}

type MatchSimulation = {
  seed: number
  pass: boolean
  detail: string
}

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

function uniqueCards(cards: CardCode[]): boolean {
  return new Set(cards).size === cards.length
}

function actionSize(action: PlayerAction, spot: ReturnType<typeof generateSpot>): number {
  if (action === 'call') return spot.toCall
  if (action === 'raise' || action === 'bet') return Math.max(spot.minRaise, spot.recommendedSize)
  return 0
}

function chooseHeroSimulationAction(game: ReturnType<typeof startHoldemHand>, actions: ReturnType<typeof legalActions>, random: () => number) {
  const candidates = toCall(game, 'hero') === 0 ? actions.filter((action) => action.action !== 'fold') : actions
  const playable = candidates.length ? candidates : actions
  return playable[Math.floor(random() * playable.length)]
}

function runMatchSimulation(seed: number): MatchSimulation {
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

    if (game.toAct !== 'hero') {
      return {
        seed,
        pass: false,
        detail: `stuck with ${game.toAct ?? 'nobody'} to act on hand ${hands} ${game.street}`,
      }
    }

    const actions = legalActions(game)
    if (!actions.length) {
      return {
        seed,
        pass: false,
        detail: `no legal hero actions on hand ${hands} ${game.street}`,
      }
    }

    const action = chooseHeroSimulationAction(game, actions, random)
    const totalBefore = game.players.hero.stack + game.players.tavus.stack + game.pot
    const result = applyHeroAction(game, action.action, action.amount, Math.floor(random() * 9000), random)
    game = result.game
    const totalAfter = game.players.hero.stack + game.players.tavus.stack + game.pot

    if (totalBefore !== totalAfter || totalAfter !== STARTING_STACK * 2) {
      return {
        seed,
        pass: false,
        detail: `chip drift on hand ${hands}: ${totalBefore} -> ${totalAfter}`,
      }
    }

    actionCount += 1
  }

  const winner = matchWinner(game)
  if (!winner) {
    return {
      seed,
      pass: false,
      detail: `no winner after ${hands} hands and ${actionCount} actions`,
    }
  }

  return {
    seed,
    pass: true,
    detail: `${winner} won seed ${seed} in ${hands} hands / ${actionCount} hero decisions`,
  }
}

function findMultiDecisionTraceCoverage(seed: number): { pass: boolean; detail: string } {
  for (let nextSeed = seed; nextSeed < seed + 80; nextSeed += 1) {
    const random = seededRandom(nextSeed)
    let brain = createOpponentBrain()
    let game = startHoldemHand(undefined, random, brain.strategy)
    brain = recordTavusDecision(brain, game)

    for (let actionCount = 0; actionCount < 180 && !matchWinner(game); actionCount += 1) {
      const tavusActions = game.actionLog.filter((entry) => entry.actor === 'tavus' && !entry.action.includes('blind'))
      const traces = brain.traces.filter((trace) => trace.handNumber === game.handNumber)

      if (tavusActions.length >= 2) {
        const sequenceMatches = traces.map((trace) => trace.sequence).join(',') === tavusActions.map((_entry, index) => index + 1).join(',')
        return {
          pass: traces.length === tavusActions.length && sequenceMatches,
          detail: `seed ${nextSeed} hand ${game.handNumber}: ${tavusActions.length} Tavus actions, ${traces.length} traces`,
        }
      }

      if (game.street === 'Complete') {
        game = startHoldemHand(game, random, brain.strategy)
        brain = recordTavusDecision(brain, game)
        continue
      }

      const actions = legalActions(game)
      const action = chooseHeroSimulationAction(game, actions, () => 0)
      brain = observeHeroAction(brain, game, { action: action.action, amount: action.amount, latencyMs: 1800 })
      game = applyHeroAction(game, action.action, action.amount, 1800, random, brain.strategy).game
      brain = settleHandReads(recordTavusDecision(brain, game), game)
    }
  }

  return {
    pass: false,
    detail: 'no multi-decision hand reached in coverage seed',
  }
}

const samples = Array.from({ length: 240 }, (_, index) => generateSpot(index + 1, seededRandom(index + 101)))
const holdemSamples = Array.from({ length: 80 }, (_, index) => startHoldemHand(undefined, seededRandom(index + 400)))
const lineTypes = new Set(samples.map((spot) => spot.tavusAction.lineType))
const bluffCount = samples.filter((spot) => spot.tavusAction.lineType === 'bluff' || spot.tavusAction.lineType === 'semi-bluff').length
const invalidDuplicate = samples.find((spot) => !uniqueCards([...spot.heroCards, ...spot.tavusCards, ...spot.board]))
const invalidActionSize = samples.find((spot) =>
  availableActions(spot).some((action) => ['call', 'raise', 'bet'].includes(action) && actionSize(action, spot) <= 0),
)
const invalidHoldemDuplicate = holdemSamples.find((game) => !uniqueCards([...game.players.hero.holeCards, ...game.players.tavus.holeCards, ...game.board, ...game.deck]))
const invalidHoldemBlinds = holdemSamples.find((game) => game.pot !== game.smallBlind + game.bigBlind || game.currentBet !== game.bigBlind)
const invalidHoldemLegalAction = holdemSamples.find((game) => game.toAct === 'hero' && legalActions(game).length === 0)
const shortCallOnlyGame = startHoldemHand(undefined, seededRandom(910))
shortCallOnlyGame.players.hero.stack = 3
const shortCallOnlyActions = legalActions(shortCallOnlyGame)
const spokenAllInCallOnly = parseVoiceCommand('jam', shortCallOnlyActions)
const shortCallOnlyResult = applyHeroAction(shortCallOnlyGame, 'call', shortCallOnlyActions.find((action) => action.action === 'call')?.amount, 1700, seededRandom(913))
const shortAllInRaiseGame = startHoldemHand(undefined, seededRandom(911))
shortAllInRaiseGame.players.hero.stack = 8
const shortAllInRaiseActions = legalActions(shortAllInRaiseGame)
const shortAllInResult = applyHeroAction(shortAllInRaiseGame, 'raise', shortAllInRaiseActions.find((action) => action.action === 'raise')?.amount, 1900, seededRandom(912))
const shortBlindPrevious = startHoldemHand(undefined, seededRandom(916))
shortBlindPrevious.dealer = 'tavus'
shortBlindPrevious.players.hero.stack = 997
shortBlindPrevious.players.tavus.stack = 3
const shortBlindHand = startHoldemHand(shortBlindPrevious, seededRandom(917))
const raiseLogGame = startHoldemHand(undefined, seededRandom(914))
const raiseLogAction = legalActions(raiseLogGame).find((action) => action.action === 'raise')
const raiseLogResult = applyHeroAction(raiseLogGame, 'raise', raiseLogAction?.amount, 2100, seededRandom(915))
const heroRaiseLog = raiseLogResult.game.actionLog.find((entry) => entry.actor === 'hero' && entry.action === 'raises to')
const noPressureFoldBase = startHoldemHand(undefined, seededRandom(3))
const noPressureCall = legalActions(noPressureFoldBase).find((action) => action.action === 'call')
const noPressureFoldSpot = applyHeroAction(noPressureFoldBase, 'call', noPressureCall?.amount, 1000, seededRandom(1003)).game
const noPressureActions = legalActions(noPressureFoldSpot).map((action) => action.action)
const matchSimulations = [1, 7, 13, 19, 23, 29, 31, 37, 41, 47].map(runMatchSimulation)
const failedMatchSimulation = matchSimulations.find((simulation) => !simulation.pass)
const deterministicReplayA = runMatchSimulation(73)
const deterministicReplayB = runMatchSimulation(73)
const multiDecisionTraceCoverage = findMultiDecisionTraceCoverage(2)
const chipDrift = holdemSamples.find((game, index) => {
  const before = game.players.hero.stack + game.players.tavus.stack + game.pot
  const action = legalActions(game)[0]
  if (!action) return false
  const { game: next } = applyHeroAction(game, action.action, action.amount, 2200, seededRandom(index + 900))
  const after = next.players.hero.stack + next.players.tavus.stack + next.pot
  return before !== after
})
const sampleContext = buildTavusContext(samples[0])
const brainBaseline = createOpponentBrain()
const behaviorGame = startHoldemHand(undefined, seededRandom(901))
const risingBlindGame = Array.from({ length: 4 }).reduce(
  (game, _item, index) => startHoldemHand(game, seededRandom(940 + index)),
  startHoldemHand(undefined, seededRandom(939)),
)
const snapBrain = observeHeroAction(brainBaseline, behaviorGame, { action: 'call', latencyMs: 800, saidAction: 'call' })
const raiseAction = legalActions(behaviorGame).find((action) => action.action === 'raise')
const tankBrain = observeHeroAction(brainBaseline, behaviorGame, { action: 'raise', amount: raiseAction?.amount, latencyMs: 7900, saidAction: 'raise' })
const callAction = legalActions(behaviorGame).find((action) => action.action === 'call') ?? legalActions(behaviorGame)[0]
const spokenCall = parseVoiceCommand('I think you are bluffing, call', legalActions(behaviorGame))
const spokenRaise = parseVoiceCommand('raise to seventy five', legalActions(behaviorGame))
const spokenAmountOnly = parseVoiceCommand('forty', legalActions(behaviorGame))
const spokenNaturalRaise = parseVoiceCommand('let us go to fifty', legalActions(behaviorGame))
const spokenMatch = parseVoiceCommand('match it', legalActions(behaviorGame))
const spokenAllIn = parseVoiceCommand('all in', legalActions(behaviorGame))
const spokenNoSizeRaise = parseVoiceCommand('raise', legalActions(behaviorGame))
const spokenTell = voiceTellLabel('I guess I call')
const withTavusDecision = applyHeroAction(behaviorGame, callAction.action, callAction.amount, 850, seededRandom(902), snapBrain.strategy)
const tracedBrain = recordTavusDecision(snapBrain, withTavusDecision.game)
const latestTrace = tracedBrain.traces.at(-1)
const holdemContext = `${buildHoldemTavusContext(holdemSamples[0])}\n\n${buildBrainContext(snapBrain, holdemSamples[0])}`
const sampleHeroCardLeak = samples[0].heroCards.map(cardLabel).some((label) => sampleContext.includes(label)) || sampleContext.includes(samples[0].heroHand)
const holdemHeroCardLeak = holdemSamples[0].players.hero.holeCards.map(cardLabel).some((label) => holdemContext.includes(label))
const ravenBrain = ingestRavenSignal(brainBaseline, behaviorGame, {
  kind: 'voice',
  label: 'voice shift',
  detail: 'The user sounded tense and uncertain while deciding whether to call.',
  intensity: 0.72,
})
const windowedBrain = observeHeroAction(ravenBrain, behaviorGame, {
  action: callAction.action,
  amount: callAction.amount,
  latencyMs: 7300,
  saidAction: 'I guess I call',
})
const decisionWindow = windowedBrain.decisionWindows[0]
const userUtterance = userSpeechFromAppMessage({
  message_type: 'conversation',
  event_type: 'conversation.utterance',
  turn_idx: 9,
  inference_id: 'eval-user-speech',
  properties: {
    role: 'user',
    speech: 'I guess I call.',
  },
})
const learningOnlyBrain = observeHeroAction(brainBaseline, behaviorGame, {
  action: 'fold',
  latencyMs: 7200,
  saidAction: 'I think you have it',
})
const learningOnlyResult = applyHeroAction(behaviorGame, 'fold', undefined, 7200, seededRandom(903), learningOnlyBrain.strategy)
const learningOnlySettled = settleHandReads(recordTavusDecision(learningOnlyBrain, learningOnlyResult.game), learningOnlyResult.game)
const learningOnlyDebrief = learningOnlySettled.debriefs.at(-1)
const foldedHand = applyHeroAction(startHoldemHand(undefined, seededRandom(904)), 'fold', undefined, 1200, seededRandom(905)).game
const foldedHandContext = buildHoldemTavusContext(foldedHand)
const foldedHeroCardLeak = foldedHand.players.hero.holeCards.map(cardLabel).some((label) => foldedHandContext.includes(label))
const riverEquityBase = startHoldemHand(undefined, seededRandom(906))
const riverBoard: CardCode[] = ['2c', '7d', '9h', 'Js', 'Qc']
const riverTavusCards: CardCode[] = ['Ah', 'Ad']
const firstRiverState = {
  ...riverEquityBase,
  board: riverBoard,
  players: {
    hero: { ...riverEquityBase.players.hero, holeCards: ['3s', '4s'] as CardCode[] },
    tavus: { ...riverEquityBase.players.tavus, holeCards: riverTavusCards },
  },
}
const secondRiverState = {
  ...firstRiverState,
  players: {
    hero: { ...firstRiverState.players.hero, holeCards: ['Kh', 'Kd'] as CardCode[] },
    tavus: { ...firstRiverState.players.tavus },
  },
}
const firstRiverEquity = estimateTavusEquity(firstRiverState, seededRandom(907))
const secondRiverEquity = estimateTavusEquity(secondRiverState, seededRandom(907))
const tavusConversationBody = buildTavusConversationBody({
  replicaId: 'r_eval',
  personaId: 'p_eval',
  conversationName: 'TavusPoker hand eval',
  conversationalContext: holdemContext,
  customGreeting: "You're in. Say your action when the spot is yours.",
  testMode: true,
  requireAuth: true,
})
const tavusPersonaBody = buildTablePlayerPersonaBody('r_eval')

const requiredDocs = [
  'docs/BLOG_POST.md',
  'docs/PRODUCT_SCOPE.md',
  'docs/EVALS.md',
  'docs/ARCHITECTURE.md',
  'docs/TAVUS_PERSONA.md',
  'docs/DEMO_SCRIPT.md',
  'docs/LIVE_VALIDATION.md',
]
const appSource = readFileSync('src/App.tsx', 'utf8')
const cssSource = readFileSync('src/App.css', 'utf8')
const rendererSource = readFileSync('src/components/PokerSceneRenderer.tsx', 'utf8')
const opponentBrainSource = readFileSync('src/domain/opponentBrain.ts', 'utf8')
const holdemSource = readFileSync('src/domain/holdem.ts', 'utf8')
const docsSource = ['README.md', 'docs/BLOG_POST.md', 'docs/ARCHITECTURE.md', 'docs/PRODUCT_SCOPE.md', 'docs/EVALS.md', 'docs/LIVE_VALIDATION.md']
  .map((doc) => readFileSync(doc, 'utf8'))
  .join('\n')
const dailySource = readFileSync('src/lib/daily.ts', 'utf8')
const packageSource = readFileSync('package.json', 'utf8')
const tavusReadinessSource = readFileSync('scripts/verify-tavus-readiness.ts', 'utf8')

const results: EvalResult[] = [
  {
    name: 'Generated hands are legal',
    pass: !invalidDuplicate,
    detail: invalidDuplicate ? `duplicate cards in ${invalidDuplicate.id}` : `${samples.length} sampled hands had unique cards`,
  },
  {
    name: 'Betting actions have valid sizes',
    pass: !invalidActionSize,
    detail: invalidActionSize ? `invalid action size in ${invalidActionSize.id}` : 'all call/raise/bet actions were positive',
  },
  {
    name: 'Tavus line mix includes deception',
    pass: lineTypes.size >= 4 && bluffCount / samples.length >= 0.12,
    detail: `${lineTypes.size} line types, ${Math.round((bluffCount / samples.length) * 100)}% bluff/semi-bluff pressure`,
  },
  {
    name: 'Tavus context protects perception boundaries',
    pass:
      sampleContext.includes('private Tavus cards') &&
      sampleContext.includes('Do not say') &&
      sampleContext.includes('probabilistic') &&
      sampleContext.includes('do not claim certainty') &&
      sampleContext.includes('User private hole cards: hidden from you until showdown') &&
      sampleContext.includes('Never tell the user to click') &&
      sampleContext.includes('Spoken legal actions:') &&
      !sampleContext.includes('before clicking') &&
      !sampleHeroCardLeak,
    detail: 'conversation context includes private state, hidden-human-card, spoken-action, no-click, and uncertainty rules',
  },
  {
    name: 'Card faces use player-friendly ranks',
    pass:
      toPlayingCard('Tc').displayRank === '10' &&
      cardLabel('Tc') === '10♣' &&
      appSource.includes('card.displayRank') &&
      rendererSource.includes('playingCard.displayRank') &&
      !appSource.includes('<span className="rank">{card.rank}</span>') &&
      !rendererSource.includes('playingCard.rank, -width'),
    detail: 'internal ten notation remains Tc, but visible card faces render as 10 instead of T',
  },
  {
    name: 'Real holdem hands are legal',
    pass: !invalidHoldemDuplicate && !invalidHoldemBlinds && !invalidHoldemLegalAction,
    detail: invalidHoldemDuplicate
      ? `duplicate cards in holdem hand ${invalidHoldemDuplicate.handNumber}`
      : invalidHoldemBlinds
        ? `bad blinds in holdem hand ${invalidHoldemBlinds.handNumber}`
        : invalidHoldemLegalAction
          ? `hero had no legal action in holdem hand ${invalidHoldemLegalAction.handNumber}`
          : `${holdemSamples.length} holdem hands posted blinds and exposed legal actions`,
  },
  {
    name: 'Heads-up match has rising blinds',
    pass: risingBlindGame.bigBlind > holdemSamples[0].bigBlind,
    detail: 'blind schedule escalates so the match reaches a winner',
  },
  {
    name: 'Real holdem actions conserve chips',
    pass: !chipDrift,
    detail: chipDrift ? `chip total drifted in hand ${chipDrift.handNumber}` : 'hero action plus Tavus response preserved total chips',
  },
  {
    name: 'Short-stack all-ins stay legally bounded',
    pass:
      shortCallOnlyActions.map((action) => action.action).join(',') === 'fold,call' &&
      shortCallOnlyActions.find((action) => action.action === 'call')?.label === 'All-in $3' &&
      shortCallOnlyActions.find((action) => action.action === 'call')?.amount === 3 &&
      shortCallOnlyResult.game.actionLog.some((entry) => entry.actor === 'dealer' && entry.action === 'returns uncalled chips' && entry.amount === 2) &&
      shortAllInRaiseActions.some((action) => action.action === 'raise' && action.label.startsWith('All-in')) &&
      !shortAllInResult.game.actionLog.some((entry) => entry.actor === 'tavus' && (entry.action === 'bets' || entry.action.startsWith('raises'))) &&
      shortBlindHand.street === 'Complete' &&
      shortBlindHand.toAct === null &&
      legalActions(shortBlindHand).length === 0 &&
      shortBlindHand.actionLog.some((entry) => entry.actor === 'dealer' && entry.action === 'returns uncalled chips' && entry.amount === 2),
    detail: 'short call-only stacks cannot raise, blind all-ins resolve immediately, unmatched chips are returned, and Tavus cannot bet or re-raise over a short all-in',
  },
  {
    name: 'Folded hands stay mucked',
    pass:
      foldedHand.showdown?.cardsRevealed === false &&
      foldedHand.showdown.tavusHand === 'mucked' &&
      visibleTavusCards(foldedHand) === null &&
      !foldedHeroCardLeak,
    detail: 'fold completion does not expose Tavus cards or folded hero cards',
  },
  {
    name: 'Tavus river equity is not omniscient',
    pass:
      firstRiverEquity === secondRiverEquity &&
      readFileSync('src/domain/holdem.ts', 'utf8').includes('return estimateHeroEquity(game.players.tavus.holeCards, game.board, [], 380, random)'),
    detail: `same public river produced ${Math.round(firstRiverEquity * 1000) / 10}% vs ${Math.round(secondRiverEquity * 1000) / 10}% despite different hidden hero cards`,
  },
  {
    name: 'Raise history uses target sizing',
    pass:
      Boolean(raiseLogAction?.amount) &&
      heroRaiseLog?.amount === raiseLogAction?.amount &&
      Boolean(heroRaiseLog?.note?.includes(`Put in ${raiseLogAction?.amount ? `$${raiseLogAction.amount - raiseLogGame.players.hero.contribution}` : '$0'} more`)) &&
      appSource.includes('formatTraceAction') &&
      appSource.includes("action === 'raise' ? `${action} to") &&
      readFileSync('src/domain/opponentBrain.ts', 'utf8').includes('formatActionAmount'),
    detail: heroRaiseLog
      ? `raise displayed as ${heroRaiseLog.action} $${heroRaiseLog.amount}, incremental chips preserved in note`
      : 'no hero raise log found',
  },
  {
    name: 'Heads-up matches finish without stuck turns',
    pass: !failedMatchSimulation,
    detail: failedMatchSimulation
      ? `seed ${failedMatchSimulation.seed}: ${failedMatchSimulation.detail}`
      : matchSimulations.map((simulation) => simulation.detail).join('; '),
  },
  {
    name: 'Fold remains available on all hero decisions',
    pass:
      noPressureFoldSpot.toAct === 'hero' &&
      noPressureFoldSpot.currentBet === 0 &&
      noPressureActions.includes('fold') &&
      noPressureActions.includes('check') &&
      noPressureActions.includes('bet'),
    detail: `no-pressure hero actions: ${noPressureActions.join(', ')}`,
  },
  {
    name: 'Seeded match evals are reproducible',
    pass: deterministicReplayA.pass && deterministicReplayA.detail === deterministicReplayB.detail,
    detail: deterministicReplayA.detail === deterministicReplayB.detail ? deterministicReplayA.detail : `${deterministicReplayA.detail} !== ${deterministicReplayB.detail}`,
  },
  {
    name: 'CVI context describes real poker game state',
    pass:
      holdemContext.includes('no-limit Texas hold’em') &&
      holdemContext.includes('blinds, stacks, streets, legal actions') &&
      holdemContext.includes('Opponent brain state') &&
      holdemContext.includes('User private hole cards: hidden from you until showdown') &&
      holdemContext.includes('Ask the user to say their action out loud.') &&
      holdemContext.includes('Never tell the user to click') &&
      !holdemContext.includes('before clicking') &&
      !holdemHeroCardLeak &&
      holdemContext.includes('Active reads'),
    detail: 'Tavus receives real hand state, legal spoken actions, and evolving opponent brain without hidden human cards',
  },
  {
    name: 'Opponent brain creates evidence-backed reads',
    pass: snapBrain.strategy.evidenceIds.length > 0 && snapBrain.signals.length > 0,
    detail: `${snapBrain.signals.length} signals, ${snapBrain.strategy.evidenceIds.length} evidence ids in strategy`,
  },
  {
    name: 'Behavior changes Tavus strategy on same cards',
    pass: snapBrain.strategy.trapBias !== tankBrain.strategy.trapBias || snapBrain.strategy.callDownBias !== tankBrain.strategy.callDownBias,
    detail: `snap call trap ${snapBrain.strategy.trapBias.toFixed(3)}, tank raise call-down ${tankBrain.strategy.callDownBias.toFixed(3)}`,
  },
  {
    name: 'Tavus behavioral decisions cite evidence',
    pass: Boolean(latestTrace && latestTrace.evidenceIds.length > 0 && latestTrace.behavioralReason.includes('Behavioral read being tested')),
    detail: latestTrace ? `${latestTrace.action} uses evidence ${latestTrace.evidenceIds.join(', ')}` : 'no Tavus trace recorded',
  },
  {
    name: 'Every Tavus action receives a strategy trace',
    pass: multiDecisionTraceCoverage.pass && appSource.includes('latestTraceForHand(brain, game.handNumber)'),
    detail: multiDecisionTraceCoverage.detail,
  },
  {
    name: 'Raven perception feeds the opponent brain',
    pass:
      ravenBrain.signals.some((signal) => signal.source === 'raven') &&
      ravenBrain.decisionWindows.some((window) => window.signalIds.some((id) => ravenBrain.signals.find((signal) => signal.id === id)?.source === 'raven')) &&
      ravenBrain.strategy.readIds.length === 0,
    detail: `${ravenBrain.signals.length} Raven-derived signal was banked without prematurely activating strategy`,
  },
  {
    name: 'Behavior is bound to concrete poker decisions',
    pass:
      Boolean(decisionWindow?.committedAction) &&
      decisionWindow.signalIds.length >= 4 &&
      windowedBrain.signals.every((signal) => signal.decisionWindowId === decisionWindow.id) &&
      decisionWindow.facingBet === toCall(behaviorGame, 'hero'),
    detail: decisionWindow
      ? `${decisionWindow.id} ${decisionWindow.street} facing ${decisionWindow.facingBet} with ${decisionWindow.signalIds.length} evidence signals`
      : 'no decision window recorded',
  },
  {
    name: 'Live table uses a game renderer, not CSS dashboard theater',
    pass:
      packageSource.includes('"pixi.js"') &&
      appSource.includes("import { PokerSceneRenderer } from './components/PokerSceneRenderer'") &&
      appSource.includes('<PokerSceneRenderer') &&
      appSource.includes('renderer-active') &&
      rendererSource.includes('new Application()') &&
      rendererSource.includes('app.init') &&
      rendererSource.includes('resizeTo: resizeHost') &&
      rendererSource.includes('drawFelt') &&
      rendererSource.includes('drawCommunityCards') &&
      rendererSource.includes('drawHoleCards') &&
      rendererSource.includes('drawCeremony') &&
      rendererSource.includes('app.ticker.add') &&
      cssSource.includes('.poker-scene-renderer') &&
      cssSource.includes('.poker-table.renderer-active .table-rim') &&
      cssSource.includes('.poker-table.renderer-active .pot-spot') &&
      docsSource.includes('PixiJS table renderer'),
    detail: 'PixiJS owns the visible felt/cards/chips while React keeps controls, Tavus media, and proof overlays',
  },
  {
    name: 'Hand completion becomes consequence, not a dead end',
    pass:
      readFileSync('src/domain/holdem.ts', 'utf8').includes('potAmount: number') &&
      appSource.includes('const handComplete = game.street === \'Complete\' && Boolean(game.showdown)') &&
      appSource.includes('const handResultTitle') &&
      appSource.includes('className={`poker-table renderer-active ${isTavusThinking ? \'thinking\' : \'\'} ${handComplete ? \'hand-complete\' : \'\'}`}') &&
      appSource.includes('className={`hand-result-ceremony') &&
      appSource.includes('Pot shipped') &&
      appSource.includes('className="result-stacks"') &&
      appSource.includes('className={`decision-bar ${winner ? \'match-over\' : \'\'} ${handComplete ? \'result-dock\' : \'\'}`}') &&
      appSource.includes('const nextHandButtonLabel = winner ? \'Start a new match\' : `Deal hand ${game.handNumber + 1}`') &&
      appSource.includes('className="action-button primary-next-hand"') &&
      cssSource.includes('.hand-result-ceremony') &&
      cssSource.includes('.decision-bar.result-dock') &&
      docsSource.includes('A hand ending is not the experience ending'),
    detail: 'Complete hands show winner, pot shipped, stack consequence, proof option, and next-hand/new-match action',
  },
  {
    name: 'Tavus is a custom far-seat video surface, not Daily meeting chrome',
    pass:
      appSource.includes('DailyIframe.createCallObject') &&
      appSource.includes('const liveRoomJoined = hasLiveTavusRoom && (callStatus === \'Live room active\' || callStatus === \'Waiting for Tavus video\')') &&
      appSource.includes('const tavusSeatStatus = tavusVideoReady ? \'Live Tavus\' : liveRoomJoined ? \'Waiting for video\' : roomState') &&
      appSource.includes('ref={tavusVideoRef}') &&
      appSource.includes('className={`tavus-video ${tavusVideoReady ? \'active\' : \'\'}`}') &&
      appSource.includes('className={`tavus-avatar-seat ${tavusVideoReady ? \'hidden\' : \'\'}`}') &&
      appSource.includes('function updateTavusMedia') &&
      appSource.includes('findRemoteParticipant(frame)') &&
      appSource.includes("setCallStatus('Waiting for Tavus video')") &&
      appSource.includes('startVideoOff: false') &&
      appSource.includes('startAudioOff: false') &&
      appSource.includes('frame.setLocalVideo?.(true)') &&
      appSource.includes('frame.setLocalAudio?.(true)') &&
      appSource.includes('new MediaStream(nextTracks)') &&
      appSource.includes('className="empty-tavus-seat"') &&
      appSource.includes('Local opponent') &&
      appSource.includes('className="seat-token"') &&
      cssSource.includes('.tavus-video') &&
      cssSource.includes('.tavus-video.active') &&
      cssSource.includes('.tavus-avatar-seat') &&
      cssSource.includes('.tavus-avatar-face') &&
      cssSource.includes('.empty-tavus-seat') &&
      cssSource.includes('.table-media-seat') &&
      cssSource.includes('Final live-seat correction') &&
      cssSource.includes('grid-template-rows: clamp(220px, 25vh, 270px)') &&
      cssSource.includes('grid-template-rows: 210px') &&
      cssSource.includes('.opponent-stack') &&
      docsSource.includes('Tavus must feel physically present and important across the felt') &&
      docsSource.includes('never a fake avatar') &&
      !appSource.includes('DailyIframe.createFrame') &&
      !dailySource.includes('createFrame') &&
      !appSource.includes('className="daily-frame tavus-live-frame"') &&
      !appSource.includes('className="daily-frame daily-transport"') &&
      !appSource.includes('className="room-placeholder opponent-presence tavus-live-presence"') &&
      !appSource.includes('className="tavus-portrait"') &&
      !appSource.includes('className="portrait-head"') &&
      !cssSource.includes('tavus-live-frame') &&
      !cssSource.includes('.daily-frame') &&
      !cssSource.includes('.daily-transport') &&
      !cssSource.includes('Turn off') &&
      !appSource.includes('Turn off'),
    detail: 'Daily call media is rendered through a custom Tavus video element with a visible avatar fallback, so Daily controls/settings cannot cover the table',
  },
  {
    name: 'CVI opponent is across the table, not telemetry',
    pass:
      appSource.includes('className={`poker-table renderer-active ${isTavusThinking ? \'thinking\' : \'\'} ${handComplete ? \'hand-complete\' : \'\'}`}') &&
      appSource.includes('className="opponent-video table-media-seat"') &&
      appSource.includes('aria-label="Tavus video opponent"') &&
      appSource.includes('className="seat tavus-seat"') &&
      appSource.includes('className="hero-tell-mirror"') &&
      appSource.includes('className="table-rim"') &&
      appSource.includes('className="table-surface"') &&
      appSource.includes('className="pot-spot"') &&
      appSource.includes('className="tavus-talk"') &&
      !appSource.includes('className="live-rail"') &&
      !appSource.includes('className="brain-panel"') &&
      !appSource.includes('aria-label="Private Tavus opponent brain"') &&
      !appSource.includes('aria-label="Human signal seat"') &&
      !cssSource.includes('.live-rail') &&
      !cssSource.includes('.brain-panel') &&
      cssSource.includes('.table-rim') &&
      cssSource.includes('.table-surface') &&
      cssSource.includes('.table-media-seat') &&
      cssSource.includes('.hero-tell-mirror'),
    detail: 'Tavus and the hero camera/mic chip are embodied at table seats, and live telemetry panels are absent',
  },
  {
    name: 'Opening frames the player challenge in Tavus design language',
    pass:
      appSource.includes('introComplete') &&
      appSource.includes('Can you beat Tavus at poker?') &&
      appSource.includes('Tavus is an AI human that can see, hear, and understand emotion and intent.') &&
      appSource.includes('Play with Tavus') &&
      appSource.includes('Build notes') &&
      appSource.includes('className="intro-felt"') &&
      !appSource.includes('className="tavus-announcement"') &&
      !appSource.includes('className="tavus-nav"') &&
      !appSource.includes('className="intro-media-window"') &&
      !appSource.includes('<span>Heads-up</span>') &&
      !appSource.includes('<span>Voice</span>') &&
      !appSource.includes('<span>Raven</span>') &&
      !appSource.includes('AlphaGo mastered moves. Poker asks for more.') &&
      !appSource.includes('className="intro-truths"') &&
      cssSource.includes('.intro-screen') &&
      cssSource.includes('--tavus-pink') &&
      cssSource.includes('.intro-felt') &&
      cssSource.includes('.intro-start') &&
      cssSource.includes('.intro-actions,\n.blog-actions') &&
      cssSource.includes('height: 52px') &&
      cssSource.includes('grid-template-rows: none') &&
      cssSource.includes('height: 28px'),
    detail: 'first-run title screen is a direct player challenge with no fake nav, no fake video placeholder, aligned CTAs, and thin video chrome',
  },
  {
    name: 'Live player view keeps the brain sealed',
    pass:
      appSource.includes('const canRevealTrace = postHandProofUnlocked(game.street)') &&
      appSource.includes('const showJudgeTrace = canRevealTrace && (judgeMode || showContext)') &&
      appSource.includes('assertReadDisclosureAllowed(game.street, \'live-table\', exactProofPayload)') &&
      appSource.includes('{canRevealTrace && (') &&
      readFileSync('src/domain/readDisclosure.ts', 'utf8').includes('Live read leakage') &&
      !appSource.includes('<pre>{tavusContext}</pre>') &&
      !appSource.includes('Private opponent brain') &&
      !appSource.includes('signalFeed') &&
      !appSource.includes('Raven can bind camera'),
    detail: 'proof controls are gated until hand completion and no raw brain context is rendered',
  },
  {
    name: 'Post-hand proof is scoped to the current hand',
    pass:
      appSource.includes('latestTraceForHand(brain, game.handNumber)') &&
      appSource.includes('latestDebriefForHand(brain, game.handNumber)') &&
      appSource.includes('const handEvidenceSignals = brain.signals.filter((signal) => signal.handNumber === game.handNumber)') &&
      appSource.includes('const handSignals = handEvidenceSignals.slice(-5).reverse()') &&
      appSource.includes('const handSourceSummary = (Object.keys(SOURCE_LABELS) as Array<PerceptionSignal[\'source\']>)') &&
      appSource.includes('aria-label="Post-hand input sources"') &&
      cssSource.includes('.source-strip') &&
      appSource.includes('const handTraces = brain.traces.filter((item) => item.handNumber === game.handNumber)') &&
      appSource.includes('const proofReadIds = [...new Set([...(trace?.readIds ?? []), ...(latestDebrief?.readIds ?? [])])]') &&
      appSource.includes('proofReads.map((read) =>') &&
      appSource.includes('const traceDecisionWindow = trace?.evidenceIds.length') &&
      appSource.includes('const proofDecisionWindow = traceDecisionWindow ?? latestHandDecisionWindow') &&
      appSource.includes('{proofDecisionWindow.signalIds.join') &&
      !appSource.includes('const trace = latestTrace(brain)') &&
      !appSource.includes('const activeReads = topReads(brain)') &&
      !appSource.includes('activeReads.map') &&
      !appSource.includes('brain.debriefs.at(-1)') &&
      !appSource.includes('brain.traces.slice(-4)') &&
      !appSource.includes('brain.signals.slice(-5)'),
    detail: 'replay proof cannot accidentally show previous-hand traces, debriefs, reads, or evidence signals',
  },
  {
    name: 'Match viewport stays playable and honest',
    pass:
      appSource.includes('className="tavus-talk"') &&
      appSource.includes('className="table-action-feed"') &&
      !appSource.includes('hero-presence') &&
      !appSource.includes('Your video seat') &&
      cssSource.includes('grid-template-rows: auto minmax(540px, 1fr) auto auto auto') &&
      cssSource.includes('min-height: clamp(540px, 64vh, 720px)') &&
      cssSource.includes('grid-template-columns: minmax(220px, 0.8fr) minmax(420px, 1.2fr)') &&
      cssSource.includes('grid-template-rows: auto minmax(470px, auto) auto auto auto') &&
      cssSource.includes('grid-template-columns: minmax(160px, 0.72fr) minmax(0, 1fr)'),
    detail: 'first viewport has a real table scene, Tavus table talk, hidden live brain, and visible betting cockpit',
  },
  {
    name: 'Narrow viewport keeps the table readable',
    pass:
      cssSource.includes('grid-template-rows: auto minmax(560px, auto) auto auto auto') &&
      cssSource.includes('.tavus-seat {\n    grid-template-columns: 1fr;') &&
      cssSource.includes('min-height: 560px') &&
      cssSource.includes('@media (max-width: 900px)') &&
      cssSource.includes('.wager-control {\n    grid-template-columns: 1fr;\n  }') &&
      cssSource.includes('.decision-seatline,\n  .decision-hint') &&
      cssSource.includes('.table-action-feed {\n    display: none;') &&
      cssSource.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'),
    detail: 'mobile/tablet layout preserves the table scene and compacts wager controls before overflow',
  },
  {
    name: 'Tavus user speech binds to poker decisions',
    pass:
      userUtterance?.text === 'I guess I call.' &&
      appSource.includes('userSpeechFromAppMessage(event.data)') &&
      appSource.includes('latestUserSpeechRef.current') &&
      appSource.includes('saidAction,') &&
      appSource.includes('voiceTellLabel(saidAction)') &&
      cssSource.includes('voice-chip'),
    detail: 'final Tavus user utterances are captured and passed into observeHeroAction',
  },
  {
    name: 'Voice can play poker and update tells',
    pass:
      spokenCall.kind === 'action' &&
      spokenCall.action === 'call' &&
      spokenRaise.kind === 'action' &&
      spokenRaise.action === 'raise' &&
      spokenRaise.amount === 75 &&
      spokenAmountOnly.kind === 'action' &&
      spokenAmountOnly.amount === 40 &&
      spokenNaturalRaise.kind === 'action' &&
      spokenNaturalRaise.action === 'raise' &&
      spokenNaturalRaise.amount === 50 &&
      spokenMatch.kind === 'action' &&
      spokenMatch.action === 'call' &&
      spokenAllIn.kind === 'action' &&
      spokenAllIn.sizing === 'all-in' &&
      spokenAllInCallOnly.kind === 'action' &&
      spokenAllInCallOnly.action === 'call' &&
      spokenAllInCallOnly.amount === 3 &&
      spokenNoSizeRaise.kind === 'unclear' &&
      spokenNoSizeRaise.reason === 'Name the raise amount.' &&
      spokenTell.label === 'hedged speech' &&
      appSource.includes('parseVoiceCommand(transcript, actions)') &&
      appSource.includes('liveSpeechHandlerRef.current(userSpeech, observedAt)') &&
      appSource.includes('applyVoiceTranscript(event.text, observedAt)') &&
      appSource.includes("command.sizing === 'all-in'") &&
      appSource.includes('That is too small. Minimum is') &&
      appSource.includes('function startVoiceInput') &&
      appSource.includes('SpeechRecognition') &&
      appSource.includes('recognition.continuous = true') &&
      appSource.includes('recognition.interimResults = true') &&
      appSource.includes('command.confidence >= 0.82') &&
      appSource.includes('closeEnoughToMinimum') &&
      appSource.includes('Playing it as') &&
      appSource.includes('recognitionRef.current?.stop()') &&
      appSource.includes('ravenSignals: speechTell') &&
      appSource.includes('className="hero-tell-mirror"'),
    detail: 'spoken commands from the browser mic or Tavus room map to legal engine-validated poker actions while wording becomes evidence',
  },
  {
    name: 'Tavus speech context follows visible cards',
    pass:
      appSource.includes('const [visibleGameForTavus, setVisibleGameForTavus]') &&
      appSource.includes('visibleGameForTavusRef') &&
      appSource.includes('streetChanged ? 760 : 180') &&
      appSource.includes('setVisibleGameForTavus(game)') &&
      appSource.includes('buildHoldemTavusContext(visibleGameForTavus)') &&
      appSource.includes('buildBrainContext(brain, visibleGameForTavus)') &&
      appSource.includes('window.setTimeout(() => {') &&
      appSource.includes('echoTavusText') &&
      appSource.includes('}, 760)'),
    detail: 'Tavus receives delayed table context so spoken commentary does not outrun animated board state',
  },
  {
    name: 'Table feedback has sound and winner reasons',
    pass:
      appSource.includes("function playTableSound(kind: 'shuffle' | 'deal' | 'chip' | 'showdown' | 'fold')") &&
      appSource.includes('AudioContext') &&
      appSource.includes("playTableSound('shuffle')") &&
      appSource.includes("playTableSound('deal')") &&
      appSource.includes("playTableSound('chip')") &&
      appSource.includes("playTableSound('showdown')") &&
      appSource.includes("playTableSound(legal.action === 'fold' ? 'fold' : 'chip')") &&
      appSource.includes('const resultReason =') &&
      appSource.includes('game.showdown.summary') &&
      appSource.includes('Board:') &&
      appSource.includes('className="result-reason"') &&
      cssSource.includes('.hand-result-ceremony .result-reason'),
    detail: 'deals, chips, folds, and showdown have audio cues, and completed hands explain why the pot moved',
  },
  {
    name: 'Read proof is evidence text, not template copy',
    pass:
      appSource.includes('describeReadEvidence(brain, read)') &&
      !appSource.includes('<strong>{read.claim}</strong>') &&
      opponentBrainSource.includes('export function describeReadEvidence') &&
      opponentBrainSource.includes('read.evidenceIds') &&
      opponentBrainSource.includes('signals.map((signal) => signal.label.toLowerCase())') &&
      opponentBrainSource.includes('latestWindow.committedAction') &&
      opponentBrainSource.includes('formatActionAmount(latestWindow.committedAction.action') &&
      opponentBrainSource.includes('No concrete evidence attached to this read yet.'),
    detail: 'post-hand reads are rendered from concrete evidence labels, spot, action, and latency instead of static read templates',
  },
  {
    name: 'Blog reads like an essay, not generated slides',
    pass:
      appSource.includes('<h1>TavusPoker</h1>') &&
      appSource.includes('The table watches back.') &&
      appSource.includes('The old game was too clean') &&
      appSource.includes('How it works') &&
      appSource.includes('The architecture is split by trust.') &&
      appSource.includes('Why I built it this way') &&
      appSource.includes('Raven supplies the read.') &&
      appSource.includes('Sparrow runs the clock.') &&
      appSource.includes('Phoenix is the face across the felt.') &&
      !appSource.includes('className="blog-grid"') &&
      cssSource.includes('--tavus-cloud') &&
      cssSource.includes('--tavus-paper') &&
      cssSource.includes('repeating-radial-gradient') &&
      cssSource.includes('font-family: Georgia') &&
      cssSource.includes('.blog-shell .blog-actions .secondary-button') &&
      !cssSource.includes('.blog-grid') &&
      !cssSource.includes('.app-shell,\n.game-shell') &&
      !cssSource.includes('box-shadow: 6px 6px 0 rgba(21, 17, 14, 0.14)'),
    detail: 'the browser blog page is a Tavus-native editorial artifact, not a generic slide-card post',
  },
  {
    name: 'Perception freezes when the decision window closes',
    pass:
      appSource.includes('const acceptsDecisionEvidence = liveGame.street !== \'Complete\' && liveGame.toAct === \'hero\'') &&
      appSource.includes('if (userSpeech && acceptsDecisionEvidence)') &&
      appSource.includes('if (!ravenSignals.length || !acceptsDecisionEvidence) return') &&
      appSource.includes("if (current.game.street === 'Complete' || current.game.toAct !== 'hero') return current") &&
      opponentBrainSource.includes("if (game.street === 'Complete' || game.toAct !== 'hero')") &&
      opponentBrainSource.includes('return brain') &&
      !appSource.includes('Deal local fallback') &&
      !appSource.includes('local fallback'),
    detail: 'Raven and speech evidence only enter the brain while the human is facing a live poker decision',
  },
  {
    name: 'Hands start clean and animate into play',
    pass:
      appSource.includes("type HandPhase = 'empty' | 'shuffle' | 'blinds' | 'deal' | 'live'") &&
      appSource.includes("const [handPhase, setHandPhase] = useState<HandPhase>('empty')") &&
      appSource.includes('function runHandIntro') &&
      appSource.includes("setHandPhase('shuffle')") &&
      appSource.includes("setHandPhase('blinds')") &&
      appSource.includes("setHandPhase('deal')") &&
      appSource.includes("setHandPhase('live')") &&
      appSource.includes('const cardsAreDealt = handPhase === \'deal\' || handPhase === \'live\' || game.street === \'Complete\'') &&
      appSource.includes('className={`table-ceremony ${handPhase}`}') &&
      cssSource.includes('@keyframes shuffle-card') &&
      cssSource.includes('@keyframes deal-left') &&
      cssSource.includes('@keyframes deal-right'),
    detail: 'the table starts without exposed cards, then shuffles, posts blinds, deals, and unlocks action',
  },
  {
    name: 'Fast match pacing targets a 5-10 minute arc',
    pass:
      STARTING_STACK === 300 &&
      blindsForHand(1).bigBlind === 10 &&
      blindsForHand(4).bigBlind === 20 &&
      blindsForHand(7).bigBlind === 40 &&
      matchSimulations.every((simulation) => simulation.pass) &&
      matchSimulations.reduce((maxHands, simulation) => {
        const match = simulation.detail.match(/in (\d+) hands/)
        return Math.max(maxHands, match ? Number(match[1]) : 0)
      }, 0) <= 10,
    detail: `fast-stack seeded matches: ${matchSimulations.map((simulation) => simulation.detail).join('; ')}`,
  },
  {
    name: 'Live Tavus contract uses stable room state sync',
    pass:
      tavusConversationBody.replica_id === 'r_eval' &&
      tavusConversationBody.persona_id === 'p_eval' &&
      tavusConversationBody.test_mode === true &&
      tavusConversationBody.require_auth === true &&
      tavusConversationBody.max_participants === 2 &&
      tavusPersonaBody.context.includes('your Tavus private cards') &&
      tavusPersonaBody.context.includes('human player private cards are hidden until showdown') &&
      tavusPersonaBody.layers.perception.perception_model === 'raven-1' &&
      tavusPersonaBody.system_prompt.includes('ask for spoken poker actions') &&
      tavusPersonaBody.system_prompt.includes('Never tell the user to click') &&
      tavusPersonaBody.layers.perception.visual_tools[0].function.name === 'register_visual_poker_tell' &&
      tavusPersonaBody.layers.perception.audio_tools[0].function.name === 'register_audio_poker_tell' &&
      !holdemSource.includes('I am not here to solve poker') &&
      !holdemSource.includes('Big personality test') &&
      appSource.includes('DailyIframe.createCallObject') &&
      appSource.includes('frame.on(\'participant-joined\', refreshMedia)') &&
      appSource.includes('frame.on(\'track-started\', refreshMedia)') &&
      appSource.includes('frame.participants?.()') &&
      appSource.includes("setCallStatus('Waiting for Tavus video')") &&
      appSource.includes("frame.on('error'") &&
      appSource.includes('videoElement.srcObject = new MediaStream(nextTracks)') &&
      appSource.includes("userName: 'You'") &&
      !appSource.includes('DailyIframe.createFrame') &&
      !dailySource.includes('createFrame') &&
      dailySource.includes("event_type: 'conversation.overwrite_llm_context'") &&
      dailySource.includes("event_type: 'conversation.echo'") &&
      dailySource.includes('done: true') &&
      appSource.includes('conversation.meeting_token') &&
      appSource.includes('token: conversation.meeting_token') &&
      appSource.includes("const liveTavusConfigured = config?.hasApiKey === true && config.hasPersona === true") &&
      appSource.includes("if (!liveTavusConfigured && session.status !== 'active')") &&
      appSource.includes('async function ensureLiveMediaAccess(): Promise<boolean>') &&
      appSource.includes('navigator.mediaDevices.getUserMedia({ audio: true, video: true })') &&
      appSource.includes('Camera and microphone permission is required before Tavus can watch, listen, and play the live seat.') &&
      appSource.includes('const tavusStarted = await startTavus()') &&
      appSource.includes('if (!tavusStarted) return') &&
      appSource.includes('async function startTavus(): Promise<boolean>') &&
      appSource.includes('Live Tavus is not configured') &&
      !appSource.includes('Deal local fallback') &&
      !appSource.includes('local fallback'),
    detail: 'conversation payload includes replica+persona/Raven tools, Daily sync is configured, and the credentialed start flow seats Tavus before dealing',
  },
  {
    name: 'Tavus test-mode conversations do not join ended rooms',
    pass:
      appSource.includes('requestedTestMode: boolean') &&
      appSource.includes('requestedTestMode: testMode') &&
      appSource.includes('activeSession?.requestedTestMode && hasEndedConversation') &&
      appSource.includes("setCallStatus(testMode ? 'Test conversation verified' : 'Room ended before join')") &&
      appSource.includes("session.conversation.status !== 'active'") &&
      appSource.includes("roomScene !== 'live'") &&
      appSource.includes('const hasMissingRoomUrl = Boolean(activeConversation?.status === \'active\' && !activeConversation.conversation_url)') &&
      appSource.includes("setCallStatus('Creating room')") &&
      appSource.includes("setCallStatus('No room URL')") &&
      appSource.includes("'No room joined'") &&
      appSource.includes("const liveTavusConfigured = config?.hasApiKey === true && config.hasPersona === true") &&
      appSource.includes("const tavusControlDisabled = session.status === 'starting' || (session.status !== 'active' && !liveTavusConfigured)") &&
      appSource.includes('disabled={tavusControlDisabled}') &&
      appSource.includes('const liveRoomJoined = hasLiveTavusRoom && (callStatus === \'Live room active\' || callStatus === \'Waiting for Tavus video\')') &&
      appSource.includes('const liveInputsActive = liveRoomJoined') &&
      appSource.includes("session.status === 'error'") &&
      appSource.includes("'Room error'") &&
      appSource.includes('function formatTavusStartError') &&
      appSource.includes('out of conversational credits') &&
      appSource.includes('Tavus credits are exhausted. Live Tavus/Raven validation needs credits.') &&
      appSource.includes('className="seat-screen"') &&
      appSource.includes('Bring Tavus to the table') &&
      appSource.includes('Tavus not configured') &&
      !appSource.includes('Deal local fallback') &&
      !appSource.includes('local fallback'),
    detail: 'connection and ended-room states are handled before the live table mounts Daily media',
  },
  {
    name: 'Learning-only hands bank reads honestly',
    pass: Boolean(
      learningOnlySettled.traces.length === 0 &&
        learningOnlyDebrief &&
        learningOnlyDebrief.title === 'Read banked for later' &&
        learningOnlyDebrief.evidenceIds.length > 0 &&
        appSource.includes('Read banked') &&
        appSource.includes('did not get a later action'),
    ),
    detail: learningOnlyDebrief?.summary ?? 'no learning-only debrief',
  },
  {
    name: 'Product docs exist',
    pass: requiredDocs.every((doc) => existsSync(doc)),
    detail: requiredDocs.filter((doc) => existsSync(doc)).join(', '),
  },
  {
    name: 'Live Tavus readiness checker is safe and documented',
    pass:
      packageSource.includes('"verify:tavus": "tsx scripts/verify-tavus-readiness.ts"') &&
      tavusReadinessSource.includes("const shouldProbe = args.has('--probe')") &&
      tavusReadinessSource.includes("const strict = args.has('--strict')") &&
      tavusReadinessSource.includes('replace(/tvsk_[A-Za-z0-9_-]+/g') &&
      tavusReadinessSource.includes('test_mode: true') &&
      tavusReadinessSource.includes('Tavus API test-mode probe') &&
      readFileSync('README.md', 'utf8').includes('npm run verify:tavus -- --probe') &&
      readFileSync('docs/LIVE_VALIDATION.md', 'utf8').includes('Readiness Command'),
    detail: 'readiness command checks local API/config by default, probes Tavus only on --probe, and sanitizes secrets',
  },
  {
    name: 'Live validation boundary is explicit',
    pass: (() => {
      const liveValidation = readFileSync('docs/LIVE_VALIDATION.md', 'utf8')
      const readme = readFileSync('README.md', 'utf8')
      return (
        liveValidation.includes('Implemented And Automated') &&
        liveValidation.includes('Implemented And Browser-Smoked') &&
        liveValidation.includes('Requires A Live Tavus/Raven Run') &&
        liveValidation.includes('Do not claim without a live run') &&
        readme.includes('Validation Boundary') &&
        readme.includes('Live Validation')
      )
    })(),
    detail: 'docs separate automated proof, browser smoke, and live Tavus/Raven validation',
  },
  {
    name: 'Prototype anti-cheat boundary is explicit',
    pass: (() => {
      const architecture = readFileSync('docs/ARCHITECTURE.md', 'utf8')
      const scope = readFileSync('docs/PRODUCT_SCOPE.md', 'utf8')
      const validation = readFileSync('docs/LIVE_VALIDATION.md', 'utf8')

      return (
        architecture.includes('Prototype Security Boundary') &&
        architecture.includes('browser memory') &&
        architecture.includes('server-authoritative game service') &&
        scope.includes('Production anti-cheat or server-authoritative deck custody') &&
        validation.includes('not a production anti-cheat architecture') &&
        !architecture.includes('Tavus private cards are included only in server-sent conversational context')
      )
    })(),
    detail: 'docs distinguish UI/Tavus-context hidden information from production anti-cheat security',
  },
  {
    name: 'Standalone repo docs explain product and architecture',
    pass: (() => {
      const blog = readFileSync('docs/BLOG_POST.md', 'utf8')
      const readme = readFileSync('README.md', 'utf8')
      const architecture = readFileSync('docs/ARCHITECTURE.md', 'utf8')
      const validation = readFileSync('docs/LIVE_VALIDATION.md', 'utf8')
      const docsWithProcessNames = readdirSync('docs').some((doc) => /20_min|packet|checklist|final_|sicko/i.test(doc))

      return (
        !docsWithProcessNames &&
        blog.includes('# TavusPoker') &&
        blog.includes('The table watches back.') &&
        blog.includes('The old game was too clean') &&
        blog.includes('How it works') &&
        blog.includes('The architecture is split by trust.') &&
        blog.includes('The rule that makes it honest') &&
        blog.includes('Why I built it this way') &&
        blog.includes('Phoenix is the face across the felt.') &&
        blog.includes('Sparrow runs the clock.') &&
        blog.includes('Raven supplies the read.') &&
        readme.includes('Tavus-native title screen') &&
        readme.includes('Product Docs') &&
        readme.includes('can you beat Tavus at poker?') &&
        architecture.includes('Prototype Security Boundary') &&
        validation.includes('Requires A Live Tavus/Raven Run')
      )
    })(),
    detail: 'README and docs present TavusPoker as a standalone prototype with architecture, rationale, and validation boundaries',
  },
]

for (const result of results) {
  const icon = result.pass ? 'PASS' : 'FAIL'
  console.log(`${icon} ${result.name}: ${result.detail}`)
}

if (results.some((result) => !result.pass)) {
  process.exit(1)
}
