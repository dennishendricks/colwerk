import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import pkg from './package.json' with { type: 'json' }

// Records the npm packages that end up in the client and server bundles in `.nuxt/bundled-packages.json`,
// for the third-party licenses of the packaged app (scripts/licenses.ts).
const bundledPackages = new Set<string>()
const recordBundledPackages = {
  name: 'colwerk:bundled-packages',
  buildEnd(this: { getModuleIds(): IterableIterator<string> }) {
    for (const id of this.getModuleIds()) {
      // Package directory below the last `node_modules`; dot directories are caches (e.g. `.cache`), no packages.
      const dir = id.replaceAll('\\', '/').match(/^\0?(.*\/node_modules\/(?:@[^/]+\/)?[^./][^/]*)\//)?.[1]
      if (dir) bundledPackages.add(dir)
    }
    writeFileSync('.nuxt/bundled-packages.json', JSON.stringify([...bundledPackages]))
  },
}

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxtjs/mcp-toolkit'],
  ssr: false,
  devtools: { enabled: false },
  app: { head: { title: 'Colwerk', link: [{ rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }] } },
  css: ['~/assets/css/main.css'],
  ui: { fonts: false },
  // For the update check (app/utils/update.ts): releases are looked up as `owner/repo` on GitHub.
  runtimeConfig: {
    public: { version: pkg.version, repository: pkg.repository.url.replace('https://github.com/', '') },
  },
  alias: {
    '#core': fileURLToPath(new URL('./core/index.ts', import.meta.url)),
  },
  compatibilityDate: '2026-10-01',
  nitro: {
    preset: 'deno-server',
    rollupConfig: { plugins: [recordBundledPackages] },
    // Runs on Deno: no need to lower to Nitro's default es2019 (which rejects BigInt literals in core/export.ts).
    esbuild: { options: { target: 'esnext' } },
  },
  vite: { plugins: [{ ...recordBundledPackages, apply: 'build' }] },
  typescript: { strict: true },
  telemetry: false,
  eslint: { config: { stylistic: { braceStyle: '1tbs' } } },
  // The app must work offline: bundle used icons into the client instead of fetching them.
  icon: { provider: 'none', clientBundle: { scan: true } },
  // MCP server at /mcp (tools in server/mcp/tools); requires the session token like /api.
  mcp: {
    name: 'colwerk',
    description: 'Database structures and read-only SQL queries for the connections configured in Colwerk.',
    instructions: `Call list-connections first; every other tool needs a connectionId from it, and its "dialect" decides the SQL dialect.
Explore with list-schemas, list-tables and describe-table before writing queries.
run-query and sample-rows only read. Use open-query to hand a query to the user in the editor instead of running it.`,
  },
})
