// A statement still running in the tab is cancelled first: closing the connection alone does not
// stop it on every server (Postgres keeps running it until it tries to send results).
export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  cancelExports(tabId)
  await workbench.cancel(tabId).catch(() => {})
  await workbench.closeTab(tabId)
  return { ok: true }
})
