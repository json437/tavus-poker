import { buildTavusContext } from '../src/domain/poker.js'
import type { PokerSpot } from '../src/domain/poker.js'
import { DEFAULT_TAVUS_REPLICA_ID, buildTablePlayerPersonaBody, buildTavusConversationBody } from '../src/lib/tavusApiPayloads.js'

declare const process: {
  env: Record<string, string | undefined>
}

type JsonResponse = {
  status: (code: number) => JsonResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
}

export type ApiRequest = {
  method?: string
  body?: unknown
  query?: Record<string, string | string[]>
}

export type ApiResponse = JsonResponse

export type TavusCreateRequest = {
  spot?: PokerSpot
  context?: string
  handNumber?: number
  greeting?: string
  test_mode?: boolean
}

const tavusApiKey = process.env.TAVUS_API_KEY
const replicaId = process.env.TAVUS_REPLICA_ID || DEFAULT_TAVUS_REPLICA_ID
const personaId = process.env.TAVUS_PERSONA_ID
const testModeDefault = process.env.TAVUS_TEST_MODE === 'true'
const requireAuth = process.env.TAVUS_REQUIRE_AUTH === 'true'

export function setCors(res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export function methodAllowed(req: ApiRequest, res: ApiResponse, methods: string[]): boolean {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).json({})
    return false
  }
  if (!methods.includes(req.method || 'GET')) {
    res.status(405).json({ error: 'Method not allowed.' })
    return false
  }
  return true
}

export function safeConfig() {
  return {
    hasApiKey: Boolean(tavusApiKey && tavusApiKey !== 'tvsk_your_key_here'),
    hasPersona: Boolean(personaId),
    replicaId,
    testModeDefault,
    requireAuth,
  }
}

function requireApiKey() {
  if (!tavusApiKey || tavusApiKey === 'tvsk_your_key_here') {
    throw new Error('Missing TAVUS_API_KEY. Add it as a server-side environment variable.')
  }
}

export async function tavusFetch(path: string, init: RequestInit = {}) {
  requireApiKey()
  const response = await fetch(`https://tavusapi.com${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': tavusApiKey,
      ...init.headers,
    },
  })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    const message =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : 'Tavus API request failed'
    throw new Error(message)
  }

  return data
}

export async function createConversation(body: TavusCreateRequest) {
  const { spot, context, handNumber, greeting, test_mode = testModeDefault } = body
  const conversationalContext = context || (spot ? buildTavusContext(spot) : '')
  if (!conversationalContext) {
    throw new Error('Missing Tavus conversation context.')
  }

  return tavusFetch('/v2/conversations', {
    method: 'POST',
    body: JSON.stringify(
      buildTavusConversationBody({
        replicaId,
        personaId,
        conversationName: `TavusPoker hand ${handNumber || spot?.handNumber || 'live'}`,
        conversationalContext,
        customGreeting: greeting || spot?.tavusAction.tableTalk || "You're in. Say your action when the spot is yours.",
        testMode: test_mode,
        requireAuth,
      }),
    ),
  })
}

export async function createPersona() {
  return tavusFetch('/v2/personas', {
    method: 'POST',
    body: JSON.stringify(buildTablePlayerPersonaBody(replicaId)),
  })
}

export function firstQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value || ''
}
