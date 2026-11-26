// /llms-full.txt: the llms.txt header followed by the whole documentation as Markdown, in sidebar order.
import type { APIRoute } from 'astro'
import { getReleases } from '../github'
import { docsGroups, llmsHeader } from '../llms'
import { docsMarkdown } from '../markdown'

export const GET: APIRoute = async () => {
  const { version } = await getReleases()
  const pages = (await docsGroups()).flatMap((g) => g.pages.map(docsMarkdown))
  return new Response(`${llmsHeader(version)}\n---\n\n${pages.join('\n---\n\n')}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
