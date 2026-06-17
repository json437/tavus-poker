type CheckStatus = 'pass' | 'warn' | 'blocked'

type Check = {
  name: string
  status: CheckStatus
  detail: string
}

type TavusConfig = {
  hasApiKey: boolean
  hasPersona: boolean
  replicaId: string
  testModeDefault: boolean
  requireAuth: boolean
}

const args = new Set(process.argv.slice(2))
const shouldProbe = args.has('--probe')
const strict = args.has('--strict')
const apiBase = process.env.TAVUS_POKER_API_BASE ?? `http://localhost:${process.env.PORT ?? 3001}`
const checks: Check[] = []

function addCheck(name: string, status: CheckStatus, detail: string) {
  checks.push({ name, status, detail })
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/out of conversational credits/i.test(message)) {
    return 'Tavus account is out of conversational credits.'
  }
  if (/Missing TAVUS_API_KEY/i.test(message)) {
    return 'Missing TAVUS_API_KEY.'
  }
  return message.replace(/tvsk_[A-Za-z0-9_-]+/g, 'tvsk_...')
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init)
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    const message =
      typeof data.error === 'string'
        ? data.error
        : typeof data.message === 'string'
          ? data.message
          : `${response.status} ${response.statusText}`
    throw new Error(message)
  }

  return data as T
}

async function run() {
  try {
    const health = await jsonFetch<{ ok: boolean; service?: string }>('/api/health')
    addCheck('Local API health', health.ok ? 'pass' : 'blocked', health.service ? `${health.service} responded.` : 'API responded.')
  } catch (error) {
    addCheck('Local API health', 'blocked', `${safeError(error)} Start it with npm run server or npm run dev:all.`)
  }

  let config: TavusConfig | null = null
  try {
    config = await jsonFetch<TavusConfig>('/api/tavus/config')
    addCheck(
      'Tavus config',
      config.hasApiKey && config.hasPersona ? 'pass' : 'blocked',
      [
        `apiKey=${config.hasApiKey ? 'set' : 'missing'}`,
        `persona=${config.hasPersona ? 'set' : 'missing'}`,
        `replica=${config.replicaId || 'missing'}`,
        `testModeDefault=${String(config.testModeDefault)}`,
        `privateRooms=${String(config.requireAuth)}`,
      ].join(', '),
    )
  } catch (error) {
    addCheck('Tavus config', 'blocked', safeError(error))
  }

  if (!shouldProbe) {
    addCheck('Tavus API test-mode probe', 'warn', 'Skipped. Run npm run verify:tavus -- --probe to verify credits and Tavus API reachability.')
  } else if (!config?.hasApiKey || !config.hasPersona) {
    addCheck('Tavus API test-mode probe', 'blocked', 'Skipped because Tavus API key or persona is missing.')
  } else {
    try {
      const conversation = await jsonFetch<{
        conversation_id?: string
        conversation_url?: string
        meeting_token?: string
        status?: string
      }>('/api/tavus/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: [
            'TavusPoker readiness probe.',
            'This is a test-mode API check only; do not join a live Daily room.',
            'User private hole cards: hidden from you until showdown.',
            'Your private Tavus cards: As Kd. Do not reveal these before showdown.',
          ].join('\n'),
          handNumber: 999,
          greeting: 'Readiness probe only.',
          test_mode: true,
        }),
      })

      addCheck(
        'Tavus API test-mode probe',
        'pass',
        [
          `status=${conversation.status ?? 'unknown'}`,
          `conversationId=${conversation.conversation_id ? 'present' : 'missing'}`,
          `joinUrl=${conversation.conversation_url ? 'present' : 'missing'}`,
          `meetingToken=${conversation.meeting_token ? 'present' : 'missing'}`,
        ].join(', '),
      )
    } catch (error) {
      addCheck('Tavus API test-mode probe', 'blocked', safeError(error))
    }
  }

  const blocked = checks.filter((check) => check.status === 'blocked')
  const warnings = checks.filter((check) => check.status === 'warn')

  console.log('TavusPoker live-readiness')
  for (const check of checks) {
    console.log(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`)
  }
  console.log(`SUMMARY ready=${blocked.length === 0 && warnings.length === 0 ? 'true' : 'false'} blocked=${blocked.length} warnings=${warnings.length}`)

  if (strict && blocked.length > 0) {
    process.exit(1)
  }
}

void run().catch((error) => {
  console.error(`BLOCKED Readiness checker: ${safeError(error)}`)
  if (strict) process.exit(1)
})
