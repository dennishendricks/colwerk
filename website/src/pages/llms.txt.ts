// /llms.txt: Colwerk in brief for AI assistants, with links to the Markdown version of every docs page.
import type { APIRoute } from 'astro'
import { getReleases } from '../github'
import { llmsTxt } from '../llms'

export const GET: APIRoute = async () => {
  const { version } = await getReleases()
  return new Response(await llmsTxt(version), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
