import { drivers, type SessionAction } from '#core'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = decodeURIComponent(getRouterParam(event, 'session')!)
  const { action } = await readBody<{ action: SessionAction }>(event)
  if (action !== 'cancel' && action !== 'terminate') throw createError({ statusCode: 400, message: 'Invalid action' })
  const { dialect } = await store.get(id)
  if (!drivers.find((d) => d.dialect === dialect)?.capabilities.sessionActions.includes(action)) {
    throw createError({
      statusCode: 400,
      message: 'This action is not available for this database.',
      data: { key: 'sessionActionUnsupported' },
    })
  }
  await dbCall(() => workbench.stopSession(id, session, action))
  return { ok: true }
})
