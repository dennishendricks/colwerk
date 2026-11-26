// Starlight route middleware: og:type and WebSite data of the landing pages, canonical URLs of untranslated German pages, the Markdown
// version and breadcrumbs (JSON-LD) of a page.
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

  if (pathname === '/' || pathname === '/de/') {
    const ogType = route.head.find((h) => h.attrs?.property === 'og:type')
    if (ogType?.attrs) ogType.attrs.content = 'website'
    route.head.push({
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      content: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Colwerk',
        url: new URL(pathname, site).href,
        inLanguage: route.lang,
        publisher: { '@type': 'Person', name: 'Dennis Hendricks', url: 'https://github.com/dennishendricks' },
      }),
    })
    return
  }

  // Only the landing page is translated. Starlight shows the other pages under /de/ with the English content (fallback
  // pages): they point to the English original, and no English page announces them as its German version.
  route.head = route.head.filter((h) => !h.attrs?.hreflang)
  if (route.isFallback) {
    const canonical = route.head.find((h) => h.attrs?.rel === 'canonical')
    if (canonical?.attrs) canonical.attrs.href = new URL(pathname.replace(/^\/de\//, '/'), site).href
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
