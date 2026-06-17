import type { HoldemAction, HoldemGameState, HoldemStreet, PlayerId, TavusDecisionTrace, TavusStrategyInput } from './holdem'
import { toCall } from './holdem'
import { formatMoney, formatPercent } from './poker'

export type PerceptionSource = 'raven' | 'local-timing' | 'speech' | 'game-action' | 'showdown'
export type PerceptionKind = 'timing' | 'gaze' | 'expression' | 'voice' | 'transcript' | 'action' | 'result'
export type ReadStatus = 'testing' | 'strengthening' | 'weakened'

export type PerceptionSignal = {
  id: string
  decisionWindowId?: string
  handNumber: number
  street: HoldemStreet
  source: PerceptionSource
  kind: PerceptionKind
  label: string
  detail: string
  intensity: number
  observedAt: number
}

export type PlayerRead = {
  id: string
  claim: string
  confidence: number
  status: ReadStatus
  evidenceIds: string[]
  confirmedBy: string[]
  contradictedBy: string[]
  lastUpdatedHand: number
  strategy: Pick<TavusStrategyInput, 'bluffBias' | 'callDownBias' | 'pressureBias' | 'trapBias'>
}

export type DecisionWindow = {
  id: string
  handNumber: number
  street: HoldemStreet
  openedAt: number
  closedAt?: number
  facingBet: number
  pot: number
  currentBet: number
  minRaise: number
  heroStack: number
  tavusStack: number
  boardCards: number
  signalIds: string[]
  committedAction?: {
    action: HoldemAction
    amount?: number
    latencyMs: number
  }
}

export type BrainTableImage = {
  handsObserved: number
  aggression: number
  foldToPressure: number
  curiosity: number
  timingVolatility: number
}

export type TavusStrategyTrace = {
  id: string
  handNumber: number
  sequence: number
  street: HoldemStreet
  action: HoldemAction
  amount?: number
  line: TavusDecisionTrace['line']
  pokerReason: string
  behavioralReason: string
  confidence: number
  evidenceIds: string[]
  readIds: string[]
}

export type HandDebrief = {
  id: string
  handNumber: number
  winner: PlayerId | 'split'
  title: string
  summary: string
  evidenceIds: string[]
  readIds: string[]
}

export type OpponentBrainState = {
  signals: PerceptionSignal[]
  decisionWindows: DecisionWindow[]
  reads: PlayerRead[]
  tableImage: BrainTableImage
  strategy: TavusStrategyInput
  traces: TavusStrategyTrace[]
  debriefs: HandDebrief[]
}

export type HeroObservationInput = {
  action: HoldemAction
  amount?: number
  latencyMs: number
  saidAction?: string
  ravenSignals?: Array<Pick<PerceptionSignal, 'kind' | 'label' | 'detail' | 'intensity'>>
}

const READ_TEMPLATES: Record<
  string,
  Omit<PlayerRead, 'confidence' | 'status' | 'evidenceIds' | 'confirmedBy' | 'contradictedBy' | 'lastUpdatedHand'>
> = {
  'pressure-fold': {
    id: 'pressure-fold',
    claim: 'You may release hands when the bet feels personal.',
    strategy: { bluffBias: 0.1, callDownBias: 0, pressureBias: 0.16, trapBias: 0 },
  },
  'hesitation-bluff': {
    id: 'hesitation-bluff',
    claim: 'Long pauses before aggression may be bluff-heavy.',
    strategy: { bluffBias: 0, callDownBias: 0.16, pressureBias: 0.02, trapBias: 0 },
  },
  'snap-curiosity': {
    id: 'snap-curiosity',
    claim: 'Fast calls suggest you pay to resolve doubt.',
    strategy: { bluffBias: -0.02, callDownBias: 0, pressureBias: 0.02, trapBias: 0.1 },
  },
  'fast-aggression': {
    id: 'fast-aggression',
    claim: 'Fast aggression may be range-polarized.',
    strategy: { bluffBias: 0.03, callDownBias: 0.1, pressureBias: 0, trapBias: 0.04 },
  },
  'speech-commitment': {
    id: 'speech-commitment',
    claim: 'Your spoken action can harden into follow-through.',
    strategy: { bluffBias: 0.04, callDownBias: 0.04, pressureBias: 0.03, trapBias: 0 },
  },
}

export function createOpponentBrain(): OpponentBrainState {
  return {
    signals: [],
    decisionWindows: [],
    reads: Object.values(READ_TEMPLATES).map((template) => ({
      ...template,
      confidence: 0.2,
      status: 'testing',
      evidenceIds: [],
      confirmedBy: [],
      contradictedBy: [],
      lastUpdatedHand: 0,
    })),
    tableImage: {
      handsObserved: 0,
      aggression: 0.42,
      foldToPressure: 0.38,
      curiosity: 0.4,
      timingVolatility: 0.32,
    },
    strategy: neutralStrategy(),
    traces: [],
    debriefs: [],
  }
}

export function neutralStrategy(): TavusStrategyInput {
  return {
    bluffBias: 0,
    callDownBias: 0,
    pressureBias: 0,
    trapBias: 0,
    confidence: 0.32,
    readIds: [],
    evidenceIds: [],
    rationale: 'No behavioral read is active; Tavus is playing cards, price, and position.',
  }
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function formatActionAmount(action: HoldemAction, amount?: number): string {
  if (!amount) return action
  return action === 'raise' ? `${action} to ${formatMoney(amount)}` : `${action} ${formatMoney(amount)}`
}

function signalId(handNumber: number, count: number): string {
  return `h${handNumber}-s${count + 1}`
}

function decisionWindowId(game: HoldemGameState): string {
  return `h${game.handNumber}-${game.street.toLowerCase()}-${game.actionLog.length + 1}`
}

function readEvidence(read: PlayerRead, evidenceIds: string[]): string[] {
  return [...new Set([...read.evidenceIds, ...evidenceIds])].slice(-8)
}

function cloneBrain(brain: OpponentBrainState): OpponentBrainState {
  return {
    ...brain,
    signals: [...brain.signals],
    decisionWindows: brain.decisionWindows.map((window) => ({
      ...window,
      signalIds: [...window.signalIds],
      committedAction: window.committedAction ? { ...window.committedAction } : undefined,
    })),
    reads: brain.reads.map((read) => ({
      ...read,
      evidenceIds: [...read.evidenceIds],
      confirmedBy: [...read.confirmedBy],
      contradictedBy: [...read.contradictedBy],
    })),
    tableImage: { ...brain.tableImage },
    strategy: { ...brain.strategy, readIds: [...brain.strategy.readIds], evidenceIds: [...brain.strategy.evidenceIds] },
    traces: [...brain.traces],
    debriefs: [...brain.debriefs],
  }
}

function ensureDecisionWindow(brain: OpponentBrainState, game: HoldemGameState): DecisionWindow {
  const id = decisionWindowId(game)
  const existing = brain.decisionWindows.find((window) => window.id === id)
  if (existing) return existing

  const window: DecisionWindow = {
    id,
    handNumber: game.handNumber,
    street: game.street,
    openedAt: Date.now(),
    facingBet: toCall(game, 'hero'),
    pot: game.pot,
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    heroStack: game.players.hero.stack,
    tavusStack: game.players.tavus.stack,
    boardCards: game.board.length,
    signalIds: [],
  }

  brain.decisionWindows.push(window)
  return window
}

function attachSignalToDecision(brain: OpponentBrainState, decisionId: string, signalId: string) {
  brain.decisionWindows = brain.decisionWindows.map((window) =>
    window.id === decisionId ? { ...window, signalIds: [...new Set([...window.signalIds, signalId])] } : window,
  )
}

function closeDecisionWindow(
  brain: OpponentBrainState,
  decisionId: string,
  action: HoldemAction,
  amount: number | undefined,
  latencyMs: number,
) {
  brain.decisionWindows = brain.decisionWindows.map((window) =>
    window.id === decisionId
      ? {
          ...window,
          closedAt: Date.now(),
          committedAction: { action, amount, latencyMs },
        }
      : window,
  )
}

function updateRead(brain: OpponentBrainState, id: keyof typeof READ_TEMPLATES, delta: number, handNumber: number, evidenceIds: string[]) {
  brain.reads = brain.reads.map((read) => {
    if (read.id !== id) return read
    const confidence = clamp(read.confidence + delta, 0.08, 0.9)
    return {
      ...read,
      confidence,
      status: delta >= 0 ? (confidence >= 0.52 ? 'strengthening' : 'testing') : 'weakened',
      evidenceIds: readEvidence(read, evidenceIds),
      lastUpdatedHand: handNumber,
    }
  })
}

export function describeReadEvidence(brain: OpponentBrainState, read: PlayerRead): string {
  const signals = read.evidenceIds
    .map((id) => brain.signals.find((signal) => signal.id === id))
    .filter((signal): signal is PerceptionSignal => Boolean(signal))
    .slice(-3)

  if (!signals.length) return 'No concrete evidence attached to this read yet.'

  const labels = [...new Set(signals.map((signal) => signal.label.toLowerCase()))].slice(0, 3)
  const latestWindow = [...brain.decisionWindows]
    .reverse()
    .find((window) => window.signalIds.some((id) => read.evidenceIds.includes(id)))
  const action = latestWindow?.committedAction
    ? `${formatActionAmount(latestWindow.committedAction.action, latestWindow.committedAction.amount)} after ${Math.round(latestWindow.committedAction.latencyMs / 100) / 10}s`
    : 'no committed action yet'
  const spot = latestWindow ? `${latestWindow.street}, facing ${formatMoney(latestWindow.facingBet)}` : `hand ${read.lastUpdatedHand}`

  return `${labels.join(' + ')} in ${spot}; ${action}.`
}

function makeSignal(
  brain: OpponentBrainState,
  game: HoldemGameState,
  source: PerceptionSource,
  kind: PerceptionKind,
  label: string,
  detail: string,
  intensity: number,
  decisionId?: string,
): PerceptionSignal {
  return {
    id: signalId(game.handNumber, brain.signals.length),
    decisionWindowId: decisionId,
    handNumber: game.handNumber,
    street: game.street,
    source,
    kind,
    label,
    detail,
    intensity: clamp(intensity),
    observedAt: Date.now(),
  }
}

function timingSignalLabel(latencyMs: number): { label: string; intensity: number } {
  if (latencyMs > 6500) return { label: 'long tank', intensity: 0.82 }
  if (latencyMs < 1600) return { label: 'snap decision', intensity: 0.72 }
  return { label: 'measured timing', intensity: 0.42 }
}

function refreshTableImage(brain: OpponentBrainState, action: HoldemAction, facedPressure: boolean, latencyMs: number) {
  const next = { ...brain.tableImage }
  const fast = latencyMs < 1600
  const slow = latencyMs > 6500

  if (action === 'bet' || action === 'raise') {
    next.aggression = clamp(next.aggression + (fast ? 0.1 : 0.06))
  } else {
    next.aggression = clamp(next.aggression - 0.025)
  }

  if (facedPressure && action === 'fold') {
    next.foldToPressure = clamp(next.foldToPressure + 0.12)
  } else if (facedPressure && (action === 'call' || action === 'raise')) {
    next.foldToPressure = clamp(next.foldToPressure - 0.08)
  }

  if (action === 'call') {
    next.curiosity = clamp(next.curiosity + (fast ? 0.11 : 0.06))
  } else if (action === 'fold') {
    next.curiosity = clamp(next.curiosity - 0.04)
  }

  next.timingVolatility = clamp(next.timingVolatility + (fast || slow ? 0.08 : -0.03))
  brain.tableImage = next
}

export function observeHeroAction(
  brain: OpponentBrainState,
  game: HoldemGameState,
  input: HeroObservationInput,
): OpponentBrainState {
  const next = cloneBrain(brain)
  const window = ensureDecisionWindow(next, game)
  const decisionId = window.id
  const facedPressure = toCall(game, 'hero') > 0
  const { label, intensity } = timingSignalLabel(input.latencyMs)
  const timing = makeSignal(next, game, 'local-timing', 'timing', label, `${Math.round(input.latencyMs / 100) / 10}s before ${input.action}.`, intensity, decisionId)
  next.signals.push(timing)
  attachSignalToDecision(next, decisionId, timing.id)
  const pressure = facedPressure ? `facing ${formatMoney(toCall(game, 'hero'))}` : 'no bet faced'
  const actionSignal = makeSignal(
    next,
    game,
    'game-action',
    'action',
    `${input.action}${facedPressure ? ' under pressure' : ''}`,
    `${formatActionAmount(input.action, input.amount)} on ${game.street}, ${pressure}.`,
    facedPressure || input.action === 'bet' || input.action === 'raise' ? 0.72 : 0.42,
    decisionId,
  )
  next.signals.push(actionSignal)
  attachSignalToDecision(next, decisionId, actionSignal.id)

  if (input.saidAction?.trim()) {
    const speechSignal = makeSignal(
      next,
      game,
      'speech',
      'transcript',
      'spoken commitment',
      `Player said: "${input.saidAction.trim().slice(0, 90)}".`,
      0.5,
      decisionId,
    )
    next.signals.push(speechSignal)
    attachSignalToDecision(next, decisionId, speechSignal.id)
    updateRead(next, 'speech-commitment', 0.05, game.handNumber, [speechSignal.id])
  }

  for (const raven of input.ravenSignals ?? []) {
    const ravenSignal = makeSignal(next, game, 'raven', raven.kind, raven.label, raven.detail, raven.intensity, decisionId)
    next.signals.push(ravenSignal)
    attachSignalToDecision(next, decisionId, ravenSignal.id)
  }

  refreshTableImage(next, input.action, facedPressure, input.latencyMs)

  if (facedPressure && input.action === 'fold') {
    updateRead(next, 'pressure-fold', label === 'long tank' ? 0.18 : 0.12, game.handNumber, [timing.id, actionSignal.id])
  } else if (facedPressure && (input.action === 'call' || input.action === 'raise')) {
    updateRead(next, 'pressure-fold', -0.08, game.handNumber, [actionSignal.id])
  }

  if (label === 'long tank' && (input.action === 'bet' || input.action === 'raise')) {
    updateRead(next, 'hesitation-bluff', 0.16, game.handNumber, [timing.id, actionSignal.id])
  } else if (label === 'snap decision' && input.action === 'call') {
    updateRead(next, 'snap-curiosity', 0.15, game.handNumber, [timing.id, actionSignal.id])
  } else if (label === 'snap decision' && (input.action === 'bet' || input.action === 'raise')) {
    updateRead(next, 'fast-aggression', 0.14, game.handNumber, [timing.id, actionSignal.id])
  }

  closeDecisionWindow(next, decisionId, input.action, input.amount, input.latencyMs)
  next.strategy = buildTavusStrategy(next)
  return next
}

export function ingestRavenSignal(
  brain: OpponentBrainState,
  game: HoldemGameState,
  signal: Pick<PerceptionSignal, 'kind' | 'label' | 'detail' | 'intensity'>,
): OpponentBrainState {
  if (game.street === 'Complete' || game.toAct !== 'hero') {
    return brain
  }

  const next = cloneBrain(brain)
  const window = ensureDecisionWindow(next, game)
  const ravenEvidence = makeSignal(next, game, 'raven', signal.kind, signal.label, signal.detail, signal.intensity, window.id)
  const evidenceIds = [ravenEvidence.id]
  const combined = `${signal.kind} ${signal.label} ${signal.detail}`.toLowerCase()

  next.signals.push(ravenEvidence)
  attachSignalToDecision(next, window.id, ravenEvidence.id)

  if (/look away|gaze|avert|eye|pause|hesitat|uncertain/.test(combined)) {
    updateRead(next, 'hesitation-bluff', 0.18, game.handNumber, evidenceIds)
  }

  if (/tense|tension|stress|nervous|swallow|freeze|strained/.test(combined)) {
    updateRead(next, 'pressure-fold', 0.16, game.handNumber, evidenceIds)
  }

  if (/fast|quick|confident|steady|relaxed|snap/.test(combined)) {
    updateRead(next, 'fast-aggression', 0.14, game.handNumber, evidenceIds)
  }

  if (/curious|laugh|smile|call|see it/.test(combined)) {
    updateRead(next, 'snap-curiosity', 0.14, game.handNumber, evidenceIds)
  }

  next.strategy = buildTavusStrategy(next)
  return next
}

export function buildTavusStrategy(brain: OpponentBrainState): TavusStrategyInput {
  const committedEvidenceIds = new Set(
    brain.decisionWindows
      .filter((window) => Boolean(window.committedAction))
      .flatMap((window) => window.signalIds),
  )
  const activeReads = brain.reads
    .filter((read) => read.confidence >= 0.34 && read.evidenceIds.some((id) => committedEvidenceIds.has(id)))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)

  if (activeReads.length === 0) {
    return neutralStrategy()
  }

  const totals = activeReads.reduce(
    (acc, read) => ({
      bluffBias: acc.bluffBias + read.strategy.bluffBias * read.confidence,
      callDownBias: acc.callDownBias + read.strategy.callDownBias * read.confidence,
      pressureBias: acc.pressureBias + read.strategy.pressureBias * read.confidence,
      trapBias: acc.trapBias + read.strategy.trapBias * read.confidence,
    }),
    { bluffBias: 0, callDownBias: 0, pressureBias: 0, trapBias: 0 },
  )
  const evidenceIds = [...new Set(activeReads.flatMap((read) => read.evidenceIds))].slice(-6)
  const claims = activeReads.map((read) => `${describeReadEvidence(brain, read)} (${formatPercent(read.confidence)})`).join(' ')

  return {
    bluffBias: clamp(totals.bluffBias, -0.08, 0.24),
    callDownBias: clamp(totals.callDownBias, -0.04, 0.22),
    pressureBias: clamp(totals.pressureBias, -0.04, 0.24),
    trapBias: clamp(totals.trapBias, 0, 0.18),
    confidence: activeReads[0].confidence,
    readIds: activeReads.map((read) => read.id),
    evidenceIds,
    rationale: evidenceIds.length > 0 ? `Behavioral read being tested: ${claims}` : 'No behavioral read is active; Tavus is playing cards, price, and position.',
  }
}

export function recordTavusDecision(brain: OpponentBrainState, game: HoldemGameState): OpponentBrainState {
  const decisions = game.tavusDecisionLog
  if (decisions.length === 0) return brain

  const unrecorded = decisions.filter((decision) => !brain.traces.some((trace) => trace.handNumber === game.handNumber && trace.sequence === decision.sequence))
  if (unrecorded.length === 0) {
    return brain
  }

  return {
    ...brain,
    traces: [
      ...brain.traces,
      ...unrecorded.map((decision, index) => ({
        id: `h${game.handNumber}-t${brain.traces.length + index + 1}`,
        handNumber: game.handNumber,
        sequence: decision.sequence,
        street: decision.street,
        action: decision.action,
        amount: decision.amount,
        line: decision.line,
        pokerReason: decision.pokerReason,
        behavioralReason: decision.behavioralReason,
        confidence: decision.confidence,
        evidenceIds: decision.evidenceIds,
        readIds: decision.readIds,
      })),
    ],
  }
}

export function settleHandReads(brain: OpponentBrainState, game: HoldemGameState): OpponentBrainState {
  if (game.street !== 'Complete' || !game.showdown || brain.debriefs.some((debrief) => debrief.handNumber === game.handNumber)) {
    return brain
  }

  const next: OpponentBrainState = {
    ...brain,
    reads: brain.reads.map((read) => ({ ...read, confirmedBy: [...read.confirmedBy], contradictedBy: [...read.contradictedBy] })),
    tableImage: { ...brain.tableImage, handsObserved: brain.tableImage.handsObserved + 1 },
    debriefs: [...brain.debriefs],
  }
  const latestTrace = [...brain.traces].reverse().find((trace) => trace.handNumber === game.handNumber)
  const latestDecisionWindow = [...brain.decisionWindows].reverse().find((window) => window.handNumber === game.handNumber && window.committedAction)
  const learningEvidenceIds = latestDecisionWindow?.signalIds ?? brain.signals.filter((signal) => signal.handNumber === game.handNumber).map((signal) => signal.id)
  const evidenceIds = latestTrace?.evidenceIds.length ? latestTrace.evidenceIds : learningEvidenceIds
  const readIds = latestTrace?.readIds.length
    ? latestTrace.readIds
    : next.reads
        .filter((read) => read.lastUpdatedHand === game.handNumber && read.evidenceIds.some((id) => evidenceIds.includes(id)))
        .map((read) => read.id)
  const handKey = `hand-${game.handNumber}`
  let debriefTitle = 'No read yet'
  let debriefSummary = 'No behavioral evidence was captured on this hand.'

  if (latestTrace && latestTrace.evidenceIds.length) {
    debriefTitle =
      game.showdown.winner === 'tavus'
        ? 'Tavus won the read'
        : game.showdown.winner === 'hero'
          ? 'You beat the read'
          : 'The read stayed unresolved'
    debriefSummary = `Private read replay: ${latestTrace.behavioralReason} Poker reason: ${latestTrace.pokerReason} Evidence: ${evidenceIds.join(', ')}.`
  } else if (latestTrace) {
    debriefTitle = 'Cards-only Tavus action'
    debriefSummary = `Cards-only replay: Tavus took ${formatActionAmount(latestTrace.action, latestTrace.amount)} from poker state. No live tell was spent on that action.`
  } else if (evidenceIds.length) {
    debriefTitle = 'Read banked for later'
    debriefSummary = `Learning-only replay: this hand produced evidence ${evidenceIds.join(', ')}. Tavus did not get a later decision to spend that read yet, so it is banked for future spots.`
  }

  next.reads = next.reads.map((read) => {
    if (!readIds.includes(read.id)) return read
    const tavusSucceeded = game.showdown?.winner === 'tavus'
    return {
      ...read,
      confidence: clamp(read.confidence + (tavusSucceeded ? 0.05 : -0.05), 0.08, 0.9),
      status: tavusSucceeded ? 'strengthening' : 'weakened',
      confirmedBy: tavusSucceeded ? [...new Set([...read.confirmedBy, handKey])] : read.confirmedBy,
      contradictedBy: tavusSucceeded ? read.contradictedBy : [...new Set([...read.contradictedBy, handKey])],
    }
  })

  next.debriefs.push({
    id: handKey,
    handNumber: game.handNumber,
    winner: game.showdown.winner,
    title: debriefTitle,
    summary: debriefSummary,
    evidenceIds,
    readIds,
  })

  next.strategy = buildTavusStrategy(next)
  return next
}

export function buildBrainContext(brain: OpponentBrainState, game: HoldemGameState): string {
  const activeReads = brain.reads
    .filter((read) => read.confidence >= 0.4)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4)
  const recentSignals = brain.signals.slice(-6)
  const recentDecisionWindows = brain.decisionWindows
    .filter((window) => window.signalIds.length > 0 || window.committedAction)
    .slice(-3)
  const latestTrace = brain.traces.at(-1)

  return [
    'Opponent brain state:',
    `Match format: true 1v1 heads-up sit-and-go until one player has all chips. Blinds are now ${formatMoney(game.smallBlind)}/${formatMoney(game.bigBlind)}.`,
    `Table image: aggression ${formatPercent(brain.tableImage.aggression)}, fold-to-pressure ${formatPercent(brain.tableImage.foldToPressure)}, curiosity ${formatPercent(brain.tableImage.curiosity)}, timing volatility ${formatPercent(brain.tableImage.timingVolatility)}.`,
    activeReads.length
      ? `Active reads: ${activeReads.map((read) => `${describeReadEvidence(brain, read)} confidence ${formatPercent(read.confidence)} evidence ${read.evidenceIds.join(', ') || 'none yet'}`).join(' | ')}.`
      : 'Active reads: none above threshold yet. Test lightly and avoid certainty.',
    recentSignals.length
      ? `Recent perception/game signals: ${recentSignals.map((signal) => `${signal.id} ${signal.source}/${signal.kind}: ${signal.label} - ${signal.detail}`).join(' | ')}.`
      : 'Recent perception/game signals: none yet.',
    recentDecisionWindows.length
      ? `Recent decision windows: ${recentDecisionWindows
          .map((window) => {
            const action = window.committedAction
              ? `${formatActionAmount(window.committedAction.action, window.committedAction.amount)} after ${Math.round(window.committedAction.latencyMs / 100) / 10}s`
              : 'still open'
            return `${window.id}: ${window.street}, pot ${formatMoney(window.pot)}, facing ${formatMoney(window.facingBet)}, ${action}, evidence ${window.signalIds.join(', ') || 'none'}`
          })
          .join(' | ')}.`
      : 'Recent decision windows: none yet.',
    latestTrace
      ? `Latest Tavus strategy trace: ${formatActionAmount(latestTrace.action, latestTrace.amount)}; reads ${latestTrace.readIds.join(', ') || 'none'}; evidence ${latestTrace.evidenceIds.join(', ') || 'none'}.`
      : 'Latest Tavus strategy trace: none yet.',
    'Use reads as private probabilistic hypotheses. During live play, do not reveal exact reads, confidence, or evidence IDs; only hint socially. Exact proof belongs after the hand.',
  ].join('\n')
}

export function evidenceById(brain: OpponentBrainState, evidenceId: string): PerceptionSignal | undefined {
  return brain.signals.find((signal) => signal.id === evidenceId)
}
