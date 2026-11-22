export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  return dbCall(() => workbench.sessions(id))
})
