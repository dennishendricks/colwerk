import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import process from 'node:process'

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

function tokenMatches(given: string | undefined): boolean {
  const expected = process.env.DBM_TOKEN
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default defineEventHandler((event) => {
  // Host check defeats DNS rebinding; Origin check rejects cross-site requests from other pages.
  const host = getRequestHeader(event, 'host') ?? ''
  if (!LOCAL_HOSTNAMES.has(host.replace(/:\d+$/, ''))) {
    throw createError({ statusCode: 403, message: 'Forbidden host' })
  }
  const origin = getRequestHeader(event, 'origin')
  if (origin && origin !== `http://${host}`) {
    throw createError({ statusCode: 403, message: 'Forbidden origin' })
  }
  // Static assets carry no data; every API call needs the per-launch session token.
  if (event.path.startsWith('/api/') && !tokenMatches(getRequestHeader(event, 'x-dbm-token'))) {
    throw createError({ statusCode: 401, message: 'Missing or invalid session token' })
  }
})
