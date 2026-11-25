// Website and documentation of Colwerk (Astro Starlight). Deployed only from the commit of the latest published
// release (.github/workflows/website.yml), so the docs never describe unreleased changes.
import { defineConfig, envField } from 'astro/config'
import { satteri } from '@astrojs/markdown-satteri'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'
import { docsSidebar, repo } from './src/config'
import { kbdPlugin } from './src/keys'

const site = 'https://colwerk.app'

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
    starlight({
      title: 'Colwerk',
      titleDelimiter: '·',
      description:
        'Free, open-source SQL editor and database client for macOS, Windows and Linux. PostgreSQL, MySQL, SQLite, SQL Server, ClickHouse, DuckDB and lakehouses.',
      logo: { src: './src/assets/favicon.svg' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      customCss: ['./src/styles/theme.css'],
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
      plugins: [starlightLinksValidator({ exclude: ['/', '/changelog/', '/changelog/**'] })],
      sidebar: [...docsSidebar, { label: 'Changelog', link: '/changelog/' }],
    }),
  ],
})
