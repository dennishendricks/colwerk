export default defineEventHandler(async () => {
  await clearAudit()
  return { ok: true }
})
