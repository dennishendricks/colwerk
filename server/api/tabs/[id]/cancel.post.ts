export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  cancelExports(tabId)
  await dbCall(() => workbench.cancel(tabId))
  return { ok: true }
})
