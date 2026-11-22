export default defineEventHandler((event) => {
  cancelJob(getRouterParam(event, 'id')!)
  return { ok: true }
})
