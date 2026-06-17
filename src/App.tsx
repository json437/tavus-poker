import {
  BadgeDollarSign,
  BookOpen,
  Check,
  CircleDollarSign,
  Crosshair,
  Eye,
  Flame,
  Gauge,
  Hand,
  History,
  Mic,
  PhoneOff,
  Play,
  RefreshCw,
  ShieldQuestion,
  Sparkles,
  Trophy,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import './App.css'
import {
  applyHeroAction,
  buildHoldemTavusContext,
  legalActions,
  matchWinner,
  startHoldemHand,
  toCall,
  visibleTavusCards,
} from './domain/holdem'
import type { ActionLogEntry, HoldemAction, HoldemGameState, LegalAction, PlayerId } from './domain/holdem'
import {
  buildBrainContext,
  createOpponentBrain,
  describeReadEvidence,
  evidenceById,
  ingestRavenSignal,
  observeHeroAction,
  recordTavusDecision,
  settleHandReads,
} from './domain/opponentBrain'
import type { OpponentBrainState, PerceptionSignal, TavusStrategyTrace } from './domain/opponentBrain'
import { formatMoney, formatPercent, toPlayingCard } from './domain/poker'
import type { CardCode } from './domain/poker'
import { echoTavusText, loadDailyIframe, syncTavusContext } from './lib/daily'
import type { DailyCallFrame, DailyParticipant } from './lib/daily'
import { createTavusConversation, endTavusConversation, getTavusConfig } from './lib/tavus'
import type { TavusConfig, TavusConversation } from './lib/tavus'
import { ravenSignalsFromAppMessage, userSpeechFromAppMessage } from './lib/tavusEvents'
import type { UserSpeechEvent } from './lib/tavusEvents'
import { parseVoiceCommand, voiceTellLabel } from './domain/voice'
import type { VoiceCommand } from './domain/voice'
import { PokerSceneRenderer } from './components/PokerSceneRenderer'
import { assertReadDisclosureAllowed, postHandProofUnlocked, sealedReadLabel } from './domain/readDisclosure'

type SessionState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'active'; conversation: TavusConversation; requestedTestMode: boolean }
  | { status: 'error'; message: string }

type MatchState = {
  game: HoldemGameState
  brain: OpponentBrainState
  winner: PlayerId | null
}

type AppRoute = 'home' | 'play' | 'blog'
type RoomScene = 'intro' | 'seat' | 'live'
type HandPhase = 'empty' | 'shuffle' | 'blinds' | 'deal' | 'live'
type VoiceState =
  | { status: 'idle' }
  | { status: 'listening' }
  | { status: 'locked'; transcript: string; command: VoiceCommand }
  | { status: 'unclear'; transcript: string; reason: string }
  | { status: 'error'; message: string }

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

const ACTION_ICONS: Record<HoldemAction, LucideIcon> = {
  fold: ShieldQuestion,
  call: Check,
  raise: Flame,
  check: Hand,
  bet: BadgeDollarSign,
}

const SOURCE_LABELS: Record<PerceptionSignal['source'], string> = {
  raven: 'Raven',
  speech: 'Speech',
  'local-timing': 'Timing',
  'game-action': 'Action',
  showdown: 'Result',
}

function createMatch(): MatchState {
  const brain = createOpponentBrain()
  const game = startHoldemHand(undefined, Math.random, brain.strategy)
  return {
    game,
    brain: recordTavusDecision(brain, game),
    winner: matchWinner(game),
  }
}

function Card({ code, hidden = false }: { code?: CardCode; hidden?: boolean }) {
  if (hidden || !code) {
    return (
      <div className="card card-back" aria-label="Hidden card">
        <span>TP</span>
      </div>
    )
  }

  const card = toPlayingCard(code)

  return (
    <div className={`card ${card.color}`}>
      <span className="rank">{card.displayRank}</span>
      <span className="suit">{card.suitSymbol}</span>
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="metric">
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function latestTavusAction(game: HoldemGameState): ActionLogEntry | undefined {
  return [...game.actionLog].reverse().find((entry) => entry.actor === 'tavus' && !entry.action.includes('blind'))
}

function latestTraceForHand(brain: OpponentBrainState, handNumber: number): TavusStrategyTrace | undefined {
  return [...brain.traces].reverse().find((trace) => trace.handNumber === handNumber)
}

function latestDebriefForHand(brain: OpponentBrainState, handNumber: number) {
  return [...brain.debriefs].reverse().find((debrief) => debrief.handNumber === handNumber)
}

function winnerLabel(winner: PlayerId | null): string {
  if (winner === 'hero') return 'You won the match'
  if (winner === 'tavus') return 'Tavus won the match'
  return 'Match live'
}

function formatTraceAction(action: HoldemAction, amount?: number): string {
  if (!amount) return action
  return action === 'raise' ? `${action} to ${formatMoney(amount)}` : `${action} ${formatMoney(amount)}`
}

function formatTavusStartError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unable to start Tavus.'
  if (/out of conversational credits/i.test(message)) {
    return 'Tavus credits are exhausted. Live Tavus/Raven validation needs credits.'
  }
  return message
}

function routeFromPath(pathname: string): AppRoute {
  if (pathname === '/blog') return 'blog'
  if (pathname === '/play') return 'play'
  return 'home'
}

function BlogPage({ onPlay, onHome }: { onPlay: () => void; onHome: () => void }) {
  return (
    <main className="app-shell blog-shell">
      <article className="blog-page">
        <header className="blog-hero">
          <h1>TavusPoker</h1>
          <p className="blog-dek">
            <strong>The table watches back.</strong>
          </p>
          <p>
            AlphaGo won in public. Every stone sat on the board for both players to see. Poker hides everything. The cards are face down. The talk is a weapon. The opponent is a person first and a range second.
          </p>
          <p>
            That gap is the point. Most AI demos put the model off to the side, a calculator you query and wait on. TavusPoker drops it into the seat across from you. It plays with hidden information, acts under a clock, and tries to read you while you are still in the room.
          </p>
          <div className="blog-actions">
            <button type="button" className="intro-start" onClick={onPlay}>
              <Play size={18} aria-hidden="true" />
              Play with Tavus
            </button>
            <button type="button" className="secondary-button" onClick={onHome}>
              Back
            </button>
          </div>
        </header>

        <section>
          <h2>The old game was too clean</h2>
          <p>
            Board games made AI legible because the whole world fit on the board. Nothing was hidden. Nothing had to be inferred about the person on the other side.
          </p>
          <p>
            Poker removes that comfort. You never see the full state. You act on partial information against someone who is learning you. That is a harder problem, and a better test of a conversational video interface than another assistant call. A poker opponent has to listen, wait, bluff, remember, and decide while you sit across from it.
          </p>
        </section>

        <section>
          <h2>How it works</h2>
          <p>
            The architecture is split by trust. The engine owns game truth. Phoenix owns presence. Sparrow owns timing. Raven owns perception. The LLM owns strategy.
          </p>
          <p>
            The engine owns the truth. It shuffles, posts blinds, validates legal actions, resolves all-ins, awards pots, and runs the match until one stack is gone. The model never touches the deck. It plays the same game you do, blind to your cards.
          </p>
          <p>
            Phoenix is the face across the felt. It renders the opponent in real time over WebRTC, so the seat is held by something that reacts instead of buffers.
          </p>
          <p>
            Sparrow runs the clock. It decides when to speak, when to wait, and when to let the silence sit on you. In poker that is not a UX nicety. Timing is information. A snap-call and a long pause say different things, and the opponent gets to use both.
          </p>
          <p>
            Raven supplies the read. It watches expression, gaze, and tone, and only fires while you are facing a decision. Cues outside a decision window are noise, and get dropped.
          </p>
          <p>
            Raven's observations arrive as tool calls. The model ties them to the hand, the price, the timing, and the result. Over time that becomes a private table image: how often you fold to pressure, which spots make you talk, which pauses are real, and where Tavus can push.
          </p>
        </section>

        <section>
          <h2>The rule that makes it honest</h2>
          <p>
            A real opponent does not announce your tell while using it. Neither does TavusPoker. During the hand, the read stays sealed. After the pot moves, the app opens the evidence trail: what it saw, which decision it belonged to, and whether the model actually spent the read.
          </p>
          <pre>{`Voice and camera
  plus Raven and Sparrow
  plus timing and action
  plus showdown result
  equals evidence

Evidence updates a private hypothesis.
The hypothesis moves strategy.
The proof freezes when the hand ends.`}</pre>
          <p>
            Uncertainty is the hard boundary. A glance is not a tell. A tense phrase is not a diagnosis. A pattern only counts when it attaches to a real decision and survives what happens next.
          </p>
        </section>

        <section>
          <h2>Why I built it this way</h2>
          <p>
            The interesting part of CVI is not video wrapped around a chatbot. It is software in the room with you, acting on what happens there. Poker forces every layer to earn its place. Raven has to perceive something that matters. Sparrow has to time a response a human would time. Phoenix has to hold a face that gives nothing away. The LLM has to decide under hidden information instead of answering a question.
          </p>
          <p>
            A support agent or a tutor lets you fake most of that. A poker opponent does not. It has a face, a voice, a seat, private information, memory, and a reason to watch.
          </p>
          <p>
            When it works, you stop feeling like you are prompting a model. You feel like you are trying to beat someone who is watching back.
          </p>
        </section>
      </article>
    </main>
  )
}

function App() {
  const initialRoute = routeFromPath(typeof window === 'undefined' ? '/' : window.location.pathname)
  const [match, setMatch] = useState<MatchState>(() => createMatch())
  const [appRoute, setAppRoute] = useState<AppRoute>(initialRoute)
  const [visibleGameForTavus, setVisibleGameForTavus] = useState<HoldemGameState>(() => match.game)
  const [session, setSession] = useState<SessionState>({ status: 'idle' })
  const [config, setConfig] = useState<TavusConfig | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [judgeMode, setJudgeMode] = useState(false)
  const [callStatus, setCallStatus] = useState('Not joined')
  const [wager, setWager] = useState(0)
  const [isTavusThinking, setIsTavusThinking] = useState(false)
  const [introComplete, setIntroComplete] = useState(initialRoute === 'play')
  const [roomScene, setRoomScene] = useState<RoomScene>(initialRoute === 'play' ? 'seat' : 'intro')
  const [handPhase, setHandPhase] = useState<HandPhase>('empty')
  const [voiceState, setVoiceState] = useState<VoiceState>({ status: 'idle' })
  const decisionStartedAt = useRef(0)
  const tavusVideoRef = useRef<HTMLVideoElement | null>(null)
  const callFrameRef = useRef<DailyCallFrame | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const liveSpeechHandlerRef = useRef<(event: UserSpeechEvent, observedAt: number) => void>(() => undefined)
  const handPhaseTimersRef = useRef<number[]>([])
  const lastEchoRef = useRef('')
  const lastSpeechSignatureRef = useRef('')
  const latestUserSpeechRef = useRef<{ event: UserSpeechEvent; observedAt: number } | null>(null)
  const tavusContextRef = useRef('')
  const visibleGameForTavusRef = useRef(match.game)
  const matchRef = useRef(match)
  const thinkingTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [tavusVideoReady, setTavusVideoReady] = useState(false)

  const { game, brain, winner } = match
  const actions = useMemo(() => legalActions(game), [game])
  const tavusContext = useMemo(() => `${buildHoldemTavusContext(visibleGameForTavus)}\n\n${buildBrainContext(brain, visibleGameForTavus)}`, [brain, visibleGameForTavus])
  const tavusCards = visibleTavusCards(game)
  const tavusCardsRevealed = game.showdown?.cardsRevealed ?? false
  const tavusHandDisclosure = tavusCardsRevealed
    ? `Tavus: ${game.showdown?.tavusHand}. You: ${game.showdown?.heroHand}.`
    : game.showdown?.winner === 'hero'
      ? 'No showdown. Tavus folded without showing.'
      : 'No showdown. Tavus mucked its hand.'
  const handEvidenceSignals = brain.signals.filter((signal) => signal.handNumber === game.handNumber)
  const handSignals = handEvidenceSignals.slice(-5).reverse()
  const handSourceSummary = (Object.keys(SOURCE_LABELS) as Array<PerceptionSignal['source']>)
    .map((source) => ({
      source,
      label: SOURCE_LABELS[source],
      count: handEvidenceSignals.filter((signal) => signal.source === source).length,
    }))
    .filter((item) => item.count > 0)
  const handTraces = brain.traces.filter((item) => item.handNumber === game.handNumber)
  const trace = latestTraceForHand(brain, game.handNumber)
  const canRevealTrace = postHandProofUnlocked(game.street)
  const traceEvidence = (trace?.evidenceIds ?? []).map((id) => evidenceById(brain, id)).filter((item): item is PerceptionSignal => Boolean(item))
  const tavusAction = latestTavusAction(game)
  const latestDebrief = latestDebriefForHand(brain, game.handNumber)
  const proofReadIds = [...new Set([...(trace?.readIds ?? []), ...(latestDebrief?.readIds ?? [])])]
  const proofReads = proofReadIds.flatMap((id) => {
    const read = brain.reads.find((item) => item.id === id)
    return read ? [read] : []
  })
  const exactProofPayload = {
    readIds: proofReadIds,
    evidenceIds: traceEvidence.map((signal) => signal.id),
    confidence: trace?.confidence,
    rationale: trace?.behavioralReason,
  }
  if (import.meta.env.DEV && !canRevealTrace && (showContext || judgeMode)) {
    assertReadDisclosureAllowed(game.street, 'live-table', exactProofPayload)
  }
  const latestHandDecisionWindow = [...brain.decisionWindows].reverse().find((window) => window.handNumber === game.handNumber && window.committedAction)
  const traceDecisionWindow = trace?.evidenceIds.length
    ? [...brain.decisionWindows]
        .reverse()
        .find((window) => window.handNumber === game.handNumber && window.signalIds.some((id) => trace.evidenceIds.includes(id)))
    : undefined
  const proofDecisionWindow = traceDecisionWindow ?? latestHandDecisionWindow
  const proofHeading = trace && canRevealTrace ? formatTraceAction(trace.action, trace.amount) : canRevealTrace && latestHandDecisionWindow ? 'Read banked' : 'Live read sealed'
  const proofConfidence = trace && canRevealTrace ? formatPercent(trace.confidence) : canRevealTrace && latestHandDecisionWindow ? 'banked' : 'sealed'
  const proofReason =
    trace && canRevealTrace
      ? trace.behavioralReason
      : canRevealTrace && latestHandDecisionWindow
        ? 'This hand produced decision evidence, but Tavus did not get a later action where that read changed strategy. It is memory for the next spot.'
        : 'The read is hidden from the player view while the hand is live.'
  const activeSession = session.status === 'active' ? session : null
  const activeConversation = activeSession?.conversation ?? null
  const hasLiveTavusRoom = Boolean(activeConversation?.status === 'active' && activeConversation.conversation_url)
  const hasMissingRoomUrl = Boolean(activeConversation?.status === 'active' && !activeConversation.conversation_url)
  const hasEndedConversation = Boolean(activeConversation?.status === 'ended')
  const hasVerifiedTestConversation = Boolean(activeSession?.requestedTestMode && hasEndedConversation)
  const liveRoomJoined = hasLiveTavusRoom && (callStatus === 'Live room active' || callStatus === 'Waiting for Tavus video')
  const liveInputsActive = liveRoomJoined
  const showJudgeTrace = canRevealTrace && (judgeMode || showContext)
  const handComplete = game.street === 'Complete' && Boolean(game.showdown)
  const handWinner = game.showdown?.winner
  const handPotAmount = game.showdown?.potAmount ?? 0
  const handResultTitle =
    handWinner === 'hero'
      ? 'You take the pot'
      : handWinner === 'tavus'
        ? 'Tavus takes the pot'
        : handWinner === 'split'
          ? 'Pot chopped'
          : 'Hand complete'
  const handResultDetail =
    handWinner === 'hero'
      ? game.showdown?.cardsRevealed
        ? `You showed ${game.showdown.heroHand}.`
        : 'Tavus folded. Your cards stay quiet.'
      : handWinner === 'tavus'
        ? game.showdown?.cardsRevealed
          ? `Tavus showed ${game.showdown.tavusHand}.`
          : 'You folded. Tavus drags it without showing.'
        : handWinner === 'split'
          ? `You had ${game.showdown?.heroHand}. Tavus had ${game.showdown?.tavusHand}.`
          : 'The hand is settled.'
  const resultReason =
    game.showdown?.cardsRevealed
      ? `${game.showdown.summary} Board: ${game.board.map((card) => toPlayingCard(card).label).join(' ')}.`
      : handWinner === 'hero'
        ? 'Tavus folded. You win this pot without showing cards.'
        : handWinner === 'tavus'
          ? 'You folded. Tavus wins this pot without showing cards.'
          : 'The hand ended without a showdown.'
  const nextHandLabel = winner ? 'New match' : 'Next hand'
  const nextHandButtonLabel = winner ? 'Start a new match' : `Deal hand ${game.handNumber + 1}`
  const recentTableActions = game.actionLog.slice(-4)
  const spokenActionPrompt = actions.length
      ? `Say ${actions
        .map((action) => {
          if (action.action === 'raise') return `raise to ${formatMoney(action.amount ?? 0)}`
          if (action.action === 'bet') return `bet ${formatMoney(action.amount ?? 0)}`
          return action.label.toLowerCase()
        })
        .join(', ')}.`
    : 'Wait for Tavus.'
  const hero = game.players.hero
  const heroToCall = toCall(game, 'hero')
  const canBet = actions.some((action) => action.action === 'bet')
  const canRaise = actions.some((action) => action.action === 'raise')
  const wagerAction: HoldemAction | null = canRaise ? 'raise' : canBet ? 'bet' : null
  const wagerLegalAction = wagerAction ? actions.find((action) => action.action === wagerAction) : undefined
  const maxWager = wagerAction === 'raise' ? hero.stack + hero.contribution : wagerAction === 'bet' ? hero.stack : 0
  const minWager =
    wagerAction === 'raise'
      ? Math.min(maxWager, Math.max(game.currentBet + game.minRaise, game.currentBet + game.bigBlind))
      : wagerAction === 'bet'
        ? Math.min(maxWager, game.bigBlind)
        : 0
  const potWager =
    wagerAction === 'raise'
      ? Math.min(maxWager, Math.max(minWager, game.currentBet + heroToCall + game.pot))
      : wagerAction === 'bet'
        ? Math.min(maxWager, Math.max(minWager, game.pot))
        : 0
  const selectedWager = wagerAction ? Math.min(maxWager, Math.max(minWager, wager || potWager || minWager)) : 0
  const isForcedAllInWager = wagerLegalAction?.label.startsWith('All-in') ?? false
  const wagerLabel = isForcedAllInWager ? 'All-in' : wagerAction === 'raise' ? 'Raise to' : 'Bet'
  const wagerCommitLabel = isForcedAllInWager ? 'All-in' : wagerAction === 'raise' ? 'Raise' : 'Bet'
  const heroCommitted = game.street === 'Complete' ? 0 : game.players.hero.contribution
  const tavusCommitted = game.street === 'Complete' ? 0 : game.players.tavus.contribution
  const displayedToCall = game.street === 'Complete' ? 0 : Math.max(0, game.currentBet - game.players.hero.contribution)
  const cardsAreDealt = handPhase === 'deal' || handPhase === 'live' || game.street === 'Complete'
  const handIsPlayable = handPhase === 'live' && game.street !== 'Complete'
  const displayedBoard = cardsAreDealt ? game.board : []
  const phaseLabel =
    handPhase === 'shuffle'
      ? 'Shuffling'
      : handPhase === 'blinds'
        ? 'Posting blinds'
        : handPhase === 'deal'
          ? 'Dealing'
          : game.street
  const tavusPlateStatus =
    game.street === 'Complete'
      ? game.showdown?.cardsRevealed
        ? 'shown'
        : 'mucked'
      : 'sealed'
  const decisionHint = winner
    ? 'The match is over.'
    : game.street === 'Complete'
      ? 'Start the next hand when ready.'
      : isTavusThinking
        ? 'Tavus is reading the spot.'
        : spokenActionPrompt
  const roomState =
    session.status === 'error'
      ? 'Room error'
      : session.status === 'active'
      ? hasMissingRoomUrl
        ? 'No room URL'
        : callStatus
      : session.status === 'starting'
        ? 'Creating room'
        : config?.hasApiKey && config.hasPersona
          ? 'Ready'
          : 'Needs credentials'
  const tavusSeatStatus = tavusVideoReady ? 'Live Tavus' : liveRoomJoined ? 'Waiting for video' : roomState
  const voicePrompt = winner
    ? 'Match over'
    : canRevealTrace
      ? 'Proof available'
      : liveInputsActive
        ? 'Tavus hears the table'
        : hasVerifiedTestConversation
          ? 'API verified; no room'
          : hasMissingRoomUrl
            ? 'No room joined'
          : session.status === 'starting' || (hasLiveTavusRoom && !liveRoomJoined)
            ? 'Joining Tavus room'
          : 'Say your action'
  const privateReadStatus = sealedReadLabel(game.street, Boolean(handEvidenceSignals.length || handTraces.length))
  const voiceStatusText =
    voiceState.status === 'listening'
      ? 'Listening'
      : voiceState.status === 'locked'
        ? `Heard: ${voiceState.transcript}`
        : voiceState.status === 'unclear'
          ? voiceState.reason
          : voiceState.status === 'error'
            ? voiceState.message
            : voicePrompt
  const liveTavusConfigured = config?.hasApiKey === true && config.hasPersona === true
  const tavusControlDisabled = session.status === 'starting' || (session.status !== 'active' && !liveTavusConfigured)
  const turnLabel = winner
    ? 'Match complete'
    : game.street === 'Complete'
      ? 'Hand complete'
      : handPhase !== 'live'
        ? 'Hand starting'
      : isTavusThinking
        ? 'Tavus thinking'
        : game.toAct === 'hero'
          ? 'Your action'
          : 'Tavus thinking'
  const actionHeadline = winner
    ? winnerLabel(winner)
    : game.street === 'Complete'
      ? game.showdown?.summary ?? 'Hand complete'
      : handPhase !== 'live'
        ? `${phaseLabel}...`
      : isTavusThinking
        ? 'Tavus is taking the spot'
        : game.toAct === 'hero'
        ? tavusAction
          ? `Tavus ${tavusAction.action}${tavusAction.amount ? ` ${formatMoney(tavusAction.amount)}` : ''}`
          : `${game.street}: action is on you`
        : 'Waiting on Tavus'
  useEffect(() => {
    getTavusConfig()
      .then((nextConfig) => {
        setConfig(nextConfig)
        setTestMode(nextConfig.testModeDefault)
      })
      .catch(() => {
        setConfig({ hasApiKey: false, hasPersona: false, replicaId: 'unknown', testModeDefault: false, requireAuth: false })
      })
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const nextRoute = routeFromPath(window.location.pathname)
      setAppRoute(nextRoute)
      if (nextRoute === 'play') {
        setIntroComplete(true)
        setRoomScene((current) => (current === 'intro' ? 'seat' : current))
      } else if (nextRoute === 'home') {
        setIntroComplete(false)
        setRoomScene('intro')
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function navigate(route: AppRoute) {
    const path = route === 'home' ? '/' : `/${route}`
    window.history.pushState({}, '', path)
    setAppRoute(route)
    if (route === 'play') {
      setIntroComplete(true)
      setRoomScene((current) => (current === 'intro' ? 'seat' : current))
    }
    if (route === 'home') {
      setIntroComplete(false)
      setRoomScene('intro')
    }
  }

  useEffect(() => {
    decisionStartedAt.current = globalThis.performance?.now?.() ?? 0
  }, [game.handNumber, game.street, game.toAct])

  useEffect(() => {
    const previous = visibleGameForTavusRef.current
    const streetChanged = previous.handNumber !== game.handNumber || previous.street !== game.street || previous.board.length !== game.board.length
    const delay = streetChanged ? 760 : 180
    const timer = window.setTimeout(() => {
      visibleGameForTavusRef.current = game
      setVisibleGameForTavus(game)
    }, delay)

    return () => window.clearTimeout(timer)
  }, [game])

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    tavusContextRef.current = tavusContext
  }, [tavusContext])

  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) {
        window.clearTimeout(thinkingTimerRef.current)
      }
      for (const timer of handPhaseTimersRef.current) {
        window.clearTimeout(timer)
      }
      recognitionRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    if (session.status !== 'active' || session.conversation.status !== 'active' || !session.conversation.conversation_url || !tavusVideoRef.current || roomScene !== 'live') return

    let cancelled = false
    const videoElement = tavusVideoRef.current
    const conversation = session.conversation
    const mediaRefreshTimers: number[] = []
    setTavusVideoReady(false)

    function findRemoteParticipant(frame: DailyCallFrame): DailyParticipant | null {
      const participants = frame.participants?.()
      if (!participants) return null
      return Object.values(participants).find((participant) => !participant.local) ?? null
    }

    function setWaitingForTavusVideo() {
      setTavusVideoReady(false)
      setCallStatus((current) => (current === 'Live room active' || current === 'Waiting for Tavus video' ? 'Waiting for Tavus video' : current))
    }

    function updateTavusMedia(frame: DailyCallFrame) {
      if (cancelled) return
      const participant = findRemoteParticipant(frame)
      const videoTrack = participant?.tracks?.video?.persistentTrack ?? participant?.tracks?.video?.track
      const audioTrack = participant?.tracks?.audio?.persistentTrack ?? participant?.tracks?.audio?.track

      if (!videoTrack || videoTrack.readyState === 'ended') {
        videoElement.srcObject = null
        setWaitingForTavusVideo()
        return
      }

      const nextTracks = audioTrack && audioTrack.readyState !== 'ended' ? [videoTrack, audioTrack] : [videoTrack]
      const currentStream = videoElement.srcObject instanceof MediaStream ? videoElement.srcObject : null
      const currentTracks = currentStream?.getTracks() ?? []
      const hasSameTracks = nextTracks.every((track) => currentTracks.includes(track)) && currentTracks.length === nextTracks.length

      if (!hasSameTracks) {
        videoElement.srcObject = new MediaStream(nextTracks)
      }

      setTavusVideoReady(true)
      setCallStatus('Live room active')
      void videoElement.play().catch(() => undefined)
    }

    async function mountCall() {
      try {
        setCallStatus('Joining room')
        const DailyIframe = await loadDailyIframe()
        if (cancelled) return
        const frame = DailyIframe.createCallObject({
          userName: 'You',
          userData: { role: 'hero', table: 'TavusPoker' },
        })
        callFrameRef.current = frame
        frame.on('app-message', (event) => {
          if (cancelled) return
          const liveGame = matchRef.current.game
          const acceptsDecisionEvidence = liveGame.street !== 'Complete' && liveGame.toAct === 'hero'
          const userSpeech = userSpeechFromAppMessage(event.data)
          if (userSpeech && acceptsDecisionEvidence) {
            const signature = `${userSpeech.turnIdx ?? 'turn'}:${userSpeech.inferenceId ?? 'utterance'}:${userSpeech.text}`
            if (signature !== lastSpeechSignatureRef.current) {
              lastSpeechSignatureRef.current = signature
              const observedAt = globalThis.performance?.now?.() ?? 0
              latestUserSpeechRef.current = { event: userSpeech, observedAt }
              liveSpeechHandlerRef.current(userSpeech, observedAt)
            }
          }

          const ravenSignals = ravenSignalsFromAppMessage(event.data)
          if (!ravenSignals.length || !acceptsDecisionEvidence) return

          setMatch((current) => {
            if (current.game.street === 'Complete' || current.game.toAct !== 'hero') return current
            let nextBrain = current.brain
            for (const signal of ravenSignals) {
              nextBrain = ingestRavenSignal(nextBrain, current.game, signal)
            }
            return { ...current, brain: nextBrain }
          })
        })
        const refreshMedia = () => updateTavusMedia(frame)
        frame.on('participant-joined', refreshMedia)
        frame.on('participant-updated', refreshMedia)
        frame.on('participant-left', refreshMedia)
        frame.on('track-started', refreshMedia)
        frame.on('track-stopped', refreshMedia)
        frame.on('joined-meeting', refreshMedia)
        frame.on('left-meeting', () => {
          if (cancelled) return
          videoElement.srcObject = null
          setTavusVideoReady(false)
          setCallStatus('Room left')
        })
        frame.on('error', () => {
          if (cancelled) return
          setCallStatus('Daily room error')
        })
        await frame.join({
          url: conversation.conversation_url,
          ...(conversation.meeting_token ? { token: conversation.meeting_token } : {}),
          userName: 'You',
          userData: { role: 'hero', table: 'TavusPoker' },
          startVideoOff: false,
          startAudioOff: false,
        })
        if (cancelled) return
        setCallStatus('Waiting for Tavus video')
        await Promise.resolve(frame.setLocalVideo?.(true))
        await Promise.resolve(frame.setLocalAudio?.(true))
        updateTavusMedia(frame)
        mediaRefreshTimers.push(window.setTimeout(() => updateTavusMedia(frame), 900))
        mediaRefreshTimers.push(window.setTimeout(() => updateTavusMedia(frame), 2200))
        mediaRefreshTimers.push(window.setTimeout(() => updateTavusMedia(frame), 5200))
        syncTavusContext(frame, conversation.conversation_id, tavusContextRef.current)
      } catch (error) {
        if (cancelled) return
        setCallStatus(error instanceof Error ? error.message : 'Daily room failed')
      }
    }

    void mountCall()

    return () => {
      cancelled = true
      const frame = callFrameRef.current
      callFrameRef.current = null
      for (const timer of mediaRefreshTimers) {
        window.clearTimeout(timer)
      }
      videoElement.srcObject = null
      setTavusVideoReady(false)
      void frame?.leave().catch(() => undefined)
      frame?.destroy()
      setCallStatus('Not joined')
    }
  }, [roomScene, session])

  useEffect(() => {
    if (!activeConversation || !callFrameRef.current || !liveRoomJoined) return
    const timer = window.setTimeout(() => {
      syncTavusContext(callFrameRef.current, activeConversation.conversation_id, tavusContext)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [activeConversation, liveRoomJoined, tavusContext])

  useEffect(() => {
    if (!activeConversation || !callFrameRef.current || !liveRoomJoined) return
    if (game.lastTavusTalk === lastEchoRef.current) return
    const text = game.lastTavusTalk
    const timer = window.setTimeout(() => {
      if (!callFrameRef.current) return
      lastEchoRef.current = text
      echoTavusText(callFrameRef.current, activeConversation.conversation_id, text)
    }, 760)
    return () => window.clearTimeout(timer)
  }, [activeConversation, liveRoomJoined, game.lastTavusTalk, game.street, game.board.length])

  function playTableSound(kind: 'shuffle' | 'deal' | 'chip' | 'showdown' | 'fold') {
    const AudioContextConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) return
    const context = audioContextRef.current ?? new AudioContextConstructor()
    audioContextRef.current = context
    if (context.state === 'suspended') {
      void context.resume()
    }

    const now = context.currentTime
    const gain = context.createGain()
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0.0001, now)

    const playTone = (frequency: number, start: number, duration: number, volume: number) => {
      const oscillator = context.createOscillator()
      oscillator.type = kind === 'showdown' ? 'triangle' : 'square'
      oscillator.frequency.setValueAtTime(frequency, start)
      oscillator.connect(gain)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      oscillator.start(start)
      oscillator.stop(start + duration + 0.02)
    }

    if (kind === 'shuffle') {
      playTone(220, now, 0.045, 0.025)
      playTone(260, now + 0.06, 0.04, 0.02)
      playTone(210, now + 0.12, 0.04, 0.018)
    } else if (kind === 'deal') {
      playTone(540, now, 0.04, 0.026)
      playTone(660, now + 0.08, 0.035, 0.02)
    } else if (kind === 'chip') {
      playTone(360, now, 0.045, 0.024)
      playTone(520, now + 0.04, 0.035, 0.018)
    } else if (kind === 'fold') {
      playTone(170, now, 0.08, 0.018)
    } else {
      playTone(440, now, 0.08, 0.022)
      playTone(660, now + 0.09, 0.1, 0.018)
    }
  }

  function clearHandPhaseTimers() {
    for (const timer of handPhaseTimersRef.current) {
      window.clearTimeout(timer)
    }
    handPhaseTimersRef.current = []
  }

  function runHandIntro() {
    clearHandPhaseTimers()
    setHandPhase('shuffle')
    playTableSound('shuffle')
    handPhaseTimersRef.current = [
      window.setTimeout(() => {
        setHandPhase('blinds')
        playTableSound('chip')
      }, 720),
      window.setTimeout(() => {
        setHandPhase('deal')
        playTableSound('deal')
      }, 1380),
      window.setTimeout(() => {
        setHandPhase('live')
        decisionStartedAt.current = globalThis.performance?.now?.() ?? 0
      }, 2200),
    ]
  }

  function sitDown() {
    setIntroComplete(true)
    setRoomScene('seat')
    setHandPhase('empty')
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }))
  }

  function startLocalHand() {
    setRoomScene('live')
    runHandIntro()
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }))
  }

  async function ensureLiveMediaAccess(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setSession({ status: 'error', message: 'Camera and microphone access is unavailable in this browser. Live Tavus needs a real browser.' })
      setCallStatus('Media unavailable')
      return false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      stream.getTracks().forEach((track) => track.stop())
      return true
    } catch {
      setSession({ status: 'error', message: 'Camera and microphone permission is required before Tavus can watch, listen, and play the live seat.' })
      setCallStatus('Permission needed')
      return false
    }
  }

  async function startLiveHand() {
    if (!liveTavusConfigured && session.status !== 'active') {
      setSession({ status: 'error', message: 'Live Tavus is not configured. Add the Tavus API key and persona before starting the match.' })
      setCallStatus('Tavus not configured')
      return
    }
    if (session.status !== 'active') {
      const mediaReady = await ensureLiveMediaAccess()
      if (!mediaReady) return
      const tavusStarted = await startTavus()
      if (!tavusStarted) return
    }
    startLocalHand()
  }

  function resetMatch() {
    if (thinkingTimerRef.current) {
      window.clearTimeout(thinkingTimerRef.current)
      thinkingTimerRef.current = null
    }
    clearHandPhaseTimers()
    setIsTavusThinking(false)
    setMatch(createMatch())
    setShowContext(false)
    setJudgeMode(false)
    setVoiceState({ status: 'idle' })
    setRoomScene('seat')
    setHandPhase('empty')
    latestUserSpeechRef.current = null
    lastSpeechSignatureRef.current = ''
    decisionStartedAt.current = 0
  }

  function dealNextHand(event?: MouseEvent<HTMLButtonElement>) {
    clearHandPhaseTimers()
    setIsTavusThinking(false)
    setMatch((current) => {
      if (current.winner) return createMatch()
      const nextGame = startHoldemHand(current.game, Math.random, current.brain.strategy)
      const nextBrain = recordTavusDecision(current.brain, nextGame)
      return {
        game: nextGame,
        brain: nextBrain,
        winner: matchWinner(nextGame),
      }
    })
    setShowContext(false)
    setJudgeMode(false)
    latestUserSpeechRef.current = null
    lastSpeechSignatureRef.current = ''
    setVoiceState({ status: 'idle' })
    decisionStartedAt.current = event?.timeStamp ?? 0
    runHandIntro()
  }

  function commitHeroAction(legal: LegalAction, eventTimeStamp: number) {
    if (isTavusThinking) return
    playTableSound(legal.action === 'fold' ? 'fold' : 'chip')
    const latencyMs = Math.max(0, eventTimeStamp - decisionStartedAt.current)
    const latestSpeech = latestUserSpeechRef.current
    const saidAction =
      latestSpeech && latestSpeech.observedAt >= decisionStartedAt.current - 250
        ? latestSpeech.event.text
        : undefined
    const speechTell = saidAction ? voiceTellLabel(saidAction) : null
    latestUserSpeechRef.current = null
    setIsTavusThinking(true)
    if (thinkingTimerRef.current) {
      window.clearTimeout(thinkingTimerRef.current)
    }

    thinkingTimerRef.current = window.setTimeout(
      () => {
        setMatch((current) => {
          const observedBrain = observeHeroAction(current.brain, current.game, {
            action: legal.action,
            amount: legal.amount,
            latencyMs,
            saidAction,
            ravenSignals: speechTell
              ? [
                  {
                    kind: 'voice',
                    label: speechTell.label,
                    detail: speechTell.detail,
                    intensity: speechTell.intensity,
                  },
                ]
              : undefined,
          })
          const result = applyHeroAction(current.game, legal.action, legal.amount, latencyMs, Math.random, observedBrain.strategy)
          if (result.game.street === 'Complete') {
            window.setTimeout(() => playTableSound('showdown'), 140)
          } else if (result.game.board.length > current.game.board.length) {
            window.setTimeout(() => playTableSound('deal'), 120)
          }
          const withTrace = recordTavusDecision(observedBrain, result.game)
          const settledBrain = settleHandReads(withTrace, result.game)
          return {
            game: result.game,
            brain: settledBrain,
            winner: matchWinner(result.game),
          }
        })
        setIsTavusThinking(false)
        thinkingTimerRef.current = null
      },
      620 + Math.min(520, Math.round(latencyMs % 520)),
    )
  }

  function handleAction(legal: LegalAction, event: MouseEvent<HTMLButtonElement>) {
    commitHeroAction(legal, event.timeStamp)
  }

  function setPresetWager(nextWager: number) {
    setWager(Math.min(maxWager, Math.max(minWager, nextWager)))
  }

  function commitWager(event: MouseEvent<HTMLButtonElement>) {
    if (!wagerAction) return
    const legal = actions.find((action) => action.action === wagerAction)
    if (!legal) return
    handleAction(
      {
        ...legal,
        amount: Math.round(selectedWager),
        label: `${isForcedAllInWager ? 'All-in' : wagerAction === 'raise' ? 'Raise to' : 'Bet'} ${formatMoney(Math.round(selectedWager))}`,
      },
      event,
    )
  }

  function legalActionFromVoice(command: Extract<VoiceCommand, { kind: 'action' }>): { legal: LegalAction | null; reason?: string } {
    const legal = actions.find((action) => action.action === command.action)
    if (!legal) return { legal: null, reason: `${command.action} is not legal in this spot.` }

    if (command.action === 'raise' || command.action === 'bet') {
      const amount =
        command.sizing === 'all-in'
          ? maxWager
          : command.sizing === 'pot'
            ? potWager
            : command.amount

      if (amount === undefined) {
        return { legal: null, reason: `${command.action === 'raise' ? 'Name the raise amount.' : 'Name the bet amount.'}` }
      }

      if (amount < minWager) {
        const closeEnoughToMinimum = minWager - amount <= Math.max(5, game.bigBlind)
        if (!closeEnoughToMinimum) {
          return { legal: null, reason: `That is too small. Minimum is ${formatMoney(minWager)}.` }
        }

        return {
          legal: {
            ...legal,
            amount: minWager,
            label: `${command.action === 'raise' ? 'Raise to' : 'Bet'} ${formatMoney(Math.round(minWager))}`,
          },
          reason: `Minimum is ${formatMoney(minWager)}. Playing it as ${formatMoney(minWager)}.`,
        }
      }

      if (amount > maxWager) {
        return { legal: null, reason: `That is more than your stack. All-in is ${formatMoney(maxWager)}.` }
      }

      return {
        legal: {
          ...legal,
          amount,
          label: `${amount === maxWager ? 'All-in' : command.action === 'raise' ? 'Raise to' : 'Bet'} ${formatMoney(Math.round(amount))}`,
        },
      }
    }

    return { legal }
  }

  function applyVoiceTranscript(transcript: string, observedAt = decisionStartedAt.current + 1, forceCommit = false) {
    const command = parseVoiceCommand(transcript, actions)
    latestUserSpeechRef.current = {
      event: { text: transcript, eventType: 'local.speech_recognition', final: true },
      observedAt,
    }

    if (command.kind === 'action') {
      const { legal, reason } = legalActionFromVoice(command)
      if (!legal) {
        setVoiceState({ status: 'unclear', transcript, reason: reason ?? 'That spoken action is not legal here.' })
        return
      }
      setVoiceState({ status: 'locked', transcript: reason ? `${transcript} · ${reason}` : transcript, command })
      if (legal && (forceCommit || command.confidence >= 0.82) && handIsPlayable && !isTavusThinking) {
        recognitionRef.current?.stop()
        commitHeroAction(legal, observedAt + 1100)
      }
      return
    }

    setVoiceState({ status: 'unclear', transcript, reason: command.reason })
  }

  useEffect(() => {
    liveSpeechHandlerRef.current = (event, observedAt) => {
      if (handIsPlayable && !isTavusThinking) {
        applyVoiceTranscript(event.text, observedAt)
      }
    }
  })

  function startVoiceInput() {
    if (!handIsPlayable || isTavusThinking) return
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) {
      setVoiceState({ status: 'error', message: 'Browser speech recognition is unavailable. Tavus speech still feeds reads in a live room.' })
      return
    }

    recognitionRef.current?.stop()
    const recognition = new Recognition()
    recognitionRef.current = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let transcript = ''
      let isFinal = false
      for (let index = event.results.length - 1; index >= 0; index -= 1) {
        const result = event.results[index]
        const text = result?.[0]?.transcript
        if (text) {
          transcript = text
          isFinal = Boolean(result.isFinal)
          break
        }
      }
      if (transcript) applyVoiceTranscript(transcript, undefined, isFinal)
    }
    recognition.onerror = (event) => {
      setVoiceState({ status: 'error', message: event.error ? `Voice error: ${event.error}` : 'Voice input failed.' })
    }
    recognition.onend = () => {
      setVoiceState((current) => (current.status === 'listening' ? { status: 'idle' } : current))
    }
    setVoiceState({ status: 'listening' })
    recognition.start()
  }

  async function startTavus(): Promise<boolean> {
    setSession({ status: 'starting' })
    setCallStatus('Creating room')
    try {
      const conversation = await createTavusConversation(
        {
          context: tavusContext,
          handNumber: game.handNumber,
          greeting: game.lastTavusTalk,
        },
        testMode,
      )
      setSession({ status: 'active', conversation, requestedTestMode: testMode })
      if (conversation.status === 'ended') {
        setCallStatus(testMode ? 'Test conversation verified' : 'Room ended before join')
      } else if (!conversation.conversation_url) {
        setCallStatus('No room URL')
      } else {
        setCallStatus('Joining room')
      }
      return true
    } catch (error) {
      setSession({ status: 'error', message: formatTavusStartError(error) })
      return false
    }
  }

  async function stopTavus() {
    if (session.status !== 'active') {
      setSession({ status: 'idle' })
      return
    }

    if (session.conversation.status === 'ended') {
      setSession({ status: 'idle' })
      setCallStatus('Not joined')
      return
    }

    try {
      await endTavusConversation(session.conversation.conversation_id)
    } catch {
      // The local match should remain usable even if the remote room is already closed.
    } finally {
      setSession({ status: 'idle' })
    }
  }

  function enterMatch() {
    navigate('play')
    sitDown()
  }

  if (appRoute === 'blog') {
    return <BlogPage onPlay={() => navigate('play')} onHome={() => navigate('home')} />
  }

  if (roomScene === 'intro' || !introComplete) {
    return (
      <main className="app-shell intro-shell">
        <section className="intro-screen" aria-label="TavusPoker opening">
          <div className="intro-copy">
            <p className="eyebrow">TavusPoker</p>
            <h1>Can you beat Tavus at poker?</h1>
            <p>
              Tavus is an AI human that can see, hear, and understand emotion and intent. She will study your tells, bluff into you, and pressure every decision until one stack is gone.
            </p>
            <div className="intro-actions">
              <button type="button" className="intro-start" onClick={enterMatch}>
                <Play size={18} aria-hidden="true" />
                Play with Tavus
              </button>
              <button type="button" className="secondary-button intro-blog-link" onClick={() => navigate('blog')}>
                <BookOpen size={18} aria-hidden="true" />
                Build notes
              </button>
            </div>
          </div>

          <div className="intro-table" aria-hidden="true">
            <div className="intro-felt">
              <div className="intro-seat tavus">
                <span>Tavus</span>
                <div className="intro-avatar" />
                <div className="intro-cards">
                  <Card hidden />
                  <Card hidden />
                </div>
              </div>
              <div className="intro-pot">
                <div className="chip-stack">
                  <span />
                  <span />
                  <span />
                </div>
                <b>1v1</b>
              </div>
              <div className="intro-board">
                <Card hidden />
                <Card hidden />
                <Card hidden />
              </div>
              <div className="intro-seat hero">
                <span>You</span>
                <div className="intro-cards">
                  <Card hidden />
                  <Card hidden />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    )
  }

  if (roomScene === 'seat') {
    return (
      <main className="app-shell game-shell">
        <section className="seat-screen" aria-label="Take your seat">
          <div className="seat-copy">
            <p className="eyebrow">TavusPoker</p>
            <h1>Sit down. No cards are dealt yet.</h1>
            <p>
              The table starts clean. Tavus takes the far seat, your camera and mic sit near your hand, and the first hand begins with a shuffle, blinds, and a real deal.
            </p>
            <div className="seat-actions">
              <button type="button" className="primary-button seat-action" onClick={() => void startLiveHand()} disabled={session.status === 'starting' || !liveTavusConfigured}>
                {session.status !== 'active' ? <Video size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                {session.status === 'starting'
                  ? 'Calling Tavus'
                  : liveTavusConfigured && session.status !== 'active'
                    ? 'Bring Tavus to the table'
                    : session.status === 'active'
                      ? 'Deal the first hand'
                      : 'Tavus not configured'}
              </button>
              {session.status === 'active' && (
                <button
                  type="button"
                  className="secondary-button seat-action"
                  onClick={stopTavus}
                  disabled={tavusControlDisabled}
                >
                  <PhoneOff size={18} aria-hidden="true" />
                  End Tavus room
                </button>
              )}
            </div>
            {session.status === 'error' && <p className="error-line">{session.message}</p>}
          </div>

          <div className="predeal-table" aria-label="Clean poker table before the first deal">
            <div className="predeal-rim" />
            <div className="predeal-felt">
              <div className="predeal-seat tavus">
                <div className="predeal-seat-window tavus" aria-hidden="true">
                  <span className="seat-aperture predeal-aperture" />
                </div>
                <strong>Tavus</strong>
                <span>{session.status === 'active' ? 'at the far seat' : 'waiting across the felt'}</span>
              </div>
              <div className="predeal-deck">
                <Card hidden />
                <span>Deck sealed</span>
              </div>
              <div className="predeal-seat hero">
                <div className="predeal-seat-window hero">
                  <Eye size={30} aria-hidden="true" />
                </div>
                <strong>You</strong>
                <span>camera and mic near your hand</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell game-shell">
      <section className="duel-frame" aria-label="TavusPoker duel room">
        <section className="game-stage">
          <header className="game-header">
            <div>
              <p className="eyebrow">TavusPoker</p>
              <h1>You vs Tavus</h1>
            </div>
            <div className="match-scoreboard" aria-label="Match scoreboard">
              <div>
                <span>You</span>
                <strong>{formatMoney(game.players.hero.stack)}</strong>
              </div>
              <b>1v1</b>
              <div>
                <span>Tavus</span>
                <strong>{formatMoney(game.players.tavus.stack)}</strong>
              </div>
            </div>
            <div className="game-actions">
              <button type="button" className="icon-button" onClick={resetMatch} aria-label="New match">
                <RefreshCw size={18} aria-hidden="true" />
              </button>
              {canRevealTrace && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    setShowContext((value) => !value)
                    setJudgeMode((value) => !value)
                  }}
                  aria-label="Open post-hand proof"
                >
                  <History size={18} aria-hidden="true" />
                </button>
              )}
            </div>
          </header>

          <section className={`poker-table renderer-active ${isTavusThinking ? 'thinking' : ''} ${handComplete ? 'hand-complete' : ''}`} aria-label="TavusPoker table">
            <div className="table-vignette" aria-hidden="true" />
            <PokerSceneRenderer
              phase={handPhase}
              street={phaseLabel}
              pot={game.pot}
              board={displayedBoard}
              heroCards={game.players.hero.holeCards}
              tavusCards={tavusCards}
              heroCommitted={heroCommitted}
              tavusCommitted={tavusCommitted}
              cardsAreDealt={cardsAreDealt}
              isThinking={isTavusThinking}
            />
            <div className="table-rim" aria-hidden="true" />
            <div className="table-surface" aria-hidden="true" />
            <div className="table-brand-mark" aria-hidden="true">
              <span>TAVUS</span>
              <strong>POKER</strong>
            </div>

            <div className="seat tavus-seat">
              <div className="opponent-video table-media-seat" aria-label="Tavus video opponent">
                <div className="video-window">
                  {hasLiveTavusRoom ? (
                    <>
                      <video ref={tavusVideoRef} className={`tavus-video ${tavusVideoReady ? 'active' : ''}`} autoPlay playsInline aria-label="Live Tavus video" />
                      <div className={`tavus-avatar-seat ${tavusVideoReady ? 'hidden' : ''}`} aria-hidden={tavusVideoReady}>
                        <div className="tavus-avatar-face">
                          <span className="tavus-avatar-eye left" />
                          <span className="tavus-avatar-eye right" />
                          <span className="tavus-avatar-mouth" />
                        </div>
                        <strong>Tavus</strong>
                        <em>{tavusSeatStatus}</em>
                      </div>
                      <div className="seat-video-status" aria-hidden="true">
                        <span>{tavusSeatStatus}</span>
                      </div>
                    </>
                  ) : (
                    <div className="empty-tavus-seat">
                      <div className="tavus-avatar-face" aria-hidden="true">
                        <span className="tavus-avatar-eye left" />
                        <span className="tavus-avatar-eye right" />
                        <span className="tavus-avatar-mouth" />
                      </div>
                      <strong>Tavus</strong>
                      <em>{session.status === 'active' ? roomState : 'Local opponent'}</em>
                    </div>
                  )}
                </div>
                <div className="media-nameplate">
                  <strong>Tavus</strong>
                  <span>{liveInputsActive ? 'watching and listening' : 'opponent seat'}</span>
                </div>
              </div>

              <div className="seat-stack opponent-stack">
                <div className="player-plate">
                  <span className="seat-token" aria-hidden="true">TP</span>
                  <div>
                    <span>Tavus {game.dealer === 'tavus' ? 'BTN' : 'BB'}</span>
                    <strong>{tavusPlateStatus} · {formatMoney(game.players.tavus.stack)}</strong>
                  </div>
                </div>
                <div className="hole-cards">
                  {!cardsAreDealt ? (
                    <>
                      <Card hidden />
                      <Card hidden />
                    </>
                  ) : tavusCards ? (
                    tavusCards.map((card) => <Card key={card} code={card} />)
                  ) : (
                    <>
                      <Card hidden />
                      <Card hidden />
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="table-felt">
              <div className="table-status">
                <span>Hand {game.handNumber}</span>
                <strong>{phaseLabel}</strong>
                <span>{winner ? winnerLabel(winner) : privateReadStatus}</span>
              </div>

              {handPhase !== 'live' && game.street !== 'Complete' && (
                <div className={`table-ceremony ${handPhase}`} aria-live="polite">
                  <div className="deck-stack" aria-hidden="true">
                    <Card hidden />
                    <Card hidden />
                    <Card hidden />
                  </div>
                  <strong>
                    {handPhase === 'shuffle'
                      ? 'Shuffling'
                      : handPhase === 'blinds'
                        ? 'Blinds move in'
                        : handPhase === 'deal'
                          ? 'Cards are dealt'
                          : 'Table is clean'}
                  </strong>
                </div>
              )}

              <div className="pot-spot" aria-label={`Pot is ${formatMoney(game.pot)}`}>
                <div className="chip-stack" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <b>{formatMoney(game.pot)}</b>
                <em>Pot</em>
              </div>

              <div className={`board ${displayedBoard.length === 0 ? 'empty-board' : ''}`}>
                {displayedBoard.length === 0 ? <span>{handPhase === 'live' ? 'Preflop' : 'No board yet'}</span> : displayedBoard.map((card) => <Card key={card} code={card} />)}
              </div>

              <div className="pot-strip">
                <Metric icon={Gauge} label="To call" value={formatMoney(displayedToCall)} />
                <Metric icon={Sparkles} label="Blinds" value={`${formatMoney(game.smallBlind)}/${formatMoney(game.bigBlind)}`} />
              </div>
              <div className="table-action-feed" aria-label="Recent table action">
                {recentTableActions.map((entry) => (
                  <span key={entry.id}>
                    <b>{entry.actor}</b> {entry.action}{entry.amount ? ` ${formatMoney(entry.amount)}` : ''}
                  </span>
                ))}
              </div>
            </div>

            {handComplete && (
              <div className={`hand-result-ceremony ${handWinner === 'hero' ? 'hero-win' : handWinner === 'tavus' ? 'tavus-win' : 'split'}`} aria-live="polite">
                <p className="eyebrow">Hand {game.handNumber} result</p>
                <h2>{handResultTitle}</h2>
                <div className="result-pot">
                  <span>Pot shipped</span>
                  <strong>{formatMoney(handPotAmount)}</strong>
                </div>
                <p>{handResultDetail}</p>
                <p className="result-reason">{resultReason}</p>
                <div className="result-stacks" aria-label="Stacks after hand">
                  <div>
                    <span>You</span>
                    <strong>{formatMoney(game.players.hero.stack)}</strong>
                  </div>
                  <div>
                    <span>Tavus</span>
                    <strong>{formatMoney(game.players.tavus.stack)}</strong>
                  </div>
                </div>
                <div className="result-actions">
                  <button type="button" className="result-primary" onClick={winner ? resetMatch : dealNextHand}>
                    {winner ? <Trophy size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
                    <span>{nextHandButtonLabel}</span>
                  </button>
                  <button
                    type="button"
                    className="result-secondary"
                    onClick={() => {
                      const nextValue = !showJudgeTrace
                      setShowContext(nextValue)
                      setJudgeMode(nextValue)
                    }}
                  >
                    <History size={17} aria-hidden="true" />
                    <span>{showJudgeTrace ? 'Hide Tavus read' : 'Show Tavus read'}</span>
                  </button>
                </div>
                {showJudgeTrace && (
                  <div className="inline-read-proof" aria-label="Tavus read from this hand">
                    <div className="inline-read-header">
                      <span>Tavus read</span>
                      <strong>{proofHeading}</strong>
                    </div>
                    <p>{proofReason}</p>
                    {proofReads.length > 0 ? (
                      <ul>
                        {proofReads.slice(0, 2).map((read) => (
                          <li key={read.id}>
                            <strong>{describeReadEvidence(brain, read)}</strong>
                            <span>{formatPercent(read.confidence)} read confidence</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="inline-empty-proof">
                        Tavus did not spend a live tell on this hand. The proof is cards, action, and any reads banked for later.
                      </div>
                    )}
                    {(traceEvidence.length ? traceEvidence : handSignals).length > 0 && (
                      <div className="inline-evidence-strip">
                        {(traceEvidence.length ? traceEvidence : handSignals).slice(0, 3).map((item) => (
                          <span key={item.id}>{item.label}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className={`seat-commitment tavus-commitment ${tavusCommitted > 0 ? 'live' : ''}`} aria-label={`Tavus has committed ${formatMoney(tavusCommitted)} this street`}>
              <CircleDollarSign size={16} aria-hidden="true" />
              <span>{formatMoney(tavusCommitted)}</span>
            </div>

            <div className="tavus-talk" aria-label="Tavus table talk">
              <Mic size={15} aria-hidden="true" />
              <p>{game.lastTavusTalk}</p>
            </div>

            <div className="seat hero-seat">
              <div className="hero-tell-mirror" aria-label="Your camera and voice input">
                <div className="tell-lens">
                  <Eye size={24} aria-hidden="true" />
                </div>
                <div>
                  <strong>You</strong>
                  <span>{voiceState.status === 'listening' ? 'listening for action' : liveInputsActive ? 'camera + mic live' : 'voice + timing ready'}</span>
                </div>
                <button type="button" className="mic-action" onClick={startVoiceInput} disabled={!handIsPlayable || isTavusThinking}>
                  <Mic size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="seat-stack hero-stack">
                <div className="player-plate">
                  <div className="avatar-orb hero">
                    <Eye size={22} aria-hidden="true" />
                  </div>
                  <div>
                    <span>You {game.dealer === 'hero' ? 'BTN' : 'BB'}</span>
                    <strong>{formatMoney(game.players.hero.stack)}</strong>
                  </div>
                </div>
                <div className="hole-cards">
                  {cardsAreDealt
                    ? game.players.hero.holeCards.map((card) => (
                        <Card key={card} code={card} />
                      ))
                    : (
                        <>
                          <Card hidden />
                          <Card hidden />
                        </>
                      )}
                </div>
              </div>
            </div>

            <div className={`seat-commitment hero-commitment ${heroCommitted > 0 ? 'live' : ''}`} aria-label={`You have committed ${formatMoney(heroCommitted)} this street`}>
              <CircleDollarSign size={16} aria-hidden="true" />
              <span>{formatMoney(heroCommitted)}</span>
            </div>
          </section>

          {!handComplete && (
          <section className={`decision-bar ${winner ? 'match-over' : ''} ${handComplete ? 'result-dock' : ''}`}>
            {handComplete ? (
              <>
                <div className="decision-copy">
                  <p className="eyebrow">{winner ? 'Match complete' : 'Hand complete'}</p>
                  <h2>{winner ? winnerLabel(winner) : handResultTitle}</h2>
                  <p className="decision-hint">
                    {formatMoney(handPotAmount)} moved. You have {formatMoney(game.players.hero.stack)}. Tavus has {formatMoney(game.players.tavus.stack)}.
                  </p>
                </div>
                <div className="decision-controls">
                  <div className="action-buttons">
                    <button type="button" className="action-button primary-next-hand" onClick={winner ? resetMatch : dealNextHand}>
                      {winner ? <Trophy size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
                      <span>{nextHandLabel}</span>
                    </button>
                    <button
                      type="button"
                      className="action-button proof-action"
                      onClick={() => {
                        setShowContext(true)
                        setJudgeMode(true)
                      }}
                    >
                      <History size={18} aria-hidden="true" />
                      <span>Read proof</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="decision-copy">
                  <div className="decision-seatline">
                    <div className="mini-player">
                      <Eye size={17} aria-hidden="true" />
                      <span>You {game.dealer === 'hero' ? 'BTN' : 'BB'}</span>
                      <strong>{formatMoney(game.players.hero.stack)}</strong>
                    </div>
                    <div className="hole-cards decision-cards" aria-label="Your hole cards">
                      {game.players.hero.holeCards.map((card) => (
                        <Card key={`decision-${card}`} code={card} />
                      ))}
                    </div>
                  </div>
                  <div className="mobile-hand-summary" aria-label="Current hand summary">
                    <span>Pot {formatMoney(game.pot)}</span>
                    <span>{phaseLabel}</span>
                  </div>
                  <p className="eyebrow">{turnLabel}</p>
                  <h2>{actionHeadline}</h2>
                  <p className="decision-hint">{decisionHint}</p>
                </div>
                <div className="decision-controls">
                  <button type="button" className="voice-chip" aria-label="Spoken action prompt" onClick={startVoiceInput} disabled={!handIsPlayable || isTavusThinking}>
                    <Mic size={17} aria-hidden="true" />
                    <span>{voiceStatusText}</span>
                  </button>
                  {handIsPlayable && actions.length > 0 && !winner ? (
                <>
                  <div className="action-buttons">
                    {actions
                      .filter((legal) => legal.action !== 'raise' && legal.action !== 'bet')
                      .map((legal) => {
                        const Icon = ACTION_ICONS[legal.action]

                        return (
                          <button key={legal.label} type="button" className="action-button" onClick={(event) => handleAction(legal, event)} disabled={isTavusThinking}>
                            <Icon size={18} aria-hidden="true" />
                            <span>{legal.label}</span>
                          </button>
                        )
                      })}
                  </div>
                  {wagerAction && (
                    <div className="wager-control">
                      <div className="wager-topline">
                        <span>{wagerLabel}</span>
                        <strong>{formatMoney(Math.round(selectedWager))}</strong>
                      </div>
                      <input
                        type="range"
                        min={minWager}
                        max={maxWager}
                        step={1}
                        value={Math.round(selectedWager)}
                        onChange={(event) => setWager(Number(event.target.value))}
                        disabled={isTavusThinking || maxWager <= minWager}
                      />
                      <div className="wager-presets">
                        <button type="button" onClick={() => setPresetWager(minWager)} disabled={isTavusThinking}>
                          Min
                        </button>
                        <button type="button" onClick={() => setPresetWager(potWager)} disabled={isTavusThinking}>
                          Pot
                        </button>
                        <button type="button" onClick={() => setPresetWager(maxWager)} disabled={isTavusThinking}>
                          All-in
                        </button>
                        <button type="button" className="commit-wager" onClick={commitWager} disabled={isTavusThinking}>
                          {wagerCommitLabel}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="action-buttons">
                  {winner || game.street === 'Complete' ? (
                  <button type="button" className="action-button" onClick={winner ? resetMatch : dealNextHand}>
                    {winner ? <Trophy size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
                    <span>{winner ? 'New match' : 'Next hand'}</span>
                  </button>
                ) : (
                  <button type="button" className="action-button" disabled>
                    {handPhase !== 'live' ? <Sparkles size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />}
                    <span>{handPhase !== 'live' ? phaseLabel : 'Tavus thinking'}</span>
                  </button>
                )}
                </div>
              )}
                </div>
              </>
            )}
          </section>
          )}

          {game.showdown && showJudgeTrace && (
            <section className={`showdown ${game.showdown.winner === 'hero' ? 'great' : game.showdown.winner === 'tavus' ? 'punished' : 'solid'}`}>
              <div>
                <p className="eyebrow">Hand debrief</p>
                <h2>{latestDebrief?.title ?? game.showdown.summary}</h2>
                <p>{latestDebrief?.summary ?? game.showdown.summary}</p>
                {handSourceSummary.length > 0 && (
                  <div className="source-strip" aria-label="Post-hand input sources">
                    <span>Inputs</span>
                    {handSourceSummary.map((item) => (
                      <strong key={item.source}>
                        {item.label} {item.count}
                      </strong>
                    ))}
                  </div>
                )}
              </div>
              <div className="reveal-row">
                <div className="hole-cards">
                  {tavusCardsRevealed ? game.players.tavus.holeCards.map((card) => <Card key={card} code={card} />) : (
                    <>
                      <Card hidden />
                      <Card hidden />
                    </>
                  )}
                </div>
                <strong>
                  {tavusHandDisclosure}
                </strong>
              </div>
            </section>
          )}

          {showJudgeTrace && (
            <section className="context-drawer">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Post-hand proof</p>
                  <h2>{proofHeading}</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    setShowContext(false)
                    setJudgeMode(false)
                  }}
                  aria-label="Close context"
                >
                  <PhoneOff size={17} aria-hidden="true" />
                </button>
              </div>
              <div className="judge-grid">
                <div>
                  <p className="eyebrow">Reads</p>
                  <ul className="read-list">
                    {proofReads.map((read) => (
                      <li key={read.id} className={read.status}>
                        <div>
                          <strong>{describeReadEvidence(brain, read)}</strong>
                          <span>{read.status}</span>
                        </div>
                        <b>{formatPercent(read.confidence)}</b>
                      </li>
                    ))}
                    {proofReads.length === 0 && <li className="empty-proof">No hand-specific read was spent.</li>}
                  </ul>
                </div>
                <div>
                  <p className="eyebrow">Decision</p>
                  <div className="trace-copy">
                    <Metric icon={Crosshair} label="Read confidence" value={proofConfidence} />
                    <p>{proofReason}</p>
                    {judgeMode && trace && <p>{trace.pokerReason}</p>}
                  </div>
                </div>
                <div>
                  <p className="eyebrow">Evidence</p>
                  <ul className="proof-list evidence-list">
                    {(canRevealTrace && traceEvidence.length ? traceEvidence : handSignals).map((item) => (
                      <li key={item.id}>
                        <span>{item.id} · {item.source}</span>
                        <strong>{item.label}</strong>
                      </li>
                    ))}
                    {handSignals.length === 0 && <li>No evidence yet. Play a decision.</li>}
                  </ul>
                </div>
              </div>
              {proofDecisionWindow && (
                <div className="replay-chain">
                  <div>
                    <span>Spot</span>
                    <strong>
                      {proofDecisionWindow.street} · pot {formatMoney(proofDecisionWindow.pot)} · facing {formatMoney(proofDecisionWindow.facingBet)}
                    </strong>
                  </div>
                  <div>
                    <span>Human action</span>
                    <strong>
                      {proofDecisionWindow.committedAction
                        ? formatTraceAction(proofDecisionWindow.committedAction.action, proofDecisionWindow.committedAction.amount)
                        : 'none'}{' '}
                      after{' '}
                      {Math.round((proofDecisionWindow.committedAction?.latencyMs ?? 0) / 100) / 10}s
                    </strong>
                  </div>
                  <div>
                    <span>Evidence bound</span>
                    <strong>{proofDecisionWindow.signalIds.join(', ') || 'none'}</strong>
                  </div>
                </div>
              )}
              <div className="history-strip">
                {game.actionLog.slice(-6).map((entry) => (
                  <div key={entry.id}>
                    <span>{entry.street}</span>
                    <b>{entry.actor}</b>
                    <em>{entry.action}</em>
                    <b>{entry.amount ? formatMoney(entry.amount) : ''}</b>
                  </div>
                ))}
                {handTraces.map((item) => (
                  <div key={item.id}>
                    <span>{item.street}</span>
                    <b><History size={13} aria-hidden="true" /></b>
                    <em>{item.action}</em>
                    <b>{formatPercent(item.confidence)}</b>
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
