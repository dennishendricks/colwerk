import type { ImportCandidate, ImportNote, ImportResult } from './index.ts'

// Splits at colons that are not escaped; `\:` and `\\` stand for the character itself.
function fields(line: string): string[] {
  const result: string[] = []
  let field = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '\\' && (line[i + 1] === ':' || line[i + 1] === '\\')) field += line[++i]
    else if (c === ':') {
      result.push(field)
      field = ''
    } else field += c
  }
  return [...result, field]
}

/** Parses the lines `host:port:database:user:password` of a `.pgpass` file; `*` means any. */
export function parsePgpass(text: string): ImportResult {
  const result: ImportResult = { candidates: [], skipped: [] }
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return
    const [host, port, database, user, ...rest] = fields(line)
    const name = `line ${i + 1}`
    if (rest.length === 0) return void result.skipped.push({ name, note: { key: 'noHost' } })
    const label = `${user || '*'}@${host}${port && port !== '*' ? `:${port}` : ''}/${database || '*'}`
    if (host === '*')
      return void result.skipped.push({ name: label, note: { key: 'wildcard', params: { field: 'host' } } })
    const notes: ImportNote[] = user === '*' ? [{ key: 'wildcard', params: { field: 'user' } }] : []
    const candidate: ImportCandidate = {
      key: `line-${i + 1}`,
      config: {
        name: label,
        dialect: 'postgres',
        ...(host!.startsWith('/') ? { socket: host } : { host }),
        port: port && port !== '*' ? Number(port) : undefined,
        database: database && database !== '*' ? database : undefined,
        user: user && user !== '*' ? user : undefined,
        password: rest.join(':') || undefined,
      },
      notes,
    }
    result.candidates.push(candidate)
  })
  return result
}
