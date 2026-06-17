export type TavusConversation = {
  conversation_id: string
  conversation_name: string
  conversation_url: string
  status: 'active' | 'ended'
  created_at?: string
  meeting_token?: string
}

export type TavusConfig = {
  hasApiKey: boolean
  hasPersona: boolean
  replicaId: string
  testModeDefault: boolean
  requireAuth: boolean
}

export type TavusConversationInput = {
  context: string
  handNumber: number
  greeting: string
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Tavus request failed'
    throw new Error(message)
  }
  return data as T
}

export async function getTavusConfig(): Promise<TavusConfig> {
  const response = await fetch('/api/tavus/config')
  return parseResponse<TavusConfig>(response)
}

export async function createTavusConversation(input: TavusConversationInput, testMode: boolean): Promise<TavusConversation> {
  const response = await fetch('/api/tavus/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, test_mode: testMode }),
  })

  return parseResponse<TavusConversation>(response)
}

export async function endTavusConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/tavus/conversations/${conversationId}/end`, { method: 'POST' })
  await parseResponse<{ ok: boolean }>(response)
}
