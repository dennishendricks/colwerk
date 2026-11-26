// Markdown version of every docs page (/docs/start/ → /docs/start.md), linked from the page head (src/routeData.ts).
import type { APIRoute, GetStaticPaths } from 'astro'
import { getCollection, type CollectionEntry } from 'astro:content'
import { docsMarkdown, markdownPath, pagePath } from '../markdown'

export const getStaticPaths = (async () => {
  const entries = await getCollection('docs', (e) => e.id !== '404')
  return entries.map((entry) => ({
    params: { path: markdownPath(pagePath(entry.id)).slice(1, -'.md'.length) },
    props: { entry },
  }))
}) satisfies GetStaticPaths

export const GET: APIRoute<{ entry: CollectionEntry<'docs'> }> = ({ props }) =>
  new Response(docsMarkdown(props.entry), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
