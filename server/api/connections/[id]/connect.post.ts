export default defineEventHandler((event) => {
  workbench.connect(getRouterParam(event, 'id')!)
  return { ok: true }
})
