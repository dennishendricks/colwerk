// Website and documentation of Colwerk (Astro Starlight). Deployed only from the commit of the latest published
// release (.github/workflows/website.yml), so the docs never describe unreleased changes.
import { defineConfig, envField } from 'astro/config'
import starlight from '@astrojs/starlight'
import { repo } from './src/config'

const site = 'https://colwerk.app'

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',

  build: {
    assets: '_assets',
  },

  env: {
    schema: {
      // optional: raises the GitHub API rate limit when fetching releases at build time
      GITHUB_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },

  integrations: [
    starlight({
      title: 'Colwerk',
      titleDelimiter: '·',
      description:
        'Free, open-source SQL editor and database client for macOS, Windows and Linux. PostgreSQL, MySQL, SQLite, SQL Server, ClickHouse, DuckDB and lakehouses.',
      logo: { src: './src/assets/favicon.svg' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      customCss: ['./src/styles/theme.css'],
      components: { Footer: './src/components/Footer.astro' },
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.svg' } },
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
      sidebar: [
        // Documentation pages go to src/content/docs/docs/; add `{ label: 'Documentation', autogenerate: { directory: 'docs' } }` here.
        { label: 'Changelog', link: '/changelog/' },
      ],
    }),
  ],
})
