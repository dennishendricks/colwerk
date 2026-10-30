// Closes all sessions of the connection until it is connected again, so other tools can open a DuckDB file.
export default defineEventHandler(async (event) => {
  await workbench.disconnect(getRouterParam(event, 'id')!)
  return { ok: true }
})
