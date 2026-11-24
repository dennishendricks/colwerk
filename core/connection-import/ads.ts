import type { ConnectionConfig } from '../types.ts'
import type { ImportNote, ImportResult } from './index.ts'
import { sslModes } from './dbt.ts'

/** Parses JSON with comments and trailing commas, as in the settings.json of VS Code based editors. */
export function parseJsonc(text: string): unknown {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '"') {
      // Copy the string, including escaped quotes.
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i < 0) break
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})
const str = (v: unknown) =>
  typeof v === 'string' && v !== '' ? v : v === undefined || v === null ? undefined : String(v)

/** Parses `datasource.connections` and `datasource.connectionGroups` of the settings.json of Azure Data Studio. */
export function parseAds(settings: unknown): ImportResult {
  const s = obj(settings)
  const result: ImportResult = { candidates: [], skipped: [] }
  const groups = new Map(
    (Array.isArray(s['datasource.connectionGroups']) ? s['datasource.connectionGroups'] : []).map((g: Json) => [
      g.id,
      g,
    ]),
  )
  // Names from the outermost group down; the invisible ROOT group is left out.
  const folderOf = (id: unknown) => {
    const names: string[] = []
    for (let g = groups.get(id), n = 0; g && n < 20; g = groups.get(g.parentId), n++) {
      if (g.name !== 'ROOT') names.unshift(String(g.name))
    }
    return names.join('/') || undefined
  }
  const connections = Array.isArray(s['datasource.connections']) ? s['datasource.connections'] : []
  connections.forEach((c: Json, index) => {
    const o = obj(c.options)
    const notes: ImportNote[] = []
    const provider = String(c.providerName)
    const name = str(o.connectionName) ?? str(o.server) ?? str(o.host) ?? `ads-${index}`
    let config: Omit<ConnectionConfig, 'id'>
    if (provider === 'MSSQL') {
      const [server, serverPort] = String(o.server ?? '')
        .replace(/^tcp:/i, '')
        .split(',')
      const [host, instanceName] = server!.split('\\')
      const port = serverPort ?? o.port
      const encrypt = String(o.encrypt).toLowerCase()
      const trust = o.trustServerCertificate === true || o.trustServerCertificate === 'True'
      // Trusting the certificate only matters with encryption, which the server may enforce without `encrypt`.
      const ssl = ['true', 'mandatory', 'strict'].includes(encrypt) || trust
      config = {
        name,
        dialect: 'mssql',
        host: host || undefined,
        port: port ? Number(port) : undefined,
        instanceName,
        database: str(o.databaseName) ?? str(o.database),
        user: str(o.user),
        ssl,
        sslStrict: encrypt === 'strict',
        sslInsecure: trust,
        sslServerName: str(o.hostNameInCertificate),
        readOnlyIntent: o.applicationIntent === 'ReadOnly',
        multiSubnetFailover: o.multiSubnetFailover === true || o.multiSubnetFailover === 'True',
        connectRetries: o.connectRetryCount ? Number(o.connectRetryCount) : undefined,
      }
      const auth = String(o.authenticationType ?? 'SqlLogin')
      if (auth === 'Integrated') {
        config.auth = 'windows'
        notes.push({ key: 'windowsLogin' })
      } else if (
        ['AzureMFA', 'AzureMFAAndUser', 'ActiveDirectoryInteractive', 'ActiveDirectoryPassword'].includes(auth)
      ) {
        config.auth = 'entra-interactive'
        config.tenantId = str(o.azureTenantId)
        if (auth === 'ActiveDirectoryPassword') notes.push({ key: 'authUnsupported', params: { auth } })
      } else if (auth !== 'SqlLogin') notes.push({ key: 'authUnsupported', params: { auth } })
      // The password lives in the operating system's credential store, which is not read.
      if (c.savePassword && (!config.auth || config.auth === 'windows')) notes.push({ key: 'passwordElsewhere' })
    } else if (provider === 'PGSQL') {
      config = {
        name,
        dialect: 'postgres',
        host: str(o.host) ?? str(o.server),
        port: o.port ? Number(o.port) : undefined,
        database: str(o.dbname) ?? str(o.database),
        user: str(o.user),
        ssl: sslModes.includes(String(o.sslmode)) || undefined,
      }
      if (c.savePassword) notes.push({ key: 'passwordElsewhere' })
    } else {
      result.skipped.push({ name, note: { key: 'unsupportedEngine', params: { engine: provider } } })
      return
    }
    if (!config.host) return void result.skipped.push({ name, note: { key: 'noHost' } })
    result.candidates.push({
      key: str(c.id) ?? `ads-${index}`,
      config: { ...config, folder: folderOf(c.groupId) },
      notes,
    })
  })
  return result
}
