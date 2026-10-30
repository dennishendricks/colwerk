import { readFile } from 'node:fs/promises'
import { AppError, type ConnectionConfig } from '../types.ts'

/** Node TLS options shared by the drivers; undefined without TLS. */
export async function tlsOptions(c: ConnectionConfig): Promise<{ ca?: string, rejectUnauthorized: boolean } | undefined> {
  if (!c.ssl) return undefined
  let ca: string | undefined
  if (c.sslCa) {
    try {
      ca = await readFile(c.sslCa, 'utf8')
    } catch (e) {
      throw new AppError('caUnreadable', `CA certificate not readable: ${(e as Error).message}`, { params: { detail: (e as Error).message } })
    }
  }
  return { ca, rejectUnauthorized: !c.sslInsecure }
}
