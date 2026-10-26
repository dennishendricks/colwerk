import { basename, resolve } from 'node:path'
import process from 'node:process'

// Command for MCP clients that start the stdio bridge: the running binary itself (inside the .app on
// macOS), or Deno with the launcher in development.
export default defineEventHandler(() => {
  const command = process.execPath
  const args = basename(command).startsWith('deno') ? ['run', '-A', resolve('launcher/main.ts'), 'mcp'] : ['mcp']
  return { command, args }
})
