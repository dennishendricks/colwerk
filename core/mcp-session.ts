import { type ConnectionConfig, mcpLoginAuths } from './types.ts'

// MCP clients may log in differently and, on DuckDB, run sandboxed; their sessions then have a workbench id of their own.
type McpSettings = Pick<ConnectionConfig, 'dialect' | 'auth' | 'mcpLogin' | 'mcpExternalAccess'>

const usesMcpLogin = (c: McpSettings) => !!c.mcpLogin && mcpLoginAuths.includes(c.auth ?? 'password')
const sandboxed = (c: McpSettings) => c.dialect === 'duckdb' && !c.mcpExternalAccess

/** Whether MCP sessions of the connection differ from the editor's (`mcp:<id>` in the workbench). */
export const ownMcpSessions = (c: McpSettings) => usesMcpLogin(c) || sandboxed(c)

/** The configuration MCP sessions connect with. */
export function mcpConfig(c: ConnectionConfig): ConnectionConfig {
  return {
    ...c,
    // Without the reference, the workbench would resolve the main login's secret into `password` (core/secrets.ts).
    ...(usesMcpLogin(c) && { user: c.mcpUser, password: c.mcpPassword, passwordRef: undefined }),
    ...(sandboxed(c) && { mcpSandbox: true }),
  }
}
