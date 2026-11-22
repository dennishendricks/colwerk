import { type ConnectionConfig, mcpLoginAuths } from './types.ts'

// MCP clients may log in differently; their sessions then have a workbench id of their own.
type McpSettings = Pick<ConnectionConfig, 'auth' | 'mcpLogin'>

const usesMcpLogin = (c: McpSettings) => !!c.mcpLogin && mcpLoginAuths.includes(c.auth ?? 'password')

/** Whether MCP sessions of the connection differ from the editor's (`mcp:<id>` in the workbench). */
export const ownMcpSessions = (c: McpSettings) => usesMcpLogin(c)

/** The configuration MCP sessions connect with. */
export function mcpConfig(c: ConnectionConfig): ConnectionConfig {
  return usesMcpLogin(c) ? { ...c, user: c.mcpUser, password: c.mcpPassword } : c
}
