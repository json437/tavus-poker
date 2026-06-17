import pokerSolver from 'pokersolver'
import type { SolvedPokerHand } from 'pokersolver'

const { Hand } = pokerSolver

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
const SUITS = ['s', 'h', 'd', 'c'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]
export type CardCode = `${Rank}${Suit}`
export type Street = 'Flop' | 'Turn' | 'River'
export type PlayerAction = 'fold' | 'call' | 'raise' | 'check' | 'bet'
export type TavusLineType = 'value' | 'bluff' | 'semi-bluff' | 'thin value' | 'trap'
export type DecisionQuality = 'great' | 'solid' | 'thin' | 'punished'

export type PlayingCard = {
  code: CardCode
  rank: Rank
  displayRank: string
  suit: Suit
  suitLabel: string
  suitSymbol: string
  color: 'red' | 'black'
  label: string
}

export type BoardTexture = {
  label: string
  tags: string[]
  pressure: number
}

export type TavusAction = {
  action: 'checks' | 'bets' | 'raises' | 'jams'
  amount: number
  lineType: TavusLineType
  confidence: number
  tableTalk: string
}

export type PokerSpot = {
  id: string
  handNumber: number
  street: Street
  position: string
  heroCards: CardCode[]
  tavusCards: CardCode[]
  board: CardCode[]
  pot: number
  effectiveStack: number
  toCall: number
  minRaise: number
  heroEquity: number
  tavusEquity: number
  heroHand: string
  tavusHand: string
  texture: BoardTexture
  tavusAction: TavusAction
  recommendedAction: PlayerAction
  recommendedSize: number
  potOdds: number
  readPrompt: string
}

export type TellProfile = {
  latencyMs: number
  label: string
  pressure: number
  signal: string
}

export type DecisionResult = {
  action: PlayerAction
  amount: number
  quality: DecisionQuality
  score: number
  outcome: string
  coachNote: string
  reveal: string
  tell: TellProfile
}

const SUIT_META: Record<Suit, Pick<PlayingCard, 'suitLabel' | 'suitSymbol' | 'color'>> = {
  s: { suitLabel: 'spades', suitSymbol: '♠', color: 'black' },
  h: { suitLabel: 'hearts', suitSymbol: '♥', color: 'red' },
  d: { suitLabel: 'diamonds', suitSymbol: '♦', color: 'red' },
  c: { suitLabel: 'clubs', suitSymbol: '♣', color: 'black' },
}

const TABLE_TALK: Record<TavusLineType, string[]> = {
  value: [
    'I do not think you can let this one go, but I also do not think you like it.',
    'Your range has a lot of almost-hands here. I am charging every one of them.',
    'This board is louder than your face right now.',
  ],
  bluff: [
    'You looked a little too comfortable when that card landed.',
    'If you had it, you would not be studying me this hard.',
    'I am going to make you decide whether that hand is real.',
  ],
  'semi-bluff': [
    'Plenty of cards make my story better. Let us make this uncomfortable now.',
    'This is not a made hand conversation. This is a pressure conversation.',
    'I can win this now or later. That is a nice little luxury.',
  ],
  'thin value': [
    'I think you call too wide here. That is useful information.',
    'This is the kind of spot where people pay to confirm bad news.',
    'Small bet. Big question.',
  ],
  trap: [
    'I will give you room to do something ambitious.',
    'Go on. Tell me what story you want to tell.',
    'I am listening. Maybe too patiently.',
  ],
}

export function createDeck(): CardCode[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}` as CardCode))
}

export function toPlayingCard(code: CardCode): PlayingCard {
  const rank = code[0] as Rank
  const suit = code[1] as Suit
  const meta = SUIT_META[suit]
  const displayRank = rank === 'T' ? '10' : rank

  return {
    code,
    rank,
    displayRank,
    suit,
    ...meta,
    label: `${displayRank}${meta.suitSymbol}`,
  }
}

export function formatMoney(amount: number): string {
  return `$${amount.toFixed(0)}`
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function cardLabel(code: CardCode): string {
  return toPlayingCard(code).label
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

function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank)
}

function solveHand(cards: CardCode[]): SolvedPokerHand {
  return Hand.solve(cards)
}

function getBoardTexture(board: CardCode[]): BoardTexture {
  const ranks = board.map((card) => card[0] as Rank)
  const suits = board.map((card) => card[1] as Suit)
  const uniqueRanks = new Set(ranks)
  const suitCounts = suits.reduce<Record<Suit, number>>(
    (counts, suit) => ({ ...counts, [suit]: counts[suit] + 1 }),
    { s: 0, h: 0, d: 0, c: 0 },
  )
  const rankNumbers = [...new Set(ranks.map(rankValue))].sort((a, b) => a - b)
  const gaps = rankNumbers.slice(1).map((value, index) => value - rankNumbers[index])
  const straighty = gaps.some((gap) => gap <= 2) && rankNumbers.length >= 3
  const flushy = Object.values(suitCounts).some((count) => count >= 3)
  const paired = uniqueRanks.size < ranks.length

  const tags = [
    paired ? 'paired' : 'unpaired',
    flushy ? 'flush pressure' : Object.values(suitCounts).some((count) => count === 2) ? 'two-tone' : 'rainbow',
    straighty ? 'connected' : 'spread',
  ]

  const pressure = (flushy ? 0.2 : 0) + (straighty ? 0.22 : 0) + (paired ? 0.16 : 0)
  return {
    label: `${tags[0]}, ${tags[1]}, ${tags[2]}`,
    tags,
    pressure: Math.min(0.75, pressure + 0.22),
  }
}

function compareSolvedHands(hero: SolvedPokerHand, tavus: SolvedPokerHand): 'hero' | 'tavus' | 'tie' {
  const winners = Hand.winners([hero, tavus])
  const heroWon = winners.includes(hero)
  const tavusWon = winners.includes(tavus)

  if (heroWon && tavusWon) {
    return 'tie'
  }

  return heroWon ? 'hero' : 'tavus'
}

export function estimateHeroEquity(
  heroCards: CardCode[],
  board: CardCode[],
  knownDeadCards: CardCode[] = [],
  trials = 900,
  random: () => number = Math.random,
): number {
  const knownCards = new Set([...heroCards, ...board, ...knownDeadCards])
  const available = createDeck().filter((card) => !knownCards.has(card))
  let score = 0

  for (let trial = 0; trial < trials; trial += 1) {
    const deck = shuffle(available, random)
    const villain = deck.slice(0, 2)
    const runout = [...board, ...deck.slice(2, 2 + (5 - board.length))]
    const result = compareSolvedHands(solveHand([...heroCards, ...runout]), solveHand([...villain, ...runout]))

    if (result === 'hero') {
      score += 1
    } else if (result === 'tie') {
      score += 0.5
    }
  }

  return score / trials
}

function exactEquityAgainstTavus(heroCards: CardCode[], tavusCards: CardCode[], board: CardCode[]): number {
  const knownCards = new Set([...heroCards, ...tavusCards, ...board])
  const available = createDeck().filter((card) => !knownCards.has(card))
  const cardsNeeded = 5 - board.length
  let score = 0
  let outcomes = 0

  if (cardsNeeded === 0) {
    const result = compareSolvedHands(solveHand([...heroCards, ...board]), solveHand([...tavusCards, ...board]))
    return result === 'hero' ? 1 : result === 'tie' ? 0.5 : 0
  }

  for (let i = 0; i < available.length; i += 1) {
    const first = available[i]
    if (cardsNeeded === 1) {
      const runout = [...board, first]
      const result = compareSolvedHands(solveHand([...heroCards, ...runout]), solveHand([...tavusCards, ...runout]))
      score += result === 'hero' ? 1 : result === 'tie' ? 0.5 : 0
      outcomes += 1
    } else {
      for (let j = i + 1; j < available.length; j += 1) {
        const runout = [...board, first, available[j]]
        const result = compareSolvedHands(solveHand([...heroCards, ...runout]), solveHand([...tavusCards, ...runout]))
        score += result === 'hero' ? 1 : result === 'tie' ? 0.5 : 0
        outcomes += 1
      }
    }
  }

  return score / outcomes
}

function chooseTavusAction(
  tavusEquity: number,
  texture: BoardTexture,
  pot: number,
  effectiveStack: number,
  random: () => number,
): TavusAction {
  const bluffWindow = tavusEquity < 0.43 && random() < 0.38 + texture.pressure * 0.32
  const semiBluff = tavusEquity >= 0.43 && tavusEquity < 0.56 && random() < 0.52
  const trap = tavusEquity > 0.72 && random() < 0.22
  const lineType: TavusLineType = trap
    ? 'trap'
    : bluffWindow
      ? 'bluff'
      : semiBluff
        ? 'semi-bluff'
        : tavusEquity > 0.62
          ? 'value'
          : 'thin value'

  const pressureMultiplier =
    lineType === 'bluff' ? 0.72 : lineType === 'semi-bluff' ? 0.64 : lineType === 'trap' ? 0.38 : 0.58
  const amount = Math.min(effectiveStack, Math.max(4, Math.round(pot * pressureMultiplier)))
  const action = amount >= effectiveStack * 0.72 ? 'jams' : trap ? 'checks' : 'bets'

  return {
    action,
    amount: action === 'checks' ? 0 : amount,
    lineType,
    confidence: Math.min(0.95, Math.max(0.2, tavusEquity + (lineType === 'bluff' ? 0.14 : 0))),
    tableTalk: randomItem(TABLE_TALK[lineType], random),
  }
}

function recommendAction(heroEquity: number, tavusAction: TavusAction, pot: number): Pick<PokerSpot, 'recommendedAction' | 'recommendedSize' | 'potOdds'> {
  if (tavusAction.action === 'checks') {
    if (heroEquity > 0.58) {
      return { recommendedAction: 'bet', recommendedSize: Math.round(pot * 0.58), potOdds: 0 }
    }
    return { recommendedAction: 'check', recommendedSize: 0, potOdds: 0 }
  }

  const toCall = tavusAction.amount
  const potOdds = toCall / (pot + toCall)
  if (heroEquity > potOdds + 0.24) {
    return { recommendedAction: 'raise', recommendedSize: Math.round(pot + toCall * 2.4), potOdds }
  }
  if (heroEquity >= potOdds + 0.04) {
    return { recommendedAction: 'call', recommendedSize: toCall, potOdds }
  }
  return { recommendedAction: 'fold', recommendedSize: 0, potOdds }
}

export function generateSpot(handNumber = 1, random: () => number = Math.random): PokerSpot {
  const deck = shuffle(createDeck(), random)
  const heroCards = deck.slice(0, 2)
  const tavusCards = deck.slice(2, 4)
  const street = random() > 0.7 ? 'River' : random() > 0.42 ? 'Turn' : 'Flop'
  const boardSize = street === 'Flop' ? 3 : street === 'Turn' ? 4 : 5
  const board = deck.slice(4, 4 + boardSize)
  const pot = randomItem([18, 22, 27, 34, 41, 56, 68], random)
  const effectiveStack = randomItem([84, 96, 112, 128, 150], random)
  const texture = getBoardTexture(board)
  const heroEquity = exactEquityAgainstTavus(heroCards, tavusCards, board)
  const tavusEquity = 1 - heroEquity
  const tavusAction = chooseTavusAction(tavusEquity, texture, pot, effectiveStack, random)
  const recommendation = recommendAction(heroEquity, tavusAction, pot)
  const heroHand = solveHand([...heroCards, ...board]).descr
  const tavusHand = solveHand([...tavusCards, ...board]).descr
  const toCall = tavusAction.action === 'checks' ? 0 : tavusAction.amount

  return {
    id: `tp-${handNumber}-${Math.floor(random() * 100000).toString(36)}`,
    handNumber,
    street,
    position: randomItem(['Button', 'Big Blind', 'Cutoff heads-up seat'], random),
    heroCards,
    tavusCards,
    board,
    pot,
    effectiveStack,
    toCall,
    minRaise: toCall > 0 ? Math.min(effectiveStack, toCall * 2) : Math.round(pot * 0.5),
    heroEquity,
    tavusEquity,
    heroHand,
    tavusHand,
    texture,
    tavusAction,
    ...recommendation,
    readPrompt: 'Say your action out loud in the Tavus room, then make it on the table.',
  }
}

function buildTellProfile(latencyMs: number, action: PlayerAction): TellProfile {
  if (latencyMs < 1800) {
    return {
      latencyMs,
      label: 'snap decision',
      pressure: action === 'raise' || action === 'bet' ? 0.68 : 0.42,
      signal: 'Fast action often polarizes the story: comfort, rehearsal, or a planned counter-punch.',
    }
  }

  if (latencyMs > 8500) {
    return {
      latencyMs,
      label: 'long tank',
      pressure: 0.74,
      signal: 'The long pause gives Tavus room to probe hesitation, eye breaks, and whether the voice tightens.',
    }
  }

  return {
    latencyMs,
    label: 'measured response',
    pressure: 0.48,
    signal: 'The timing is balanced, so the strongest reads should come from voice and facial cues.',
  }
}

export function availableActions(spot: PokerSpot): PlayerAction[] {
  return spot.toCall > 0 ? ['fold', 'call', 'raise'] : ['check', 'bet']
}

export function scoreDecision(spot: PokerSpot, action: PlayerAction, latencyMs: number): DecisionResult {
  const recommended = spot.recommendedAction
  const exact = action === recommended
  const actionFamilyMatch =
    (['call', 'raise'].includes(action) && ['call', 'raise'].includes(recommended)) ||
    (['check', 'bet'].includes(action) && ['check', 'bet'].includes(recommended))
  const score = exact ? 100 : actionFamilyMatch ? 72 : action === 'fold' && spot.heroEquity < spot.potOdds + 0.01 ? 64 : 34
  const tell = buildTellProfile(latencyMs, action)
  const quality: DecisionQuality = score >= 92 ? 'great' : score >= 70 ? 'solid' : score >= 50 ? 'thin' : 'punished'
  const tavusWasBluffing = spot.tavusAction.lineType === 'bluff' || spot.tavusAction.lineType === 'semi-bluff'
  const amount =
    action === 'raise'
      ? Math.max(spot.minRaise, spot.recommendedSize)
      : action === 'bet'
        ? Math.max(spot.minRaise, spot.recommendedSize)
        : action === 'call'
          ? spot.toCall
          : 0
  const reveal = `Tavus had ${spot.tavusCards.map(cardLabel).join(' ')} for ${spot.tavusHand}. ${tavusWasBluffing ? 'That line included real bluff pressure.' : 'That line was weighted toward value.'}`
  const outcome = exact
    ? 'You found the highest-EV response to the Tavus line.'
    : actionFamilyMatch
      ? 'You stayed in the right strategic family, but sizing/action could improve.'
      : 'Tavus got the pressure it wanted from this line.'
  const coachNote = `Math says ${recommended.toUpperCase()} at about ${formatPercent(spot.heroEquity)} equity against Tavus cards. Pot odds were ${formatPercent(spot.potOdds)}.`

  return {
    action,
    amount,
    quality,
    score,
    outcome,
    coachNote,
    reveal,
    tell,
  }
}

export function buildTavusContext(spot: PokerSpot): string {
  return [
    'You are TavusPoker, an embodied heads-up poker opponent. You are not a coach. You play the hand in character.',
    'Run the table through spoken poker language. Never tell the user to click, press, tap, drag, use a slider, or use the UI.',
    'Use table talk, pressure, silence, and bluffing. Never reveal your hole cards until the app reaches showdown.',
    'Use visual and audio perception as soft tells only. You may mention probabilistic reads from facial tension, gaze, posture, timing, and voice, but do not claim certainty.',
    `Current hand: ${spot.street}, pot ${formatMoney(spot.pot)}, effective stack ${formatMoney(spot.effectiveStack)}.`,
    `Board: ${spot.board.map(cardLabel).join(' ')}. Texture: ${spot.texture.label}.`,
    `Your private Tavus cards: ${spot.tavusCards.map(cardLabel).join(' ')} for ${spot.tavusHand}. Do not say these unless the user asks after showdown.`,
    'User private hole cards: hidden from you until showdown. Infer strength only from public board, betting, timing, speech, and Raven signals.',
    `Your current line: ${spot.tavusAction.action} ${spot.tavusAction.amount > 0 ? formatMoney(spot.tavusAction.amount) : ''} as a ${spot.tavusAction.lineType}.`,
    `Opening table talk: "${spot.tavusAction.tableTalk}"`,
    `Spoken legal actions: ${availableActions(spot).join(', ')}.`,
    'Ask the user to say their action out loud, watch for tells, then react like a real opponent.',
  ].join('\n')
}

export function summarizeSpot(spot: PokerSpot): string {
  const tavusBet = spot.tavusAction.amount > 0 ? `${spot.tavusAction.action} ${formatMoney(spot.tavusAction.amount)}` : spot.tavusAction.action
  return `${spot.street}: you hold ${spot.heroCards.map(cardLabel).join(' ')} on ${spot.board.map(cardLabel).join(' ')}. Tavus ${tavusBet}.`
}
