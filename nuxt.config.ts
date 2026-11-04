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

// `pg-pool` requires `pg`, which resolves to pg's ESM wrapper and is then read before its initialization.
const pgCommonJs = {
  name: 'colwerk:pg-commonjs',
  resolveId(
    this: { resolve(id: string, importer?: string, options?: object): Promise<unknown> },
    id: string,
    importer?: string,
    options?: object,
  ) {
    if (id === 'pg') return this.resolve('pg/lib/index.js', importer, { ...options, skipSelf: true })
  },
}

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxtjs/i18n', '@nuxtjs/mcp-toolkit'],
  $production: {
    nitro: {
      // Bundles the server dependencies instead of copying them to `.output/server/node_modules`, so the
      // bundled-packages record covers them too. Not in dev, where Nitro would also bundle its dev tooling.
      noExternals: true,
      // The public files go into the bundle, so the single executable (scripts/package.ts) reads nothing from disk.
      serveStatic: 'inline',
      // Optional dependency of `pg`, only loaded through `pg.native`, which the app does not use.
      virtual: { 'pg-native': 'export default {}' },
      // `require()` of a module with a default and named exports (e.g. `buffer`, unenv's `debug`) has to return
      // the default export, as in Node; Nitro's 'auto' returns the namespace there.
      commonJS: { requireReturnsDefault: 'preferred' },
      rollupConfig: { plugins: [pgCommonJs] },
    },
  },
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
    // Exports the request listener without starting a server: launcher/main.ts starts it on a port of its own.
    preset: 'node-listener',
    rollupConfig: { plugins: [recordBundledPackages] },
    // Runs on Node 26: no need to lower to Nitro's default es2019 (which rejects BigInt literals in core/export.ts).
    esbuild: { options: { target: 'esnext' } },
  },
  vite: {
    plugins: [{ ...recordBundledPackages, apply: 'build' }],
    // Dependencies of lazy components are otherwise only discovered on first use; the re-optimization
    // that follows breaks the pending dynamic import in dev ("Failed to fetch dynamically imported module").
    optimizeDeps: {
      include: [
        '@codemirror/autocomplete',
        '@codemirror/commands',
        '@codemirror/lang-sql',
        '@codemirror/language',
        '@codemirror/state',
        '@codemirror/view',
        '@lezer/highlight',
      ],
    },
  },
  typescript: { strict: true },
  telemetry: false,
  // Formatting is done by `deno fmt`.
  eslint: { config: { stylistic: false } },
  // No routes per language. The system language applies on every start, unless one was chosen in the
  // application menu (app/plugins/locale.ts); the module's cookie would pin the first detected language.
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'de', language: 'de-DE', name: 'Deutsch', file: 'de.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: { useCookie: false, fallbackLocale: 'en' },
    // The locale files are precompiled at build time; the client needs no message compiler.
    bundle: { dropMessageCompiler: true },
  },
  // The app must work offline: bundle used icons into the client instead of fetching them.
  icon: { provider: 'none', clientBundle: { scan: true } },
  // MCP server at /mcp (tools in server/mcp/tools); requires the session token like /api.
  mcp: {
    name: 'colwerk',
    description: 'Database structures and read-only SQL queries for the connections configured in Colwerk.',
    instructions:
      `Call list-connections first; every other tool needs a connectionId from it, and its "dialect" decides the SQL dialect.
Explore with list-schemas, list-tables and describe-table before writing queries.
run-query and sample-rows only read. Use open-query to hand a query to the user in the editor instead of running it.`,
  },
})
