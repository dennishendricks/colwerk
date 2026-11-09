import { createHash } from 'node:crypto'

// Content Security Policy of the app page; the desktop window loads it from this server too, so the CSP of
// src-tauri/tauri.conf.json only covers the splash. Inline scripts (import map, color mode, runtime config) are
// allowed by their hashes; in dev by 'unsafe-inline' instead, for the scripts of Nuxt's error overlay. Styles
// need 'unsafe-inline': Nuxt UI, the icons and Vite (dev) add <style> elements at runtime. The icons and
// CodeMirror use data: SVGs. connect-src: Tauri's IPC (ipc: on macOS/Linux, http://ipc.localhost on Windows)
// and the GitHub release check (app/utils/update.ts).
const POLICY = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' ipc: http://ipc.localhost https://api.github.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ')

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response) => {
    if (typeof response.body !== 'string') return
    const inline = import.meta.dev
      ? ["'unsafe-inline'"]
      : [...response.body.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          ([, code]) => `'sha256-${createHash('sha256').update(code!).digest('base64')}'`,
        )
    response.headers = {
      ...response.headers,
      'content-security-policy': `${POLICY}; script-src 'self' ${inline.join(' ')}`,
    }
  })
})
