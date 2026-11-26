// Starlight route middleware: og:type of the landing page, the Markdown version and breadcrumbs (JSON-LD) of a page.
import { defineRouteMiddleware, type StarlightRouteData } from '@astrojs/starlight/route-data'
import { getCollection } from 'astro:content'
import { markdownPath, pagePath, site } from './markdown'

// URLs of the pages with a Markdown version: src/pages/[...path].md.ts
let markdownPages: Promise<Set<string>> | undefined
const getMarkdownPages = () =>
  (markdownPages ??= getCollection('docs', (e) => e.id !== '404').then((l) => new Set(l.map((e) => pagePath(e.id)))))

type SidebarEntry = StarlightRouteData['sidebar'][number]
const links = (e: SidebarEntry): Extract<SidebarEntry, { type: 'link' }>[] =>
  e.type === 'link' ? [e] : e.entries.flatMap(links)

export const onRequest = defineRouteMiddleware(async (context) => {
  const route = context.locals.starlightRoute
  const { pathname } = context.url

  if (pathname === '/') {
    const ogType = route.head.find((h) => h.attrs?.property === 'og:type')
    if (ogType?.attrs) ogType.attrs.content = 'website'
    return
  }

  // the release notes have a Markdown version too: src/pages/changelog/[minor].md.ts
  if ((await getMarkdownPages()).has(pathname) || /^\/changelog\/\d+\.\d+\/$/.test(pathname)) {
    route.head.push({
      tag: 'link',
      attrs: { rel: 'alternate', type: 'text/markdown', href: markdownPath(pathname) },
    })
  }

  // Colwerk › section of the sidebar › page
  const group = route.sidebar.find((e) => e.type === 'group' && links(e).some((l) => l.isCurrent))
  if (pathname.startsWith('/docs/') && group?.type === 'group') {
    const items = [
      { name: 'Colwerk', item: `${site}/` },
      { name: group.label, item: new URL(links(group)[0]!.href, site).href },
      { name: route.entry.data.title, item: new URL(pathname, site).href },
    ]
    route.head.push({
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      content: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, ...item })),
      }),
    })
  }
})
