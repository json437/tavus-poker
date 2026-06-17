import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { buildTavusContext } from './src/domain/poker.ts'
import type { PokerSpot } from './src/domain/poker.ts'
import { DEFAULT_TAVUS_REPLICA_ID, buildTablePlayerPersonaBody, buildTavusConversationBody } from './src/lib/tavusApiPayloads.ts'

const app = express()
const port = Number(process.env.PORT ?? 3001)
const tavusApiKey = process.env.TAVUS_API_KEY
const replicaId = process.env.TAVUS_REPLICA_ID || DEFAULT_TAVUS_REPLICA_ID
const personaId = process.env.TAVUS_PERSONA_ID
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const testModeDefault = process.env.TAVUS_TEST_MODE === 'true'
const requireAuth = process.env.TAVUS_REQUIRE_AUTH === 'true'

app.use(cors({ origin: clientOrigin }))
app.use(express.json({ limit: '1mb' }))

type TavusCreateRequest = {
  spot?: PokerSpot
  context?: string
  handNumber?: number
  greeting?: string
  test_mode?: boolean
}

function requireApiKey() {
  if (!tavusApiKey || tavusApiKey === 'tvsk_your_key_here') {
    throw new Error('Missing TAVUS_API_KEY. Copy .env.example to .env and add your Tavus key.')
  }
}

async function tavusFetch(path: string, init: RequestInit = {}) {
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'tavus-poker-api' })
})

app.get('/api/tavus/config', (_req, res) => {
  res.json({
    hasApiKey: Boolean(tavusApiKey && tavusApiKey !== 'tvsk_your_key_here'),
    hasPersona: Boolean(personaId),
    replicaId,
    testModeDefault,
    requireAuth,
  })
})

app.post('/api/tavus/conversations', async (req, res) => {
  try {
    const { spot, context, handNumber, greeting, test_mode = testModeDefault } = req.body as TavusCreateRequest
    const conversationalContext = context || (spot ? buildTavusContext(spot) : '')
    if (!conversationalContext) {
      res.status(400).json({ error: 'Missing Tavus conversation context.' })
      return
    }

    const data = await tavusFetch('/v2/conversations', {
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

    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create Tavus conversation.' })
  }
})

app.post('/api/tavus/conversations/:conversationId/end', async (req, res) => {
  try {
    await tavusFetch(`/v2/conversations/${req.params.conversationId}/end`, { method: 'POST' })
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to end Tavus conversation.' })
  }
})

app.post('/api/tavus/personas/table-player', async (_req, res) => {
  try {
    const data = await tavusFetch('/v2/personas', {
      method: 'POST',
      body: JSON.stringify(buildTablePlayerPersonaBody(replicaId)),
    })

    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create Tavus persona.' })
  }
})

app.listen(port, () => {
  console.log(`TavusPoker API listening on http://localhost:${port}`)
})
