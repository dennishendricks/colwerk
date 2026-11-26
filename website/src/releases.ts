// Fetches the published Colwerk releases from the GitHub API; free of astro:* imports, so astro.config.ts can use it.
import { repo } from './config'

export interface Release {
  tag_name: string
  name: string | null
  html_url: string
  published_at: string
  prerelease: boolean
  draft: boolean
  body?: string
  body_html?: string
  assets: { name: string; browser_download_url: string }[]
}

/** Published releases, newest first. The token is optional and only raises the API rate limit (shared build IPs). */
export async function fetchReleases(token?: string) {
  const res = await fetch(
    `${repo.replace('https://github.com/', 'https://api.github.com/repos/')}/releases?per_page=100`,
    {
      headers: {
        // body (Markdown, for the .md pages) and body_html
        Accept: 'application/vnd.github.full+json',
        'User-Agent': 'colwerk-website',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    },
  )
  if (!res.ok) throw new Error(`GitHub releases: ${res.status} ${res.statusText}`)
  return ((await res.json()) as Release[]).filter((r) => !r.draft)
}

export const versionOf = (r: Release) => r.tag_name.replace(/^v/, '')

/** 0.9.2 → 0.9: the changelog has one page per minor version. */
export const minorOf = (r: Release) => versionOf(r).split('.').slice(0, 2).join('.')
