import path from 'node:path'
import type { ConnectionAuth, ConnectionConfig } from '../types.ts'
import type { ImportNote, ImportResult } from './index.ts'

/** PostgreSQL `sslmode` values that encrypt the connection. */
export const sslModes = ['require', 'verify-ca', 'verify-full']

type Output = Record<string, unknown>
const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

// A template is never resolved, not even from the environment: the value would differ between machines.
const variableOf = (template: string) =>
  template.match(/env_var\(\s*['"]([^'"]+)['"]/)?.[1] ?? template.replace(/^\{\{|\}\}$/g, '').trim()

/** Parses the parsed `profiles.yml`: each output of each profile becomes a connection `profile (output)`. */
export function parseDbt(profiles: unknown): ImportResult {
  const result: ImportResult = { candidates: [], skipped: [] }
  for (const [profile, value] of Object.entries(record(profiles))) {
    if (profile === 'config') continue
    for (const [output, body] of Object.entries(record(record(value).outputs))) {
      const o: Output = record(body)
      const name = `${profile} (${output})`
      const notes: ImportNote[] = []
      // The first of the names that is set; a template leaves the field empty and says where the value comes from.
      const get = (field: string, ...names: string[]): string | undefined => {
        const v = names.map((n) => o[n]).find((v) => v !== undefined && v !== null)
        if (v === undefined) return undefined
        if (typeof v === 'string' && v.includes('{{')) {
          notes.push({ key: 'envVar', params: { field, variable: variableOf(v) } })
          return undefined
        }
        return String(v)
      }
      const flag = (v: unknown) => v === true || v === 'true' || v === 'True'
      const host = (...names: string[]) => get('host', ...names)
      const port = () => {
        const p = get('port', 'port')
        return p ? Number(p) : undefined
      }
      let config: Omit<ConnectionConfig, 'id'> | undefined
      switch (o.type) {
        case 'postgres':
          config = {
            name,
            dialect: 'postgres',
            host: host('host'),
            port: port(),
            user: get('user', 'user'),
            password: get('password', 'password', 'pass'),
            database: get('database', 'dbname', 'database'),
            searchPath: get('schema', 'schema'),
            ssl: sslModes.includes(String(o.sslmode)) || undefined,
          }
          break
        case 'sqlserver':
        case 'fabric': {
          let auth: ConnectionAuth | undefined
          const tenantId = get('tenant_id', 'tenant_id')
          const clientId = get('client_id', 'client_id')
          let password = get('password', 'password')
          const authentication = String(o.authentication ?? '').toLowerCase()
          if (flag(o.windows_login)) auth = 'windows'
          else if (['cli', 'environment', 'auto', 'activedirectorymsi'].includes(authentication)) auth = 'entra-default'
          else if (['activedirectoryinteractive', 'activedirectorypassword'].includes(authentication)) {
            auth = 'entra-interactive'
          } else if (['serviceprincipal', 'activedirectoryserviceprincipal'].includes(authentication)) {
            auth = 'entra-service-principal'
            password = get('client_secret', 'client_secret')
          } else if (authentication && authentication !== 'sql') {
            notes.push({ key: 'authUnsupported', params: { auth: String(o.authentication) } })
          }
          config = {
            name,
            dialect: 'mssql',
            host: host('server', 'host'),
            port: port(),
            database: get('database', 'database'),
            user: get('user', 'user', 'username'),
            password,
            auth,
            tenantId,
            clientId,
            ssl: o.encrypt !== false && o.encrypt !== 'false',
            sslInsecure: flag(o.trust_cert),
          }
          break
        }
        case 'mysql':
        case 'mariadb':
          config = {
            name,
            dialect: 'mysql',
            host: host('server', 'host'),
            port: port(),
            database: get('database', 'schema', 'database'),
            user: get('user', 'username', 'user'),
            password: get('password', 'password'),
          }
          break
        case 'clickhouse':
          config = {
            name,
            dialect: 'clickhouse',
            host: host('host'),
            port: port(),
            database: get('database', 'schema'),
            user: get('user', 'user'),
            password: get('password', 'password'),
            ssl: flag(o.secure) || undefined,
          }
          break
        case 'duckdb': {
          const file = get('path', 'path') ?? (o.path === undefined ? ':memory:' : undefined)
          if (file && file !== ':memory:' && !path.isAbsolute(file) && !path.win32.isAbsolute(file)) {
            notes.push({ key: 'relativePath', params: { path: file } })
          }
          config = { name, dialect: 'duckdb', file }
          break
        }
        default:
          result.skipped.push({ name, note: { key: 'unsupportedEngine', params: { engine: String(o.type) } } })
          continue
      }
      // A host that comes from a template is not missing.
      if (config.dialect !== 'duckdb' && !config.host && !notes.some((n) => n.params?.field === 'host')) {
        result.skipped.push({ name, note: { key: 'noHost' } })
        continue
      }
      result.candidates.push({ key: `${profile}/${output}`, config, notes })
    }
  }
  return result
}
