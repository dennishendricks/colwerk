// Closes all sessions of the connection until it is connected again, so other tools can open a DuckDB file.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await workbench.disconnect(id)
  await workbench.closeConnection(`mcp:${id}`)
  return { ok: true }
})
