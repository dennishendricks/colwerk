import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxtjs/mcp-toolkit'],
  ssr: false,
  devtools: { enabled: false },
  app: { head: { title: 'Colwerk', link: [{ rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }] } },
  css: ['~/assets/css/main.css'],
  ui: { fonts: false },
  alias: {
    '#core': fileURLToPath(new URL('./core/index.ts', import.meta.url)),
  },
  compatibilityDate: '2026-10-01',
  nitro: {
    preset: 'deno-server',
    // Native addon: keep it out of the bundle so its `.node` file and shared library stay next to each other.
    externals: { external: ['@duckdb/node-api'] },
  },
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
