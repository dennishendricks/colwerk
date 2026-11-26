// Markdown version of the release notes of one minor version (/changelog/0.9/ → /changelog/0.9.md).
import type { APIRoute, GetStaticPaths } from 'astro'
import { byMinor, formatDate, getReleases, versionOf, type Release } from '../../github'
import { site } from '../../markdown'

export const getStaticPaths = (async () => {
  const { releases } = await getReleases()
  return [...byMinor(releases)].map(([minor, list]) => ({ params: { minor }, props: { minor, list } }))
}) satisfies GetStaticPaths

export const GET: APIRoute<{ minor: string; list: Release[] }> = ({ props: { minor, list } }) => {
  const sections = list.map((r) => {
    // each release is a level-2 heading, so the headings of its notes move one level down
    const body = (r.body ?? '').replace(/^(#{2,5}) /gm, '#$1 ').trim()
    return `## ${versionOf(r)}\n\nReleased ${formatDate(r.published_at)}${r.prerelease ? ' (pre-release)' : ''}. Downloads: ${r.html_url}\n\n${body}`
  })
  const md = `# Colwerk release notes ${minor}\n\nSource: ${site}/changelog/${minor}/\n\n${sections.join('\n\n')}\n`
  return new Response(md, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
