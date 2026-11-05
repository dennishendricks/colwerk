import { basename, resolve } from 'node:path'
import process from 'node:process'

// Command for MCP clients that start the stdio bridge: the running server binary itself (the sidecar inside the
// desktop app, e.g. Colwerk.app/Contents/MacOS/colwerk-server), or Bun with the launcher in development.
export default defineEventHandler(() => {
  const command = process.execPath
  const args = basename(command).startsWith('bun') ? [resolve('launcher/main.ts'), 'mcp'] : ['mcp']
  return { command, args }
})
