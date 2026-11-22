// robots.txt pointing to the sitemap that Starlight generates.
import type { APIRoute } from 'astro'

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *
Allow: /

Sitemap: ${new URL('/sitemap-index.xml', site)}
`)
