// Published Colwerk releases at build time (changelog, version, download section), and the changelog's sidebar.
import { GITHUB_TOKEN } from 'astro:env/server'
import { docsSidebar } from './config'
import { fetchReleases, minorOf, type Release } from './releases'

export { minorOf, versionOf, type Release } from './releases'

// Fetched once per build, lazily: Cloudflare's prerender runtime forbids fetch() in global scope.
let cached: Promise<{ releases: Release[]; latest: Release; version: string }> | undefined

export const getReleases = () =>
  (cached ??= (async () => {
    const releases = await fetchReleases(GITHUB_TOKEN)
    const latest = releases.find((r) => !r.prerelease)!
    return { releases, latest, version: latest.tag_name.replace(/^v/, '') }
  })())

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/** Releases grouped by minor version (0.9 → [0.9.2, 0.9.1, 0.9.0]), newest first like the releases. */
export const byMinor = (releases: Release[]) => Map.groupBy(releases, minorOf)

// Sidebar of the changelog pages: the docs, then one page per minor version.
export const changelogSidebar = (releases: Release[]) => [
  ...docsSidebar,
  {
    label: 'Changelog',
    items: [
      { label: 'All releases', link: '/changelog/' },
      ...[...byMinor(releases).keys()].map((minor) => ({ label: minor, link: `/changelog/${minor}/` })),
    ],
  },
]
