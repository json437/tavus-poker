import type { ApiRequest, ApiResponse, TavusCreateRequest } from '../_tavus.js'
import { createConversation, methodAllowed } from '../_tavus.js'

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodAllowed(req, res, ['POST'])) return

  try {
    const data = await createConversation((req.body || {}) as TavusCreateRequest)
    res.status(200).json(data)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create Tavus conversation.' })
  }
}
