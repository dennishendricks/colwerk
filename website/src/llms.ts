// Content of /llms.txt and /llms-full.txt (https://llmstxt.org): what Colwerk is, key facts and the docs in Markdown.
import { getCollection } from 'astro:content'
import { docsSidebar, guides, releases, repo } from './config'
import { markdownPath, pagePath, site } from './markdown'

/** Docs pages in sidebar order, grouped like the sidebar */
export async function docsGroups() {
  const entries = await getCollection('docs', (e) => e.id.startsWith('docs/'))
  return docsSidebar.map(({ label, items }) => {
    const dir = items[0]!.autogenerate.directory
    const pages = entries
      .filter((e) => e.id.startsWith(`${dir}/`))
      .sort((a, b) => (a.data.sidebar.order ?? Infinity) - (b.data.sidebar.order ?? Infinity))
    return { label, pages }
  })
}

/** The pages per engine and topic (config.ts), in footer order */
export async function guideEntries() {
  const entries = await getCollection('docs')
  return guides.map((g) => entries.find((e) => pagePath(e.id) === g.href)!)
}

/** Title, summary and key facts, from the English UI strings of the landing page (src/content/i18n/en.json) */
export function llmsHeader(version: string, t: App.Locals['t']) {
  const facts = ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map(
    (i) => `- ${t(`landing.glance.fact${i}.label`)}: ${t(`landing.glance.fact${i}.value`)}`,
  )
  return `# Colwerk

> ${t('landing.glance.summary')}

${facts.join('\n')}
- Current version: ${version}

Website: ${site}/ · Source code: ${repo} · Downloads: ${releases}
`
}

export async function llmsTxt(version: string, t: App.Locals['t']) {
  const groups = await docsGroups()
  const guidePages = await guideEntries()
  const link = (e: (typeof guidePages)[number]) =>
    `- [${e.data.title}](${site}${markdownPath(pagePath(e.id))}): ${e.data.description ?? ''}`
  return `${llmsHeader(version, t)}
Every docs page is also available as Markdown: append .md to its URL without the trailing slash. All docs in one file:
${site}/llms-full.txt

## Colwerk per engine and topic

${guidePages.map(link).join('\n')}

${groups.map((g) => `## ${g.label}\n\n${g.pages.map(link).join('\n')}`).join('\n\n')}

## Optional

- [Changelog](${site}/changelog/): release notes of every version
- [Privacy policy](${site}/privacy.md): what colwerk.app and the app do with personal data
`
}
