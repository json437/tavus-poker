import pokerSolver from 'pokersolver'
import type { SolvedPokerHand } from 'pokersolver'
import { cardLabel, createDeck, estimateHeroEquity, formatMoney, formatPercent } from './poker'
import type { CardCode, PlayerAction, TavusLineType } from './poker'

const { Hand } = pokerSolver

export type PlayerId = 'hero' | 'tavus'
export type HoldemStreet = 'Preflop' | 'Flop' | 'Turn' | 'River' | 'Showdown' | 'Complete'
export type HoldemAction = PlayerAction

export type PlayerState = {
  id: PlayerId
  name: string
  stack: number
  holeCards: CardCode[]
  contribution: number
  folded: boolean
  acted: boolean
  allIn: boolean
}

export type PlayerProfile = {
  pressureSensitivity: number
  curiosity: number
  aggression: number
  handsPlayed: number
  lastTell: string
}

export type ActionLogEntry = {
  id: string
  handNumber: number
  actor: PlayerId | 'dealer'
  street: HoldemStreet
  action: string
  amount?: number
  note?: string
}

export type ShowdownResult = {
  winner: PlayerId | 'split'
  heroHand: string
  tavusHand: string
  potAmount: number
  summary: string
  cardsRevealed: boolean
}

export type TavusStrategyInput = {
  bluffBias: number
  callDownBias: number
  pressureBias: number
  trapBias: number
  confidence: number
  readIds: string[]
  evidenceIds: string[]
  rationale: string
}

export type TavusDecisionTrace = {
  sequence: number
  street: HoldemStreet
  action: HoldemAction
  amount?: number
  line: TavusLineType
  talk: string
  pokerReason: string
  behavioralReason: string
  confidence: number
  equity: number
  potOdds: number
  readIds: string[]
  evidenceIds: string[]
}

export type HoldemGameState = {
  handNumber: number
  dealer: PlayerId
  smallBlind: number
  bigBlind: number
  deck: CardCode[]
  board: CardCode[]
  street: HoldemStreet
  pot: number
  currentBet: number
  minRaise: number
  toAct: PlayerId | null
  players: Record<PlayerId, PlayerState>
  profile: PlayerProfile
  actionLog: ActionLogEntry[]
  lastTavusLine: TavusLineType
  lastTavusTalk: string
  lastTavusDecision?: TavusDecisionTrace
  tavusDecisionLog: TavusDecisionTrace[]
  showdown?: ShowdownResult
}

export type LegalAction = {
  action: HoldemAction
  label: string
  amount?: number
}

export type ApplyActionResult = {
  game: HoldemGameState
  tell: string
}

type TavusDecision = {
  action: HoldemAction
  amount?: number
  line: TavusLineType
  talk: string
  pokerReason: string
  behavioralReason: string
  confidence: number
  equity: number
  potOdds: number
  readIds: string[]
  evidenceIds: string[]
}

export const STARTING_STACK = 300
const BASE_BIG_BLIND = 10
const BLIND_LEVEL_HANDS = 3
const MAX_BIG_BLIND = 120

const NEUTRAL_TAVUS_STRATEGY: TavusStrategyInput = {
  bluffBias: 0,
  callDownBias: 0,
  pressureBias: 0,
  trapBias: 0,
  confidence: 0.35,
  readIds: [],
  evidenceIds: [],
  rationale: 'No behavioral read is active; Tavus is playing cards, price, and position.',
}

const TAVUS_TALK: Record<TavusLineType, string[]> = {
  value: [
    'I like my hand enough to charge the next card.',
    'This board is getting expensive for the worse hand.',
    'I am betting because the price should not be cheap here.',
  ],
  bluff: [
    'This is a tough spot to defend cleanly.',
    'I am going to make you prove you want this pot.',
    'You can have it if you are willing to pay for it.',
  ],
  'semi-bluff': [
    'I have enough ways to keep applying pressure.',
    'There are turn cards that make this worse for you.',
    'I am not waiting for the perfect card to start betting.',
  ],
  'thin value': [
    'Small bet. Real price.',
    'I think this gets called by enough worse hands.',
    'I am setting a price and seeing if you pay it.',
  ],
  trap: [
    'I will check and let the hand breathe.',
    'No rush. I want to see what you do with the spot.',
    'Interesting board. I am going to pass the action.',
  ],
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 'hero' ? 'tavus' : 'hero'
}

function randomItem<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function cloneGame(game: HoldemGameState): HoldemGameState {
  return {
    ...game,
    board: [...game.board],
    deck: [...game.deck],
    players: {
      hero: { ...game.players.hero, holeCards: [...game.players.hero.holeCards] },
      tavus: { ...game.players.tavus, holeCards: [...game.players.tavus.holeCards] },
    },
    profile: { ...game.profile },
    actionLog: [...game.actionLog],
    lastTavusDecision: game.lastTavusDecision ? { ...game.lastTavusDecision } : undefined,
    tavusDecisionLog: game.tavusDecisionLog.map((decision) => ({ ...decision, readIds: [...decision.readIds], evidenceIds: [...decision.evidenceIds] })),
    showdown: game.showdown ? { ...game.showdown } : undefined,
  }
}

function log(game: HoldemGameState, entry: Omit<ActionLogEntry, 'id' | 'handNumber'>) {
  game.actionLog.push({
    id: `h${game.handNumber}-a${game.actionLog.length + 1}`,
    handNumber: game.handNumber,
    ...entry,
  })
}

function postBlind(game: HoldemGameState, playerId: PlayerId, amount: number) {
  const player = game.players[playerId]
  const paid = Math.min(player.stack, amount)
  player.stack -= paid
  player.contribution += paid
  player.allIn = player.stack === 0
  game.pot += paid
  game.currentBet = Math.max(game.currentBet, player.contribution)
  log(game, { actor: playerId, street: 'Preflop', action: amount === game.smallBlind ? 'posts small blind' : 'posts big blind', amount: paid })
}

export function blindsForHand(handNumber: number): Pick<HoldemGameState, 'smallBlind' | 'bigBlind'> {
  const level = Math.floor((handNumber - 1) / BLIND_LEVEL_HANDS)
  const bigBlind = Math.min(MAX_BIG_BLIND, BASE_BIG_BLIND * 2 ** level)
  return {
    smallBlind: Math.max(1, Math.floor(bigBlind / 2)),
    bigBlind,
  }
}

export function matchWinner(game: HoldemGameState): PlayerId | null {
  if (game.players.hero.stack <= 0 && game.players.tavus.stack > 0) return 'tavus'
  if (game.players.tavus.stack <= 0 && game.players.hero.stack > 0) return 'hero'
  return null
}

export function startHoldemHand(
  previous?: HoldemGameState,
  random: () => number = Math.random,
  strategy: TavusStrategyInput = NEUTRAL_TAVUS_STRATEGY,
): HoldemGameState {
  const handNumber = previous ? previous.handNumber + 1 : 1
  const dealer: PlayerId = previous ? otherPlayer(previous.dealer) : 'hero'
  const blinds = blindsForHand(handNumber)
  const shuffled = shuffle(createDeck(), random)
  const heroStack = previous ? previous.players.hero.stack : STARTING_STACK
  const tavusStack = previous ? previous.players.tavus.stack : STARTING_STACK

  if (previous && (heroStack <= 0 || tavusStack <= 0)) {
    throw new Error('Cannot start a new hand after the match has a winner.')
  }

  const game: HoldemGameState = {
    handNumber,
    dealer,
    smallBlind: blinds.smallBlind,
    bigBlind: blinds.bigBlind,
    deck: shuffled.slice(4),
    board: [],
    street: 'Preflop',
    pot: 0,
    currentBet: 0,
    minRaise: blinds.bigBlind,
    toAct: dealer,
    players: {
      hero: {
        id: 'hero',
        name: 'You',
        stack: heroStack,
        holeCards: [shuffled[0], shuffled[2]],
        contribution: 0,
        folded: false,
        acted: false,
        allIn: false,
      },
      tavus: {
        id: 'tavus',
        name: 'Tavus',
        stack: tavusStack,
        holeCards: [shuffled[1], shuffled[3]],
        contribution: 0,
        folded: false,
        acted: false,
        allIn: false,
      },
    },
    profile: previous?.profile
      ? { ...previous.profile, handsPlayed: previous.profile.handsPlayed + 1 }
      : {
          pressureSensitivity: 0.5,
          curiosity: 0.42,
          aggression: 0.44,
          handsPlayed: 1,
          lastTell: 'baseline not established',
        },
    actionLog: [],
    lastTavusLine: 'thin value',
    lastTavusTalk: 'Your move. Say it out loud.',
    tavusDecisionLog: [],
  }

  postBlind(game, dealer, game.smallBlind)
  postBlind(game, otherPlayer(dealer), game.bigBlind)
  log(game, { actor: 'dealer', street: 'Preflop', action: `deals hand ${handNumber}`, note: `${dealer === 'hero' ? 'You have' : 'Tavus has'} the button` })
  if (everyoneSettled(game)) {
    advanceStreet(game)
    return game
  }

  return autoPlayTavus(game, random, strategy)
}

export function toCall(game: HoldemGameState, playerId: PlayerId): number {
  return Math.max(0, game.currentBet - game.players[playerId].contribution)
}

function activePlayers(game: HoldemGameState): PlayerState[] {
  return Object.values(game.players).filter((player) => !player.folded)
}

function everyoneSettled(game: HoldemGameState): boolean {
  const players = activePlayers(game)
  const maxContribution = Math.max(...players.map((player) => player.contribution))
  const nonAllInPlayers = players.filter((player) => !player.allIn)

  if (players.some((player) => player.allIn) && nonAllInPlayers.length <= 1 && nonAllInPlayers.every((player) => player.contribution >= maxContribution)) {
    return true
  }

  return players.every((player) => player.acted || player.allIn) && players.every((player) => player.contribution === game.currentBet || player.allIn)
}

function drawBoardCards(game: HoldemGameState, count: number) {
  game.board.push(...game.deck.slice(0, count))
  game.deck = game.deck.slice(count)
}

function solve(cards: CardCode[]): SolvedPokerHand {
  return Hand.solve(cards)
}

function returnUncalledContribution(game: HoldemGameState) {
  const players = activePlayers(game)
  if (players.length !== 2) return

  const [first, second] = players
  if (first.contribution === second.contribution) return

  const overContributor = first.contribution > second.contribution ? first : second
  const underContributor = overContributor === first ? second : first
  const refund = overContributor.contribution - underContributor.contribution
  if (refund <= 0) return

  overContributor.contribution -= refund
  overContributor.stack += refund
  game.pot -= refund
  log(game, { actor: 'dealer', street: game.street, action: 'returns uncalled chips', amount: refund, note: `${overContributor.name} had ${formatMoney(refund)} unmatched.` })
}

function showdown(game: HoldemGameState) {
  returnUncalledContribution(game)
  game.street = 'Showdown'
  game.toAct = null
  const potAmount = game.pot

  while (game.board.length < 5) {
    drawBoardCards(game, 1)
  }

  const heroHand = solve([...game.players.hero.holeCards, ...game.board])
  const tavusHand = solve([...game.players.tavus.holeCards, ...game.board])
  const winners = Hand.winners([heroHand, tavusHand])
  const heroWins = winners.includes(heroHand)
  const tavusWins = winners.includes(tavusHand)

  if (heroWins && tavusWins) {
    const baseShare = Math.floor(potAmount / 2)
    const oddChipRecipient = otherPlayer(game.dealer)
    const oddChip = potAmount - baseShare * 2
    game.players.hero.stack += baseShare + (oddChipRecipient === 'hero' ? oddChip : 0)
    game.players.tavus.stack += baseShare + (oddChipRecipient === 'tavus' ? oddChip : 0)
    game.showdown = {
      winner: 'split',
      heroHand: heroHand.descr,
      tavusHand: tavusHand.descr,
      potAmount,
      summary: `Split pot. You had ${heroHand.descr}; Tavus had ${tavusHand.descr}.${oddChip ? ` Odd chip to ${oddChipRecipient === 'hero' ? 'you' : 'Tavus'}.` : ''}`,
      cardsRevealed: true,
    }
  } else if (heroWins) {
    game.players.hero.stack += potAmount
    game.showdown = {
      winner: 'hero',
      heroHand: heroHand.descr,
      tavusHand: tavusHand.descr,
      potAmount,
      summary: `You win ${formatMoney(potAmount)} with ${heroHand.descr}. Tavus had ${tavusHand.descr}.`,
      cardsRevealed: true,
    }
  } else {
    game.players.tavus.stack += potAmount
    game.showdown = {
      winner: 'tavus',
      heroHand: heroHand.descr,
      tavusHand: tavusHand.descr,
      potAmount,
      summary: `Tavus wins ${formatMoney(potAmount)} with ${tavusHand.descr}. You had ${heroHand.descr}.`,
      cardsRevealed: true,
    }
  }

  log(game, { actor: 'dealer', street: 'Showdown', action: 'showdown', note: game.showdown.summary })
  game.players.hero.contribution = 0
  game.players.tavus.contribution = 0
  game.currentBet = 0
  game.pot = 0
  game.street = 'Complete'
}

function awardFold(game: HoldemGameState, winner: PlayerId) {
  const potAmount = game.pot
  game.players[winner].stack += potAmount
  game.showdown = {
    winner,
    heroHand: game.players.hero.folded ? 'folded' : 'not shown',
    tavusHand: game.players.tavus.folded ? 'folded' : 'mucked',
    potAmount,
    summary: `${winner === 'hero' ? 'You win' : 'Tavus wins'} ${formatMoney(potAmount)} after a fold.`,
    cardsRevealed: false,
  }
  log(game, { actor: 'dealer', street: game.street, action: 'awards pot', amount: potAmount, note: game.showdown.summary })
  game.players.hero.contribution = 0
  game.players.tavus.contribution = 0
  game.currentBet = 0
  game.pot = 0
  game.toAct = null
  game.street = 'Complete'
}

function advanceStreet(game: HoldemGameState) {
  if (game.players.hero.allIn || game.players.tavus.allIn) {
    showdown(game)
    return
  }

  game.players.hero.contribution = 0
  game.players.tavus.contribution = 0
  game.players.hero.acted = false
  game.players.tavus.acted = false
  game.currentBet = 0
  game.minRaise = game.bigBlind

  if (game.street === 'Preflop') {
    game.street = 'Flop'
    drawBoardCards(game, 3)
  } else if (game.street === 'Flop') {
    game.street = 'Turn'
    drawBoardCards(game, 1)
  } else if (game.street === 'Turn') {
    game.street = 'River'
    drawBoardCards(game, 1)
  } else {
    showdown(game)
    return
  }

  game.toAct = otherPlayer(game.dealer)
  log(game, { actor: 'dealer', street: game.street, action: `deals ${game.street.toLowerCase()}`, note: game.board.map(cardLabel).join(' ') })
}

function putChips(game: HoldemGameState, playerId: PlayerId, amount: number): number {
  const player = game.players[playerId]
  const paid = Math.min(player.stack, Math.max(0, amount))
  player.stack -= paid
  player.contribution += paid
  player.allIn = player.stack === 0
  game.pot += paid
  return paid
}

function applyAction(game: HoldemGameState, playerId: PlayerId, action: HoldemAction, amount = 0, note?: string): HoldemGameState {
  const next = cloneGame(game)
  const player = next.players[playerId]
  const callAmount = toCall(next, playerId)

  if (next.toAct !== playerId || next.street === 'Complete') {
    return next
  }

  if (action === 'fold') {
    player.folded = true
    player.acted = true
    log(next, { actor: playerId, street: next.street, action: 'folds', note })
    awardFold(next, otherPlayer(playerId))
    return next
  }

  if (action === 'check') {
    if (callAmount > 0) return next
    player.acted = true
    log(next, { actor: playerId, street: next.street, action: 'checks', note })
  }

  if (action === 'call') {
    const paid = putChips(next, playerId, callAmount)
    player.acted = true
    log(next, { actor: playerId, street: next.street, action: 'calls', amount: paid, note })
  }

  if (action === 'bet') {
    if (next.currentBet > 0) return next
    const target = Math.max(next.bigBlind, Math.min(player.stack, amount))
    const paid = putChips(next, playerId, target)
    next.currentBet = player.contribution
    next.minRaise = Math.max(next.bigBlind, paid)
    player.acted = true
    next.players[otherPlayer(playerId)].acted = false
    log(next, { actor: playerId, street: next.street, action: 'bets', amount: paid, note })
  }

  if (action === 'raise') {
    if (next.currentBet <= 0) return next
    const availableTotal = player.contribution + player.stack
    if (availableTotal <= next.currentBet) return next

    const previousMinRaise = next.minRaise
    const minimumRaiseTo = next.currentBet + next.minRaise
    const target = Math.max(minimumRaiseTo, amount)
    const raiseTo = Math.min(availableTotal, target)
    if (raiseTo <= next.currentBet) return next

    const previousBet = next.currentBet
    const paid = putChips(next, playerId, raiseTo - player.contribution)
    next.currentBet = player.contribution
    next.minRaise = raiseTo >= minimumRaiseTo ? Math.max(next.bigBlind, next.currentBet - previousBet) : previousMinRaise
    player.acted = true
    next.players[otherPlayer(playerId)].acted = false
    log(next, { actor: playerId, street: next.street, action: 'raises to', amount: raiseTo, note: paid < raiseTo ? `${note ?? ''} Put in ${formatMoney(paid)} more.`.trim() : note })
  }

  if (everyoneSettled(next)) {
    advanceStreet(next)
  } else {
    next.toAct = otherPlayer(playerId)
  }

  return next
}

export function legalActions(game: HoldemGameState, playerId: PlayerId = 'hero'): LegalAction[] {
  if (game.toAct !== playerId || game.street === 'Complete') return []

  const callAmount = toCall(game, playerId)
  const player = game.players[playerId]
  const opponent = game.players[otherPlayer(playerId)]
  const availableTotal = player.stack + player.contribution

  if (player.allIn || player.stack <= 0) return []

  if (callAmount > 0) {
    const callCost = Math.min(player.stack, callAmount)
    const actions: LegalAction[] = [
      { action: 'fold', label: 'Fold' },
      { action: 'call', label: callCost < callAmount ? `All-in ${formatMoney(callCost)}` : `Call ${formatMoney(callCost)}`, amount: callCost },
    ]

    if (!opponent.allIn && availableTotal > game.currentBet) {
      const minimumRaiseTo = game.currentBet + game.minRaise
      const preferredRaiseTo = Math.max(minimumRaiseTo, game.currentBet + Math.round(game.pot * 0.75))
      const raiseTo = Math.min(availableTotal, preferredRaiseTo)
      actions.push({
        action: 'raise',
        label: raiseTo >= minimumRaiseTo ? `Raise to ${formatMoney(raiseTo)}` : `All-in ${formatMoney(raiseTo)}`,
        amount: raiseTo,
      })
    }

    return actions
  }

  if (game.currentBet > 0) {
    const actions: LegalAction[] = playerId === 'hero' ? [{ action: 'fold', label: 'Fold' }, { action: 'check', label: 'Check' }] : [{ action: 'check', label: 'Check' }]

    if (!opponent.allIn && availableTotal > game.currentBet) {
      const minimumRaiseTo = game.currentBet + game.minRaise
      const preferredRaiseTo = Math.max(minimumRaiseTo, game.currentBet + Math.round(game.pot * 0.75))
      const raiseTo = Math.min(availableTotal, preferredRaiseTo)
      actions.push({
        action: 'raise',
        label: raiseTo >= minimumRaiseTo ? `Raise to ${formatMoney(raiseTo)}` : `All-in ${formatMoney(raiseTo)}`,
        amount: raiseTo,
      })
    }

    return actions
  }

  if (opponent.allIn) {
    return playerId === 'hero' ? [{ action: 'fold', label: 'Fold' }, { action: 'check', label: 'Check' }] : [{ action: 'check', label: 'Check' }]
  }

  const potBet = Math.min(player.stack, Math.max(game.bigBlind, Math.round(game.pot * 0.65)))
  const openActions: LegalAction[] = playerId === 'hero' ? [{ action: 'fold', label: 'Fold' }, { action: 'check', label: 'Check' }] : [{ action: 'check', label: 'Check' }]
  return [...openActions, { action: 'bet', label: potBet < game.bigBlind ? `All-in ${formatMoney(potBet)}` : `Bet ${formatMoney(potBet)}`, amount: potBet }]
}

export function estimateTavusEquity(game: HoldemGameState, random: () => number): number {
  return estimateHeroEquity(game.players.tavus.holeCards, game.board, [], 380, random)
}

function tavusTalk(line: TavusLineType, random: () => number): string {
  return randomItem(TAVUS_TALK[line], random)
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function chooseTavusDecision(
  game: HoldemGameState,
  random: () => number,
  strategy: TavusStrategyInput = NEUTRAL_TAVUS_STRATEGY,
): TavusDecision {
  const tavusLegalActions = legalActions(game, 'tavus')
  const legalRaise = tavusLegalActions.find((action) => action.action === 'raise')
  const legalBet = tavusLegalActions.find((action) => action.action === 'bet')
  const legalCall = tavusLegalActions.find((action) => action.action === 'call')
  const legalCheck = tavusLegalActions.find((action) => action.action === 'check')
  const equity = estimateTavusEquity(game, random)
  const callAmount = toCall(game, 'tavus')
  const potOdds = callAmount > 0 ? callAmount / (game.pot + callAmount) : 0
  const pressureBonus = game.profile.pressureSensitivity * 0.18
  const bluffChance = clamp(0.08 + pressureBonus + strategy.bluffBias + strategy.pressureBias + (game.street === 'River' ? 0.08 : 0), 0, 0.58)
  const callAdjustment = strategy.callDownBias
  const confidence = clamp(0.38 + Math.abs(equity - potOdds) * 0.42 + strategy.confidence * 0.24, 0.38, 0.86)
  const behavioralReason = strategy.evidenceIds.length > 0 ? strategy.rationale : NEUTRAL_TAVUS_STRATEGY.rationale
  const player = game.players.tavus

  if (callAmount > 0) {
    const shouldBluffRaise = Boolean(legalRaise) && random() < bluffChance && player.stack > callAmount
    if (legalRaise && (equity > potOdds + 0.22 || shouldBluffRaise)) {
      const line: TavusLineType = shouldBluffRaise && equity < 0.48 ? 'bluff' : equity > 0.64 ? 'value' : 'semi-bluff'
      return {
        action: 'raise',
        amount: legalRaise.amount,
        line,
        talk: tavusTalk(line, random),
        pokerReason: `Equity ${formatPercent(equity)} versus pot odds ${formatPercent(potOdds)} supports ${line === 'bluff' ? 'pressure' : 'raising'}.`,
        behavioralReason,
        confidence,
        equity,
        potOdds,
        readIds: strategy.readIds,
        evidenceIds: strategy.evidenceIds,
      }
    }

    if (legalCall && (equity >= potOdds - 0.02 - callAdjustment || random() < game.profile.curiosity * 0.16 + strategy.callDownBias)) {
      const line: TavusLineType = equity > 0.54 ? 'thin value' : 'trap'
      return {
        action: 'call',
        line,
        talk: tavusTalk(line, random),
        pokerReason: `Continues with ${formatPercent(equity)} estimated equity against ${formatPercent(potOdds)} pot odds.`,
        behavioralReason,
        confidence,
        equity,
        potOdds,
        readIds: strategy.readIds,
        evidenceIds: strategy.evidenceIds,
      }
    }

    return {
      action: 'fold',
      line: 'thin value',
      talk: 'Fine. You found a spot where I believe you.',
      pokerReason: `Folds because ${formatPercent(equity)} equity is below the price.`,
      behavioralReason,
      confidence,
      equity,
      potOdds,
      readIds: strategy.readIds,
      evidenceIds: strategy.evidenceIds,
    }
  }

  if (legalBet && (equity > 0.6 || random() < bluffChance)) {
    const line: TavusLineType = equity > 0.66 ? 'value' : equity > 0.48 ? 'semi-bluff' : 'bluff'
    return {
      action: 'bet',
      amount: legalBet.amount,
      line,
      talk: tavusTalk(line, random),
      pokerReason: `Opens pressure with ${formatPercent(equity)} estimated equity.`,
      behavioralReason,
      confidence,
      equity,
      potOdds,
      readIds: strategy.readIds,
      evidenceIds: strategy.evidenceIds,
    }
  }

  return {
    action: legalCheck?.action ?? 'check',
    line: equity > 0.52 ? 'trap' : 'thin value',
    talk: tavusTalk(equity > 0.52 ? 'trap' : 'thin value', random),
    pokerReason: `Keeps the pot controlled at ${formatPercent(equity)} estimated equity.`,
    behavioralReason,
    confidence,
    equity,
    potOdds,
    readIds: strategy.readIds,
    evidenceIds: strategy.evidenceIds,
  }
}

function autoPlayTavus(
  game: HoldemGameState,
  random: () => number,
  strategy: TavusStrategyInput = NEUTRAL_TAVUS_STRATEGY,
): HoldemGameState {
  let next = game
  let guard = 0

  while (next.toAct === 'tavus' && next.street !== 'Complete' && guard < 8) {
    const decision = chooseTavusDecision(next, random, strategy)
    const trace: TavusDecisionTrace = {
      sequence: next.tavusDecisionLog.length + 1,
      street: next.street,
      action: decision.action,
      amount: decision.amount,
      line: decision.line,
      talk: decision.talk,
      pokerReason: decision.pokerReason,
      behavioralReason: decision.behavioralReason,
      confidence: decision.confidence,
      equity: decision.equity,
      potOdds: decision.potOdds,
      readIds: decision.readIds,
      evidenceIds: decision.evidenceIds,
    }
    next.lastTavusLine = decision.line
    next.lastTavusTalk = decision.talk
    next.lastTavusDecision = trace
    next.tavusDecisionLog = [...next.tavusDecisionLog, trace]
    next = applyAction(next, 'tavus', decision.action, decision.amount, `${decision.pokerReason} ${decision.behavioralReason}`)
    guard += 1
  }

  return next
}

function updateProfile(profile: PlayerProfile, action: HoldemAction, callAmount: number, latencyMs: number): PlayerProfile {
  const next = { ...profile }
  const longTank = latencyMs > 6500
  const snap = latencyMs < 1600

  if (action === 'fold' && callAmount > 0) {
    next.pressureSensitivity = Math.min(1, next.pressureSensitivity + (longTank ? 0.16 : 0.1))
    next.lastTell = longTank ? 'long tank then fold under pressure' : 'folded to pressure'
  } else if (action === 'call' && callAmount > 0) {
    next.curiosity = Math.min(1, next.curiosity + (snap ? 0.12 : 0.07))
    next.lastTell = snap ? 'snap-called pressure' : 'called after thinking'
  } else if (action === 'raise' || action === 'bet') {
    next.aggression = Math.min(1, next.aggression + (snap ? 0.14 : 0.08))
    next.lastTell = snap ? 'fast aggression spike' : 'applied pressure back'
  } else {
    next.lastTell = longTank ? 'long pause before checking' : 'kept pot controlled'
  }

  if (action !== 'fold') {
    next.pressureSensitivity = Math.max(0, next.pressureSensitivity - 0.025)
  }

  return next
}

export function applyHeroAction(
  game: HoldemGameState,
  action: HoldemAction,
  amount = 0,
  latencyMs = 0,
  random: () => number = Math.random,
  strategy: TavusStrategyInput = NEUTRAL_TAVUS_STRATEGY,
): ApplyActionResult {
  const callAmount = toCall(game, 'hero')
  const tell = latencyMs > 6500 ? 'long tank' : latencyMs < 1600 ? 'snap decision' : 'measured timing'
  const withProfile = cloneGame(game)
  withProfile.profile = updateProfile(withProfile.profile, action, callAmount, latencyMs)
  const afterHero = applyAction(withProfile, 'hero', action, amount, `tell: ${tell}; profile: ${withProfile.profile.lastTell}`)
  return {
    game: autoPlayTavus(afterHero, random, strategy),
    tell,
  }
}

export function visibleTavusCards(game: HoldemGameState): CardCode[] | null {
  return game.showdown?.cardsRevealed ? game.players.tavus.holeCards : null
}

export function buildHoldemTavusContext(game: HoldemGameState): string {
  const userCardContext =
    game.showdown?.cardsRevealed
      ? `User revealed cards: ${game.players.hero.holeCards.map(cardLabel).join(' ')}.`
      : 'User private hole cards: hidden from you until showdown. Infer strength only from public board, betting, timing, speech, and Raven signals.'
  const userLegalActions = legalActions(game, 'hero')
  const userActionContext =
    game.toAct === 'hero' && userLegalActions.length > 0
      ? `Action is on the user. Spoken legal actions: ${userLegalActions.map((action) => action.label).join(', ')}. Ask for a spoken poker action and validate sizing in-world.`
      : game.toAct === 'tavus'
        ? 'Action is on you. Choose your poker action privately from the app-provided policy.'
        : 'No player action is currently pending.'

  return [
    'You are TavusPoker, an embodied heads-up no-limit Texas hold’em opponent.',
    'You are playing a real hand with blinds, stacks, streets, legal actions, and showdown controlled by the app.',
    'You are also the in-world table voice. Run the hand through spoken poker language, not browser instructions.',
    'Never tell the user to click, press, tap, drag, use a slider, or use the UI. Buttons exist only as backup controls outside the fiction.',
    'You may joke, needle, pause, and apply social pressure. Use perception as soft tells only.',
    'Never reveal your private hole cards before showdown. Never claim certainty from a tell.',
    'You are trying to beat the user, so keep live reads private. Needle with ambiguity; do not explain your model until a post-hand debrief asks for proof.',
    `Hand ${game.handNumber}. Street: ${game.street}. Button: ${game.dealer}. Pot: ${formatMoney(game.pot)}.`,
    `Board: ${game.board.length ? game.board.map(cardLabel).join(' ') : 'no board yet'}.`,
    `Your private Tavus cards: ${game.players.tavus.holeCards.map(cardLabel).join(' ')}. Do not reveal these before showdown.`,
    userCardContext,
    `Stacks: Tavus ${formatMoney(game.players.tavus.stack)}, user ${formatMoney(game.players.hero.stack)}.`,
    `Fast timing profile: pressure sensitivity ${formatPercent(game.profile.pressureSensitivity)}, curiosity ${formatPercent(game.profile.curiosity)}, aggression ${formatPercent(game.profile.aggression)}.`,
    `Last observed tell: ${game.profile.lastTell}.`,
    userActionContext,
    `Your latest table talk: "${game.lastTavusTalk}"`,
    'Ask the user to say their action out loud. If the user gives an illegal or incomplete spoken action, ask for the missing poker information in-world.',
    'React to timing, facial expression, gaze, tone, and wording as private probabilistic signals.',
  ].join('\n')
}
