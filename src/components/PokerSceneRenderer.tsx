import { Application, Container, Graphics, Text } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { formatMoney, toPlayingCard } from '../domain/poker'
import type { CardCode } from '../domain/poker'
import type { TextStyleFontWeight } from 'pixi.js'

type RendererHandPhase = 'empty' | 'shuffle' | 'blinds' | 'deal' | 'live'

type PokerSceneRendererProps = {
  phase: RendererHandPhase
  street: string
  pot: number
  board: CardCode[]
  heroCards: CardCode[]
  tavusCards: CardCode[] | null
  heroCommitted: number
  tavusCommitted: number
  cardsAreDealt: boolean
  isThinking: boolean
}

type SceneSize = {
  width: number
  height: number
}

type FeltGeometry = {
  cx: number
  cy: number
  outerW: number
  outerH: number
  feltW: number
  feltH: number
}

const FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const FELT = 0x23845f
const FELT_DARK = 0x063324
const RIM = 0x0a0c0b
const CREAM = 0xf8fbf4
const GOLD = 0xf8ca5d
const RED = 0xc8332f
const BLUE = 0x27358f

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function addText(
  parent: Container,
  text: string,
  x: number,
  y: number,
  size: number,
  fill = '#f8fbf4',
  weight: TextStyleFontWeight = '800',
  anchor: [number, number] = [0.5, 0.5],
) {
  const label = new Text({
    text,
    style: {
      align: 'center',
      fill,
      fontFamily: FONT_FAMILY,
      fontSize: size,
      fontWeight: weight,
      letterSpacing: 0,
    },
  })
  label.anchor.set(anchor[0], anchor[1])
  label.position.set(x, y)
  parent.addChild(label)
  return label
}

function drawFelt(scene: Container, size: SceneSize): FeltGeometry {
  const isNarrow = size.width < 700
  const cx = size.width / 2
  const cy = isNarrow ? size.height * 0.54 : size.height * 0.5
  const outerW = Math.min(size.width * 0.9, 1320)
  const outerH = clamp(isNarrow ? size.height * 0.38 : size.height * 0.52, isNarrow ? 320 : 390, isNarrow ? 380 : 560)
  const feltW = outerW * 0.88
  const feltH = outerH * 0.78

  const shadow = new Graphics()
  shadow
    .ellipse(cx, cy + 24, outerW * 0.51, outerH * 0.52)
    .fill({ color: 0x000000, alpha: 0.42 })
  scene.addChild(shadow)

  const rim = new Graphics()
  rim
    .ellipse(cx, cy, outerW / 2, outerH / 2)
    .fill(RIM)
    .stroke({ color: 0x252923, width: isNarrow ? 16 : 24, alpha: 1 })
  rim
    .ellipse(cx, cy - outerH * 0.02, outerW * 0.455, outerH * 0.42)
    .stroke({ color: 0xffffff, width: 1.5, alpha: 0.18 })
  scene.addChild(rim)

  const leather = new Graphics()
  for (let index = 0; index < 16; index += 1) {
    const scale = 1 - index * 0.013
    leather
      .ellipse(cx, cy, (outerW * scale) / 2, (outerH * scale) / 2)
      .stroke({ color: index % 2 ? 0xffffff : 0x000000, width: 1, alpha: index % 2 ? 0.035 : 0.08 })
  }
  scene.addChild(leather)

  const feltBase = new Graphics()
  feltBase
    .ellipse(cx, cy, feltW / 2, feltH / 2)
    .fill(FELT_DARK)
    .stroke({ color: 0xabdebe, width: 3, alpha: 0.28 })
  feltBase
    .ellipse(cx, cy - feltH * 0.08, feltW * 0.48, feltH * 0.42)
    .fill({ color: FELT, alpha: 0.86 })
  scene.addChild(feltBase)

  const glow = new Graphics()
  glow
    .ellipse(cx, cy - feltH * 0.15, feltW * 0.22, feltH * 0.17)
    .fill({ color: 0xa3e9be, alpha: 0.2 })
  glow
    .ellipse(cx, cy + feltH * 0.18, feltW * 0.4, feltH * 0.18)
    .fill({ color: 0x000000, alpha: 0.16 })
  scene.addChild(glow)

  const grid = new Graphics()
  const left = cx - feltW * 0.44
  const right = cx + feltW * 0.44
  const top = cy - feltH * 0.34
  const bottom = cy + feltH * 0.34
  for (let x = left; x <= right; x += 18) {
    grid.moveTo(x, top)
    grid.lineTo(x, bottom)
  }
  for (let y = top; y <= bottom; y += 18) {
    grid.moveTo(left, y)
    grid.lineTo(right, y)
  }
  grid.stroke({ color: 0xffffff, width: 1, alpha: 0.035 })
  scene.addChild(grid)

  return { cx, cy, outerW, outerH, feltW, feltH }
}

function drawChip(parent: Container, x: number, y: number, color: number, scale = 1, label?: string) {
  const chip = new Container()
  chip.position.set(x, y)
  chip.scale.set(scale)

  const body = new Graphics()
  body
    .ellipse(0, 0, 19, 12)
    .fill(color)
    .stroke({ color: 0xf8fbf4, width: 3, alpha: 0.8 })
  body
    .ellipse(0, 0, 9, 6)
    .fill({ color: 0x121512, alpha: 0.25 })
  chip.addChild(body)

  if (label) {
    addText(chip, label, 0, 0, 9, '#ffffff', '900')
  }

  parent.addChild(chip)
  return chip
}

function drawChipPile(parent: Container, x: number, y: number, total: number, compact = false) {
  const chips = Math.max(3, Math.min(11, Math.ceil(total / 18)))
  const colors = [GOLD, RED, CREAM, BLUE, 0x1b6e51]
  for (let index = 0; index < chips; index += 1) {
    const offset = compact ? index * 5 : (index % 5) * 18
    const row = compact ? 0 : Math.floor(index / 5) * -11
    drawChip(parent, x - (compact ? 11 : 36) + offset, y + row, colors[index % colors.length], compact ? 0.82 : 0.92)
  }
}

function drawCardBackPattern(card: Container, width: number, height: number) {
  const pattern = new Graphics()
  for (let index = -height; index < width; index += 12) {
    pattern.moveTo(index - width / 2, -height / 2)
    pattern.lineTo(index + height - width / 2, height / 2)
  }
  pattern.stroke({ color: 0xffffff, width: 1.2, alpha: 0.12 })
  card.addChild(pattern)
}

function drawCard(parent: Container, code: CardCode | null, x: number, y: number, width: number, height: number, rotation = 0) {
  const card = new Container()
  card.position.set(x, y)
  card.rotation = rotation

  const body = new Graphics()
  body.roundRect(-width / 2, -height / 2, width, height, 7).fill(code ? 0xf7f5ee : 0x111713)
  body.roundRect(-width / 2, -height / 2, width, height, 7).stroke({ color: code ? 0xdad8d0 : 0xf8fbf4, width: 1.5, alpha: code ? 0.9 : 0.35 })
  card.addChild(body)

  if (!code) {
    drawCardBackPattern(card, width, height)
    addText(card, 'TP', 0, 1, Math.max(13, width * 0.22), '#f8fbf4', '900')
    parent.addChild(card)
    return card
  }

  const playingCard = toPlayingCard(code)
  const fill = playingCard.color === 'red' ? '#c8332f' : '#101310'
  addText(card, playingCard.displayRank, -width * 0.3, -height * 0.28, width * 0.28, fill, '900')
  addText(card, playingCard.suitSymbol, width * 0.26, height * 0.26, width * 0.33, fill, '900')

  parent.addChild(card)
  return card
}

function drawCommunityCards(scene: Container, geometry: FeltGeometry, board: CardCode[], phase: RendererHandPhase) {
  const cardW = clamp(geometry.feltW * 0.065, 48, 74)
  const cardH = cardW * 1.42
  const gap = cardW * 0.18
  const y = geometry.cy + geometry.feltH * 0.12
  const fullWidth = 5 * cardW + 4 * gap
  const startX = geometry.cx - fullWidth / 2 + cardW / 2

  if (board.length === 0) {
    const ghost = new Graphics()
    for (let index = 0; index < 5; index += 1) {
      ghost.roundRect(startX + index * (cardW + gap) - cardW / 2, y - cardH / 2, cardW, cardH, 7).stroke({ color: 0xf8fbf4, width: 1, alpha: 0.14 })
    }
    scene.addChild(ghost)
    addText(scene, phase === 'live' ? 'PREFLOP' : 'NO BOARD', geometry.cx, y, clamp(geometry.feltW * 0.026, 16, 28), '#e7f4e8', '900')
    return
  }

  board.forEach((card, index) => {
    drawCard(scene, card, startX + index * (cardW + gap), y, cardW, cardH)
  })
}

function drawHoleCards(scene: Container, geometry: FeltGeometry, props: PokerSceneRendererProps) {
  const isNarrow = geometry.outerW < 640
  const cardW = clamp(geometry.feltW * 0.067, 50, 72)
  const cardH = cardW * 1.42
  const gap = cardW * 0.18
  const heroY = geometry.cy + geometry.feltH * (isNarrow ? 0.09 : 0.45)
  const heroX = geometry.cx + geometry.feltW * (isNarrow ? 0.25 : 0.26)
  if (props.phase === 'shuffle' || props.phase === 'empty') return

  const heroCodes = props.cardsAreDealt ? props.heroCards : [null, null]
  heroCodes.forEach((card, index) => {
    drawCard(scene, card, heroX + (index - 0.5) * (cardW + gap), heroY + index * 2, cardW, cardH, (index - 0.5) * 0.06)
  })
}

function drawCommitments(scene: Container, geometry: FeltGeometry, heroCommitted: number, tavusCommitted: number) {
  if (tavusCommitted > 0) {
    const x = geometry.cx - geometry.feltW * 0.28
    const y = geometry.cy - geometry.feltH * 0.18
    drawChipPile(scene, x, y, tavusCommitted, true)
    addText(scene, formatMoney(tavusCommitted), x + 42, y, 14, '#f8fbf4', '800')
  }

  if (heroCommitted > 0) {
    const isNarrow = geometry.outerW < 640
    const x = geometry.cx + geometry.feltW * 0.1
    const y = geometry.cy + geometry.feltH * (isNarrow ? 0.16 : 0.43)
    drawChipPile(scene, x, y, heroCommitted, true)
    addText(scene, formatMoney(heroCommitted), x + 42, y, 14, '#f8fbf4', '800')
  }
}

function drawPot(scene: Container, geometry: FeltGeometry, pot: number, street: string) {
  const y = geometry.cy - geometry.feltH * 0.12
  drawChipPile(scene, geometry.cx, y - 18, pot)
  addText(scene, formatMoney(pot), geometry.cx, y + 24, clamp(geometry.feltW * 0.04, 28, 48), '#f8fbf4', '900')
  addText(scene, 'POT', geometry.cx, y + 57, 13, 'rgba(248,251,244,0.72)', '900')

  const streetPill = new Graphics()
  streetPill.roundRect(geometry.cx - 70, geometry.cy - geometry.feltH * 0.28, 140, 30, 15).fill({ color: 0x07120e, alpha: 0.68 })
  streetPill.roundRect(geometry.cx - 70, geometry.cy - geometry.feltH * 0.28, 140, 30, 15).stroke({ color: 0xffffff, width: 1, alpha: 0.14 })
  scene.addChild(streetPill)
  addText(scene, street.toUpperCase(), geometry.cx, geometry.cy - geometry.feltH * 0.28 + 15, 13, '#f8fbf4', '900')
}

function drawCeremony(scene: Container, geometry: FeltGeometry, phase: RendererHandPhase) {
  if (phase === 'live') return []

  const cardW = clamp(geometry.feltW * 0.06, 48, 64)
  const cardH = cardW * 1.42
  const deckX = geometry.cx
  const deckY = geometry.cy + geometry.feltH * 0.03
  const animated: Container[] = []

  if (phase === 'empty') {
    const seal = new Graphics()
    seal.roundRect(deckX - 82, deckY - 18, 164, 36, 18).fill({ color: 0x07120e, alpha: 0.72 })
    seal.roundRect(deckX - 82, deckY - 18, 164, 36, 18).stroke({ color: 0xffffff, width: 1, alpha: 0.12 })
    scene.addChild(seal)
    addText(scene, 'DECK SEALED', deckX, deckY, 14, '#f8fbf4', '900')
    return animated
  }

  const deck = new Container()
  deck.position.set(deckX, deckY)
  scene.addChild(deck)
  for (let index = 0; index < 5; index += 1) {
    const card = drawCard(deck, null, (index - 2) * 2, (index - 2) * -1.5, cardW, cardH, (index - 2) * 0.03)
    if (index === 4) animated.push(card)
  }

  if (phase === 'blinds') {
    addText(scene, 'BLINDS MOVE IN', geometry.cx, deckY + cardH * 0.75, 15, '#f8fbf4', '900')
    return animated
  }

  if (phase === 'shuffle') {
    addText(scene, 'SHUFFLING', geometry.cx, deckY + cardH * 0.78, 15, '#f8fbf4', '900')
    return animated
  }

  const targets = [
    { x: geometry.cx + geometry.feltW * 0.25, y: geometry.cy + geometry.feltH * 0.37, r: -0.1 },
    { x: geometry.cx + geometry.feltW * 0.35, y: geometry.cy - geometry.feltH * 0.35, r: 0.1 },
  ]
  targets.forEach((target, index) => {
    const card = drawCard(scene, null, deckX, deckY, cardW, cardH, target.r)
    card.alpha = 0.8
    card.label = `deal:${target.x}:${target.y}:${index}`
    animated.push(card)
  })
  addText(scene, 'DEALING', geometry.cx, deckY + cardH * 0.82, 15, '#f8fbf4', '900')
  return animated
}

function drawThinkingPulse(scene: Container, geometry: FeltGeometry) {
  const pulse = new Graphics()
  pulse.ellipse(geometry.cx, geometry.cy, geometry.feltW * 0.2, geometry.feltH * 0.18).stroke({ color: GOLD, width: 4, alpha: 0.18 })
  pulse.label = 'thinking-pulse'
  scene.addChild(pulse)
  return pulse
}

function clearStage(stage: Container) {
  for (const child of stage.removeChildren()) {
    child.destroy({ children: true })
  }
}

export function PokerSceneRenderer(props: PokerSceneRendererProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<Application | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let initialized = false
    let destroyed = false
    const host = hostRef.current
    if (!host) return undefined
    const resizeHost: HTMLElement = host

    const app = new Application()
    appRef.current = app

    function destroyApp() {
      if (!initialized || destroyed) return
      destroyed = true
      app.destroy(true, { children: true })
    }

    async function mount() {
      await app.init({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
        resizeTo: resizeHost,
      })
      initialized = true

      if (cancelled) {
        destroyApp()
        return
      }

      app.canvas.setAttribute('aria-hidden', 'true')
      resizeHost.appendChild(app.canvas)
      setReady(true)
    }

    void mount().catch(() => {
      if (!cancelled) setReady(false)
    })

    return () => {
      cancelled = true
      setReady(false)
      appRef.current = null
      if (initialized && !destroyed) {
        app.canvas.parentElement?.removeChild(app.canvas)
      }
      destroyApp()
    }
  }, [])

  useEffect(() => {
    const app = appRef.current
    const host = hostRef.current
    if (!ready || !app || !host) return undefined
    let disposed = false

    clearStage(app.stage)
    const scene = new Container()
    app.stage.addChild(scene)

    const draw = () => {
      if (disposed || appRef.current !== app) {
        return { ceremonyCards: [], thinkingPulse: null }
      }
      scene.removeChildren().forEach((child) => child.destroy({ children: true }))
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      const geometry = drawFelt(scene, { width, height })
      const ceremonyCards = drawCeremony(scene, geometry, props.phase)

      if (props.phase === 'live' || props.phase === 'deal' || props.cardsAreDealt) {
        drawPot(scene, geometry, props.pot, props.street)
        drawCommunityCards(scene, geometry, props.board, props.phase)
        drawHoleCards(scene, geometry, props)
        drawCommitments(scene, geometry, props.heroCommitted, props.tavusCommitted)
      }

      const thinkingPulse = props.isThinking ? drawThinkingPulse(scene, geometry) : null
      return { ceremonyCards, thinkingPulse }
    }

    let animationTargets = draw()

    const handleResize = () => {
      if (disposed || appRef.current !== app) return
      animationTargets = draw()
    }
    globalThis.addEventListener('resize', handleResize)

    const ticker = () => {
      if (disposed || appRef.current !== app) return
      try {
        const now = globalThis.performance?.now?.() ?? Date.now()
        const wave = Math.sin(now / 180)
        for (const card of animationTargets.ceremonyCards) {
          if ('destroyed' in card && card.destroyed) continue
          const cardName = typeof card.label === 'string' ? card.label : ''
          if (cardName.startsWith('deal:')) {
            const [, x, y, index] = cardName.split(':')
            const progress = (Math.sin(now / 360 + Number(index)) + 1) / 2
            card.position.set(
              card.position.x + (Number(x) - card.position.x) * progress * 0.08,
              card.position.y + (Number(y) - card.position.y) * progress * 0.08,
            )
            card.alpha = 0.55 + progress * 0.35
          } else {
            card.rotation = wave * 0.12
            card.position.x = wave * 10
          }
        }

        if (animationTargets.thinkingPulse) {
          const pulse = animationTargets.thinkingPulse
          if ('destroyed' in pulse && pulse.destroyed) return
          pulse.alpha = 0.35 + Math.max(0, wave) * 0.45
          pulse.scale.set(1 + Math.max(0, wave) * 0.08)
        }
      } catch {
        animationTargets = { ceremonyCards: [], thinkingPulse: null }
        app.ticker.remove(ticker)
      }
    }

    app.ticker.add(ticker)

    return () => {
      disposed = true
      globalThis.removeEventListener('resize', handleResize)
      if (appRef.current !== app) return
      app.ticker.remove(ticker)
      clearStage(app.stage)
    }
  }, [props, ready])

  return <div ref={hostRef} className="poker-scene-renderer" aria-hidden="true" />
}
