// Fetches the published Colwerk releases from the GitHub API at build time (changelog, version, download section).
import { GITHUB_TOKEN } from 'astro:env/server'
import { repo } from './config'

export interface Release {
  tag_name: string
  name: string | null
  html_url: string
  published_at: string
  prerelease: boolean
  draft: boolean
  body_html?: string
}

// Fetched once per build, lazily: Cloudflare's prerender runtime forbids fetch() in global scope.
// GITHUB_TOKEN is optional and only raises the API rate limit (shared build IPs).
let cached: Promise<{ releases: Release[]; latest: Release; version: string }> | undefined

export const getReleases = () =>
  (cached ??= (async () => {
    const res = await fetch(
      `${repo.replace('https://github.com/', 'https://api.github.com/repos/')}/releases?per_page=100`,
      {
        headers: {
          Accept: 'application/vnd.github.html+json',
          'User-Agent': 'colwerk-website',
          ...(GITHUB_TOKEN && { Authorization: `Bearer ${GITHUB_TOKEN}` }),
        },
      },
    )
    if (!res.ok) throw new Error(`GitHub releases: ${res.status} ${res.statusText}`)
    const releases = ((await res.json()) as Release[]).filter((r) => !r.draft)
    const latest = releases.find((r) => !r.prerelease)!
    return { releases, latest, version: latest.tag_name.replace(/^v/, '') }
  })())

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
