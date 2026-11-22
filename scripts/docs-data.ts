// Reference data of the documentation: writes website/src/data/reference.json from the code (engines and what they
// support, defaults and limits, shortcuts, MCP tools), so the reference pages cannot drift from the app. `--check` only compares
// and exits with 1 if the file is outdated (CI). The pre-commit hook runs it.
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { drivers } from '../core/registry.ts'
import { HISTORY_LIMIT } from '../core/history.ts'
import { AUDIT_LIMIT, auditRetentions, DEFAULT_AUDIT_RETENTION } from '../core/audit.ts'
import { DEFAULT_SCAN_ROWS, planCheckDialects } from '../core/plan-check.ts'
import { dryRunDialects } from '../core/sql-dml.ts'
import { editDialects } from '../core/table-edit.ts'
import { dataCompareDialects, schemaCompareDialects } from '../core/compare/types.ts'
import { exportFormats } from '../core/export/index.ts'
import { isLakehouse } from '../core/types.ts'
import { shortcuts } from '../app/utils/shortcuts.ts'

const OUT = 'website/src/data/reference.json'
const check = process.argv.includes('--check')

const has = (list: readonly string[], dialect: string) => list.includes(dialect)

const engines = drivers.map((d) => ({
  dialect: d.dialect,
  label: d.label,
  lakehouse: isLakehouse(d.dialect),
  defaultPort: d.defaultPort ?? null,
  auths: d.auths,
  features: {
    schemas: d.capabilities.supportsSchemas,
    databases: d.capabilities.supportsDatabases,
    cancel: d.capabilities.supportsCancel,
    sessionActions: d.capabilities.sessionActions,
    editRows: has(editDialects, d.dialect),
    dryRun: has(dryRunDialects, d.dialect),
    planCheck: has(planCheckDialects, d.dialect),
    schemaCompare: has(schemaCompareDialects, d.dialect),
    dataCompare: has(dataCompareDialects, d.dialect),
  },
}))

// The tools are Nuxt modules: `defineMcpTool` is an auto-import, the others are only used inside the handlers.
// `#core` resolves through `imports` in package.json.
Object.assign(globalThis, { defineMcpTool: (tool: unknown) => tool })
const toolDir = 'server/mcp/tools'
const mcpTools = await Promise.all(
  (await readdir(toolDir))
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map(async (file) => {
      const tool = (await import(`../${toolDir}/${file}`)).default as {
        name: string
        title: string
        description: string
        inputSchema?: z.ZodRawShape
        annotations?: Record<string, boolean>
      }
      const schema = z.toJSONSchema(z.object(tool.inputSchema ?? {})) as {
        properties?: Record<string, { type?: string; description?: string; default?: unknown }>
        required?: string[]
      }
      return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        readOnly: tool.annotations?.readOnlyHint ?? false,
        parameters: Object.entries(schema.properties ?? {}).map(([name, p]) => ({
          name,
          type: p.type ?? 'any',
          required: (schema.required?.includes(name) ?? false) && p.default === undefined,
          default: p.default ?? null,
          description: p.description ?? '',
        })),
      }
    }),
)

// labels in English, as the documentation is
const strings = JSON.parse(await readFile('i18n/locales/en.json', 'utf8')).shortcuts as Record<string, string>
const shortcutList = shortcuts.map((s) => ({
  keys: s.keys.map((k) => (k === 'drag' ? strings.drag! : k)),
  label: strings[s.label]!,
}))

const data = {
  engines,
  shortcuts: shortcutList,
  exportFormats,
  limits: {
    historyEntries: HISTORY_LIMIT,
    auditEntries: AUDIT_LIMIT,
    auditRetentionDays: auditRetentions,
    defaultAuditRetentionDays: DEFAULT_AUDIT_RETENTION,
    planCheckScanRows: DEFAULT_SCAN_ROWS,
  },
  mcpTools,
}

// Formatted like `bun fmt` would, so the pre-commit hook leaves the file alone; next to it for the same settings.
const tmp = OUT.replace(/\.json$/, '.tmp.json')
await writeFile(tmp, JSON.stringify(data))
Bun.spawnSync(['bun', 'fmt', tmp], { stdout: 'ignore' })
const text = await readFile(tmp, 'utf8')
await rm(tmp)
const current = await readFile(OUT, 'utf8').catch(() => '')
if (current === text) process.exit(0)
if (check) {
  console.error(`${OUT} is outdated: run \`bun run docs-data\``)
  process.exit(1)
}
await writeFile(OUT, text)
console.log(`updated ${OUT}`)
