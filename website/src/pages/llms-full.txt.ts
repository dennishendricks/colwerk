// /llms-full.txt: the llms.txt header, then the pages per engine and topic and the whole documentation as Markdown.
import type { APIRoute } from 'astro'
import { getReleases } from '../github'
import { docsGroups, guideEntries, llmsHeader } from '../llms'
import { docsMarkdown } from '../markdown'

export const GET: APIRoute = async ({ locals }) => {
  const { version } = await getReleases()
  const pages = [...(await guideEntries()), ...(await docsGroups()).flatMap((g) => g.pages)].map(docsMarkdown)
  return new Response(`${llmsHeader(version, locals.t)}\n---\n\n${pages.join('\n---\n\n')}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
