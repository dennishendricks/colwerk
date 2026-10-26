import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint'],
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
})
