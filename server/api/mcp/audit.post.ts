import { auditRetentions } from '#core'

export default defineEventHandler(async (event) => {
  const { retentionDays } = await readBody<{ retentionDays?: unknown }>(event)
  if (!(auditRetentions as readonly unknown[]).includes(retentionDays)) {
    throw createError({ statusCode: 400, message: 'Invalid retention' })
  }
  await setAuditRetention(retentionDays as number)
  return { ok: true }
})
