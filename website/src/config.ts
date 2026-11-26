// Links to the Colwerk repository and its releases, the pages per engine and topic, and the documentation's sidebar.
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

// Pages per engine and topic in src/content/docs/, outside the docs sidebar: linked from the footer and llms.txt
export const guides = [
  { label: 'PostgreSQL GUI', href: '/postgresql-gui/' },
  { label: 'MySQL GUI', href: '/mysql-gui/' },
  { label: 'SQL Server on Mac', href: '/sql-server-mac/' },
  { label: 'SQLite viewer', href: '/sqlite-viewer/' },
  { label: 'DuckDB GUI', href: '/duckdb-gui/' },
  { label: 'Parquet viewer', href: '/parquet-viewer/' },
  { label: 'DBeaver alternative', href: '/dbeaver-alternative/' },
]
