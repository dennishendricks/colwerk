import { secrets } from '#core'

const PROVIDERS = ['bitwarden', 'bitwarden-sm', 'keepassxc'] as const

// Unlocks a password manager for secret references (core/secrets.ts); the secret is kept in memory until Colwerk quits.
export default defineEventHandler(async (event) => {
  const b = (await readBody(event)) ?? {}
  const provider = PROVIDERS.find((p) => p === b.provider)
  if (!provider || typeof b.secret !== 'string')
    throw createError({ statusCode: 400, message: 'Invalid unlock request' })
  if (provider === 'keepassxc' && (typeof b.database !== 'string' || !b.database)) {
    throw createError({ statusCode: 400, message: 'Database is required' })
  }
  const keyFile = typeof b.keyFile === 'string' && b.keyFile ? b.keyFile : undefined
  await dbCall(() => secrets.unlock({ provider, database: b.database, keyFile, secret: b.secret }))
  return { ok: true }
})
