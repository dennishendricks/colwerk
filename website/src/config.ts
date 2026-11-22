// Links to the Colwerk repository and its releases, and the documentation's sidebar.
export const repo = 'https://github.com/dennishendricks/colwerk'
export const releases = `${repo}/releases/latest`

// Pages live in src/content/docs/docs/<group>/ and are ordered by `sidebar.order` in their frontmatter. Shared by
// astro.config.ts and the changelog pages, which add their release list below it.
export const docsSidebar = [
  { label: 'Getting started', items: [{ autogenerate: { directory: 'docs/start' } }] },
  { label: 'Connections', items: [{ autogenerate: { directory: 'docs/connections' } }] },
  { label: 'Writing SQL', items: [{ autogenerate: { directory: 'docs/editor' } }] },
  { label: 'Working with data', items: [{ autogenerate: { directory: 'docs/data' } }] },
  { label: 'AI assistants (MCP)', items: [{ autogenerate: { directory: 'docs/mcp' } }] },
  { label: 'Reference', items: [{ autogenerate: { directory: 'docs/reference' } }] },
]
