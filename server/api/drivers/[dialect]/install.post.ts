import { type Dialect, installDriver } from '#core'

// Resolves once the download is complete; the progress is reported by GET /api/drivers.
export default defineEventHandler(async (event) => {
  await dbCall(() => installDriver(getRouterParam(event, 'dialect') as Dialect))
  return { ok: true }
})
