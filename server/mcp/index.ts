import { withoutLogin } from '#core'

// MCP clients never start a Microsoft Entra browser login; they only get connections whose login is still valid.
// The stdio bridge names the client (launcher/mcp-bridge.ts) for the audit log.
export default defineMcpHandler({
  middleware: (event, next) =>
    mcpRequest(getRequestHeader(event, 'x-colwerk-mcp-client')?.slice(0, 100) || 'unknown', () => withoutLogin(next)),
})
