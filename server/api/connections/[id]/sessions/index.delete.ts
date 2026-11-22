// Closes the monitor's session when the monitor is closed.
export default defineEventHandler(async (event) => {
  await workbench.closeMonitor(getRouterParam(event, 'id')!)
  return { ok: true }
})
