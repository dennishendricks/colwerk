// Website and documentation of Colwerk (Astro Starlight). Deployed only from the commit of the latest published
// release (.github/workflows/website.yml), so the docs never describe unreleased changes.
import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { defineConfig, envField } from 'astro/config'
import { satteri } from '@astrojs/markdown-satteri'
import sitemap from '@astrojs/sitemap'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'
import { docsSidebar, repo } from './src/config'
import { kbdPlugin } from './src/keys'
import { fetchReleases, minorOf, versionOf } from './src/releases'

const site = 'https://colwerk.app'

// Dates of the last change come from Git, which a shallow clone does not have: then pages go without them.
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const fullHistory = git('rev-parse', '--is-shallow-repository') === 'false'
const changed = (...paths: string[]) => (fullHistory && git('log', '-1', '--format=%cI', '--', ...paths)) || undefined

// Page URL → date of its last change, for the sitemap: docs pages from Git, the changelog from the releases
let releases: ReturnType<typeof fetchReleases> | undefined
const getReleases = () => (releases ??= fetchReleases(process.env.GITHUB_TOKEN))
let lastmods: Promise<Map<string, string | undefined>> | undefined
const getLastmods = () =>
  (lastmods ??= (async () => {
    const map = new Map<string, string | undefined>()
    const dir = 'src/content/docs'
    for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
      if (!/\.mdx?$/.test(file)) continue
      map.set(
        `/${file.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')}/`.replace(/\/+/g, '/'),
        changed(`${dir}/${file}`),
      )
    }
    map.set('/', changed('src/pages/index.astro', 'src/components', 'src/facts.ts'))
    const list = await getReleases()
    map.set('/changelog/', list[0]?.published_at)
    for (const r of list)
      if (!map.has(`/changelog/${minorOf(r)}/`)) map.set(`/changelog/${minorOf(r)}/`, r.published_at)
    return map
  })())

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',

  build: {
    assets: '_assets',
  },

  image: { dangerouslyProcessSVG: true },

  // `:kbd[meta+T]` in the docs (src/keys.ts). Starlight adds its own plugins (asides) to this processor.
  markdown: { processor: satteri({ features: { directive: true }, mdastPlugins: [kbdPlugin] }) },

  // Without a fixed tsconfig, Vite looks for one upwards from each file that website/tsconfig.json does not cover and
  // reaches the app's tsconfig.json, whose references into .nuxt/ do not exist in CI. Loading this config has the same
  // problem with the importer website/index.html, which is why tsconfig.json lists that file.
  vite: { tsconfig: './tsconfig.json' },

  env: {
    schema: {
      // optional: raises the GitHub API rate limit when fetching releases at build time
      GITHUB_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },

  integrations: [
    // Starlight adds no sitemap of its own when there is one
    sitemap({
      serialize: async (item) => {
        const lastmod = (await getLastmods()).get(new URL(item.url).pathname)
        return lastmod ? { ...item, lastmod } : item
      },
    }),
    // The release notes moved from one page per version to one per minor version (/changelog/0.9.2/ → /changelog/0.9/)
    {
      name: 'colwerk-redirects',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const lines = (await getReleases()).flatMap((r) => {
            const to = `/changelog/${minorOf(r)}/`
            return [`/changelog/${versionOf(r)}/ ${to} 301`, `/changelog/${versionOf(r)} ${to} 301`]
          })
          writeFileSync(new URL('_redirects', dir), `${lines.join('\n')}\n`)
        },
      },
    },
    starlight({
      title: 'Colwerk',
      titleDelimiter: '·',
      description:
        'Free, open-source SQL editor and database client for macOS, Windows and Linux. PostgreSQL, MySQL, SQLite, SQL Server, ClickHouse, DuckDB and lakehouses.',
      logo: { src: './src/assets/favicon.svg' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      customCss: ['./src/styles/theme.css'],
      lastUpdated: fullHistory,
      routeMiddleware: './src/routeData.ts',
      components: {
        Footer: './src/components/Footer.astro',
        Head: './src/components/Head.astro',
        Hero: './src/components/Hero.astro',
      },
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: `${site}/og-image.jpg` } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image:alt',
            content: 'Colwerk logo with the tagline: A lightweight SQL editor and database client for the desktop',
          },
        },
      ],
      // Fails the build on dead links between the Markdown pages; the pages in src/pages/ are not checked.
      plugins: [starlightLinksValidator({ exclude: ['/', '/#download', '/changelog/', '/changelog/**'] })],
      sidebar: [...docsSidebar, { label: 'Changelog', link: '/changelog/' }],
    }),
  ],
})
