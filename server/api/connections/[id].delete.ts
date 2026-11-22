export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await closeSessions(id)
  await store.remove(id)
  return { ok: true }
})
