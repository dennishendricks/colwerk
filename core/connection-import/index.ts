// Import of connections from other database tools. The parsers only read the source files and return
// `ImportCandidate`s; saving them (with their secrets) is up to the server layer.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { drivers } from '../registry.ts'
import type { ConnectionSummary } from '../store.ts'
import { AppError, type ConnectionConfig } from '../types.ts'
import { parseAds, parseJsonc } from './ads.ts'
import { readBeekeeper } from './beekeeper.ts'
import { readDbeaver } from './dbeaver.ts'
import { parseDbt } from './dbt.ts'
import { parsePgpass } from './pgpass.ts'

export const importSources = ['dbeaver', 'beekeeper', 'ads', 'pgpass', 'dbt'] as const
export type ImportSource = (typeof importSources)[number]

/** Hint for a candidate or skipped connection; its text is the i18n key `connectionImport.notes.<key>`. */
export interface ImportNote {
  key: string
  params?: Record<string, string | number>
}

/** `config` may hold `password` and `sshSecret`; they never leave the server. */
export interface ImportCandidate {
  /** Identifies the connection within its source file, so that the import can find it again. */
  key: string
  config: Omit<ConnectionConfig, 'id'>
  notes: ImportNote[]
}

/** A connection that cannot be imported, with the reason. */
export interface ImportSkipped {
  name: string
  note: ImportNote
}

export interface ImportResult {
  candidates: ImportCandidate[]
  skipped: ImportSkipped[]
}

export interface ImportPreviewItem {
  key: string
  connection: Omit<ConnectionConfig, 'id' | 'password' | 'sshSecret'> & { hasPassword: boolean; hasSshSecret: boolean }
  notes: ImportNote[]
  /** Name of the existing connection (or of an earlier one in the same file) this one repeats. */
  duplicate?: string
}

export interface ImportPreview {
  path: string
  items: ImportPreviewItem[]
  skipped: ImportSkipped[]
}

/**
 * Default locations of the source's file, most likely first. `platform`, `env` and `home` are parameters so
 * that the paths of every platform can be tested on any one.
 */
export function importPaths(
  source: ImportSource,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const appData = env.APPDATA ?? p.join(home, 'AppData', 'Roaming')
  const config = env.XDG_CONFIG_HOME ?? p.join(home, '.config')
  const data = env.XDG_DATA_HOME ?? p.join(home, '.local', 'share')
  const mac = platform === 'darwin'
  const support = p.join(home, 'Library', 'Application Support')
  const dbeaver = p.join('DBeaverData', 'workspace6', 'General', '.dbeaver', 'data-sources.json')
  switch (source) {
    case 'dbeaver':
      return mac
        ? [p.join(home, 'Library', dbeaver)]
        : platform === 'win32'
          ? [p.join(appData, dbeaver)]
          : [p.join(data, dbeaver), p.join(home, '.var', 'app', 'io.dbeaver.DBeaverCommunity', 'data', dbeaver)]
    case 'beekeeper':
      return mac
        ? [p.join(support, 'beekeeper-studio', 'app.db')]
        : platform === 'win32'
          ? [p.join(appData, 'beekeeper-studio', 'app.db')]
          : [
              p.join(config, 'beekeeper-studio', 'app.db'),
              p.join(home, 'snap', 'beekeeper-studio', 'current', '.config', 'beekeeper-studio', 'app.db'),
              p.join(home, '.var', 'app', 'io.beekeeperstudio.Studio', 'config', 'beekeeper-studio', 'app.db'),
            ]
    case 'ads':
      return [
        mac
          ? p.join(support, 'azuredatastudio', 'User', 'settings.json')
          : platform === 'win32'
            ? p.join(appData, 'azuredatastudio', 'User', 'settings.json')
            : p.join(config, 'azuredatastudio', 'User', 'settings.json'),
      ]
    case 'pgpass':
      return [
        env.PGPASSFILE ??
          (platform === 'win32' ? p.join(appData, 'postgresql', 'pgpass.conf') : p.join(home, '.pgpass')),
      ]
    case 'dbt':
      return [
        ...(env.DBT_PROFILES_DIR ? [p.join(env.DBT_PROFILES_DIR, 'profiles.yml')] : []),
        p.join(home, '.dbt', 'profiles.yml'),
      ]
  }
}

/** The first default file of the source that exists. */
export function findImportFile(source: ImportSource): string | undefined {
  return importPaths(source).find((file) => existsSync(file))
}

// YAML comes from Bun's built-in parser: the server runs on Bun, core itself only imports node: APIs.
function parseYaml(text: string): unknown {
  const yaml = (globalThis as { Bun?: { YAML: { parse(text: string): unknown } } }).Bun?.YAML
  if (!yaml) throw new Error('YAML needs the Bun runtime')
  return yaml.parse(text)
}

/** Reads the connections of the source's file `file`; the file itself is never modified. */
export async function readImport(source: ImportSource, file: string): Promise<ImportResult> {
  try {
    switch (source) {
      case 'dbeaver':
        return await readDbeaver(file)
      case 'beekeeper':
        return await readBeekeeper(file)
      case 'ads':
        return parseAds(parseJsonc(await readFile(file, 'utf8')))
      case 'pgpass':
        return parsePgpass(await readFile(file, 'utf8'))
      case 'dbt':
        return parseDbt(parseYaml(await readFile(file, 'utf8')))
    }
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') {
      throw new AppError('importNotFound', `File not found: ${file}`, { params: { path: file } })
    }
    const detail = e instanceof Error ? e.message : String(e)
    throw new AppError('importUnreadable', `The file could not be read: ${detail}`, { params: { detail } })
  }
}

type Comparable = Pick<ConnectionConfig, 'dialect' | 'host' | 'port' | 'database' | 'user' | 'instanceName' | 'file'>

/** Two connections are the same if they have the same dialect and the same file, or the same server, login and database. */
export function sameConnection(a: Comparable, b: Comparable): boolean {
  if (a.dialect !== b.dialect) return false
  if (a.file) return a.file === b.file
  const port = (c: Comparable) => c.port ?? drivers.find((d) => d.dialect === c.dialect)?.defaultPort
  return (
    !!a.host &&
    a.host.toLowerCase() === b.host?.toLowerCase() &&
    port(a) === port(b) &&
    (a.database ?? '') === (b.database ?? '') &&
    (a.user ?? '').toLowerCase() === (b.user ?? '').toLowerCase() &&
    a.instanceName === b.instanceName
  )
}

/** Marks the candidates that repeat an existing connection or an earlier candidate, and removes the secrets. */
export function previewImport(result: ImportResult, existing: ConnectionSummary[], file: string): ImportPreview {
  const seen: (Comparable & { name: string })[] = [...existing]
  const items = result.candidates.map(({ key, config, notes }): ImportPreviewItem => {
    const { password, sshSecret, ...rest } = config
    const duplicate = seen.find((c) => sameConnection(config, c))?.name
    seen.push(config)
    return {
      key,
      connection: { ...rest, hasPassword: !!password, hasSshSecret: !!sshSecret },
      notes,
      duplicate,
    }
  })
  return { path: file, items, skipped: result.skipped }
}
