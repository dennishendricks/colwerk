import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { mcpConfig, ownMcpSessions } from '../core/mcp-session.ts'
import type { ConnectionConfig } from '../core/types.ts'

const pg: ConnectionConfig = { id: 'c1', name: 'c', dialect: 'postgres', user: 'main', password: 'main-secret' }
const mcp = { mcpLogin: true, mcpUser: 'reader', mcpPassword: 'reader-secret' }

test('mcp session: only an MCP login for a supported auth gives MCP its own sessions', () => {
  assertEquals(ownMcpSessions(pg), false)
  assertEquals(ownMcpSessions({ ...pg, ...mcp }), true)
  assertEquals(ownMcpSessions({ ...pg, ...mcp, auth: 'entra-default' }), false)
})

test('mcp session: the MCP login replaces user and password and never falls back to the main one', () => {
  const config = mcpConfig({ ...pg, ...mcp })
  assertEquals([config.user, config.password], ['reader', 'reader-secret'])
  const empty = mcpConfig({ ...pg, mcpLogin: true, mcpUser: 'reader' })
  assertEquals([empty.user, empty.password], ['reader', undefined])
  assertEquals(mcpConfig(pg), pg)
  const entra = mcpConfig({ ...pg, ...mcp, auth: 'entra-default' })
  assertEquals([entra.user, entra.password], ['main', 'main-secret'])
})
