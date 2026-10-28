import { type ConnectionColor, connectionColors, ConnectionStore, DbError, drivers, Workbench, type ConnectionInput, type Dialect } from '#core'

export const store = new ConnectionStore()
export const workbench = new Workbench(id => store.get(id))

/** Maps database errors to 400 with the driver message; everything else stays a 500. */
export async function dbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof DbError) throw createError({ statusCode: 400, message: e.message, data: { code: e.code, position: e.position, transaction: e.transaction } })
    throw e
  }
}

/** Database other than the connection's default; undefined (or empty) is the default. */
export function parseDatabase(database: unknown): string | undefined {
  if (database === undefined || database === null || database === '') return undefined
  if (typeof database !== 'string') throw createError({ statusCode: 400, message: 'Invalid database' })
  return database
}

export function parseConnection(body: unknown): ConnectionInput {
  const b = (body ?? {}) as Record<string, unknown>
  const str = (k: string) => typeof b[k] === 'string' && b[k] !== '' ? b[k] as string : undefined
  const dialect = b.dialect as Dialect
  if (!drivers.some(d => d.dialect === dialect)) throw createError({ statusCode: 400, message: 'Unknown dialect' })
  if (!str('name')) throw createError({ statusCode: 400, message: 'Name is required' })
  const port = b.port === undefined || b.port === null || b.port === '' ? undefined : Number(b.port)
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw createError({ statusCode: 400, message: 'Invalid port' })
  }
  const color = str('color') as ConnectionColor | undefined
  if (color !== undefined && !connectionColors.includes(color)) throw createError({ statusCode: 400, message: 'Invalid color' })
  return {
    id: str('id') ?? crypto.randomUUID(),
    name: str('name')!,
    folder: str('folder')?.trim() || undefined,
    dialect,
    host: str('host'),
    port,
    database: str('database'),
    user: str('user'),
    // undefined = keep stored password, '' = remove it
    password: typeof b.password === 'string' ? b.password : undefined,
    ssl: b.ssl === true,
    sslCa: b.ssl === true ? str('sslCa') : undefined,
    sslInsecure: b.ssl === true && b.sslInsecure === true,
    file: str('file'),
    readOnly: b.readOnly === true,
    color,
    confirmWrites: b.confirmWrites === true,
  }
}
