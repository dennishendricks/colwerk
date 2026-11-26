// Plain Markdown of the docs pages for AI assistants and crawlers (/docs/<page>.md, llms.txt, llms-full.txt).
import type { CollectionEntry } from 'astro:content'
import reference from './data/reference.json'
import { formatKeys } from './keys'

export const site = 'https://colwerk.app'

/** Page URL → its Markdown version: /docs/start/ → /docs/start.md */
export const markdownPath = (pathname: string) => `${pathname.replace(/\/$/, '')}.md`

/** Docs entry id → page URL: docs/start/index → /docs/start/ */
export const pagePath = (id: string) => `/${id.replace(/(^|\/)index$/, '')}/`.replace(/\/+/g, '/')

const table = (head: string[], rows: string[][]) =>
  [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n')

const keys = (names: string[], other?: string) => {
  const { mac, other: f } = formatKeys(names)
  const rest = other ?? f
  return mac === rest ? mac : `${mac} / ${rest}`
}

// The generated tables of the .mdx pages (src/components/docs/), as Markdown
const components: Record<string, () => string> = {
  FeatureMatrix: () => {
    const { engines } = reference
    type Features = (typeof engines)[number]['features']
    const rows: [string, (f: Features) => boolean | string][] = [
      ['Schemas', (f) => f.schemas],
      ['Database picker', (f) => f.databases],
      ['Cancel a running query', (f) => f.cancel],
      ['Edit rows in the result grid', (f) => f.editRows],
      ['Dry run', (f) => f.dryRun],
      ['Plan check before full scans', (f) => f.planCheck],
      ['Schema compare', (f) => f.schemaCompare],
      ['Data compare', (f) => f.dataCompare],
      ['Session monitor', (f) => f.sessionActions.join(', ') || false],
    ]
    const cell = (v: boolean | string) => (v === true ? 'yes' : v === false ? 'no' : v)
    return table(
      ['Feature', ...engines.map((e) => e.label)],
      rows.map(([label, value]) => [label, ...engines.map((e) => cell(value(e.features)))]),
    )
  },
  McpTools: () =>
    reference.mcpTools
      .map((t) => {
        const summary = t.description.split(/\n\s*\n/)[0]!.replace(/\s+/g, ' ')
        const params = t.parameters.length
          ? table(
              ['Parameter', 'Type', 'Description'],
              t.parameters.map((p) => [
                `\`${p.name}\`${p.required ? '' : ' (optional)'}`,
                p.type,
                `${p.description}${p.default !== null ? ` Default: ${p.default}.` : ''}`.replace(/\s+/g, ' '),
              ]),
            )
          : 'No parameters.'
        return `## \`${t.name}\`\n\n${summary}${t.readOnly ? ' Read-only.' : ''}\n\n${params}`
      })
      .join('\n\n'),
  Shortcuts: () =>
    table(
      ['Keys', 'Action'],
      reference.shortcuts.map((s) => [keys(s.keys), s.label]),
    ),
}

/** Markdown of a docs page: title, description, then the body with components, directives and links resolved. */
export function docsMarkdown(entry: CollectionEntry<'docs'>) {
  const body = (entry.body ?? '')
    .replace(/^import .*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<(\w+) \/>/g, (all, name: string) => components[name]?.() ?? all)
    // :kbd[meta+shift+D]{other="Ctrl+Y"} → ⇧⌘D / Ctrl+Y
    .replace(/:kbd\[((?:\\.|[^\]])*)\](?:\{other="([^"]*)"\})?/g, (_, k: string, other?: string) =>
      keys(k.replace(/\\(.)/g, '$1').split(/\+(?=.)/), other),
    )
    .replace(/\]\(\//g, `](${site}/`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const { title, description } = entry.data
  return `# ${title}\n\n${description ? `> ${description}\n\n` : ''}Source: ${site}${pagePath(entry.id)}\n\n${body}\n`
}
