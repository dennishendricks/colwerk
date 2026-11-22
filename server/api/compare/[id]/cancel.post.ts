import { compareTab } from '#core'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  runningCompares.get(id)?.abort()
  await dbCall(() =>
    Promise.all([workbench.cancel(compareTab(id, 'source')), workbench.cancel(compareTab(id, 'target'))]),
  )
  return { ok: true }
})
