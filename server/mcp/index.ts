import { withoutLogin } from '#core'

// MCP clients never start a Microsoft Entra browser login; they only get connections whose login is still valid.
export default defineMcpHandler({
  middleware: (_event, next) => withoutLogin(next),
})
