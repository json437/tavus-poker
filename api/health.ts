import type { ApiRequest, ApiResponse } from './_tavus.js'
import { methodAllowed } from './_tavus.js'

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodAllowed(req, res, ['GET'])) return
  res.status(200).json({ ok: true, service: 'tavus-poker-api' })
}
