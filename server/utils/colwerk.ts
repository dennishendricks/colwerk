import {
  AppError,
  type ConnectionAuth,
  type ConnectionColor,
  connectionColors,
  type ConnectionInput,
  ConnectionStore,
  type DateFormat,
  dateFormats,
  DbError,
  type Dialect,
  drivers,
  isLakehouse,
  Workbench,
} from '#core'

export const store = new ConnectionStore()
export const workbench = new Workbench((id) => store.get(id))

/**
 * Maps database errors to 400 with the driver message; everything else stays a 500. Errors of Colwerk
 * itself carry their `key` and `params`, so the UI can show them in its language.
 */
export async function dbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof DbError) {
      throw createError({
        statusCode: 400,
        message: e.message,
        data: {
          code: e.code,
          position: e.position,
          transaction: e.transaction,
          ...(e instanceof AppError && { key: e.key, params: e.params }),
        },
      })
    }
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
  const str = (k: string) => (typeof b[k] === 'string' && b[k] !== '' ? (b[k] as string) : undefined)
  const dialect = b.dialect as Dialect
  const driver = drivers.find((d) => d.dialect === dialect)
  if (!driver) throw createError({ statusCode: 400, message: 'Unknown dialect' })
  if (!str('name')) throw createError({ statusCode: 400, message: 'Name is required', data: { key: 'nameRequired' } })
  const port = b.port === undefined || b.port === null || b.port === '' ? undefined : Number(b.port)
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw createError({ statusCode: 400, message: 'Invalid port', data: { key: 'invalidPort' } })
  }
  const color = str('color') as ConnectionColor | undefined
  if (color !== undefined && !connectionColors.includes(color)) {
    throw createError({ statusCode: 400, message: 'Invalid color' })
  }
  const auth = (str('auth') ?? driver.auths[0]) as ConnectionAuth | undefined
  if (auth !== undefined && !driver.auths.includes(auth)) {
    throw createError({ statusCode: 400, message: 'Invalid authentication' })
  }
  if (auth === 'entra-service-principal' && !(str('tenantId') && str('clientId'))) {
    throw createError({
      statusCode: 400,
      message: 'Tenant ID and client ID are required',
      data: { key: 'servicePrincipalRequired' },
    })
  }
  const dateFormat = str('dateFormat') as DateFormat | undefined
  if (dateFormat !== undefined && !dateFormats.includes(dateFormat)) {
    throw createError({ statusCode: 400, message: 'Invalid date format' })
  }
  const connectRetries =
    b.connectRetries === undefined || b.connectRetries === null || b.connectRetries === ''
      ? undefined
      : Number(b.connectRetries)
  if (
    connectRetries !== undefined &&
    !(Number.isInteger(connectRetries) && connectRetries >= 0 && connectRetries <= 100)
  ) {
    throw createError({ statusCode: 400, message: 'Invalid number of retries', data: { key: 'invalidRetries' } })
  }
  if (auth === 'oauth-client' && !str('clientId')) {
    throw createError({ statusCode: 400, message: 'Client ID is required', data: { key: 'clientIdRequired' } })
  }
  // Catalog URL (Iceberg, Unity) or workspace (OneLake); the Delta folder.
  if (isLakehouse(dialect) && !(dialect === 'delta' ? str('file') : str('host'))) {
    throw createError({
      statusCode: 400,
      message: dialect === 'delta' ? 'Folder is required' : 'Address is required',
      data: { key: dialect === 'delta' ? 'folderRequired' : 'addressRequired' },
    })
  }
  const entra = auth?.startsWith('entra-') ?? false
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
    auth,
    domain: auth === 'windows' ? str('domain') : undefined,
    tenantId: entra ? str('tenantId') : undefined,
    clientId: entra || auth === 'oauth-client' ? str('clientId') : undefined,
    socket: str('socket'),
    searchPath: str('searchPath'),
    instanceName: str('instanceName'),
    readOnlyIntent: b.readOnlyIntent === true,
    multiSubnetFailover: b.multiSubnetFailover === true,
    connectRetries,
    language: str('language'),
    dateFormat,
    ssl: b.ssl === true,
    sslCa: b.ssl === true ? str('sslCa') : undefined,
    sslInsecure: b.ssl === true && b.sslInsecure === true,
    sslStrict: b.ssl === true && b.sslStrict === true,
    sslServerName: b.ssl === true ? str('sslServerName') : undefined,
    file: str('file'),
    readOnly: b.readOnly === true,
    v1Storage: b.v1Storage === true,
    region: dialect === 'unity' ? str('region') : undefined,
    oauthServerUri: auth === 'oauth-client' ? str('oauthServerUri') : undefined,
    oauthScope: auth === 'oauth-client' ? str('oauthScope') : undefined,
    color,
    confirmWrites: b.confirmWrites === true,
  }
}
