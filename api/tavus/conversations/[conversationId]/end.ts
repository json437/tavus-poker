import type { ApiRequest, ApiResponse } from '../../../_tavus.js'
import { firstQueryValue, methodAllowed, tavusFetch } from '../../../_tavus.js'

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodAllowed(req, res, ['POST'])) return

  try {
    const conversationId = firstQueryValue(req.query?.conversationId)
    if (!conversationId) {
      res.status(400).json({ error: 'Missing conversation id.' })
      return
    }
    await tavusFetch(`/v2/conversations/${conversationId}/end`, { method: 'POST' })
    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to end Tavus conversation.' })
  }
}
