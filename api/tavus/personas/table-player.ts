import type { ApiRequest, ApiResponse } from '../../_tavus.js'
import { createPersona, methodAllowed } from '../../_tavus.js'

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodAllowed(req, res, ['POST'])) return

  try {
    const data = await createPersona()
    res.status(200).json(data)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create Tavus persona.' })
  }
}
