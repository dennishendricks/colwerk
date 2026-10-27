export default defineEventHandler(async () => {
  await clearHistory()
  return { ok: true }
})
