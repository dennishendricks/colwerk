export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await workbench.closeConnection(id)
  await store.remove(id)
  return { ok: true }
})
