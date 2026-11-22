import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { mcpConfig, ownMcpSessions } from '../core/mcp-session.ts'
import type { ConnectionConfig } from '../core/types.ts'

const pg: ConnectionConfig = { id: 'c1', name: 'c', dialect: 'postgres', user: 'main', password: 'main-secret' }
const duck: ConnectionConfig = { id: 'd1', name: 'd', dialect: 'duckdb', file: 'x.duckdb' }
const mcp = { mcpLogin: true, mcpUser: 'reader', mcpPassword: 'reader-secret' }

test('mcp session: only an MCP login for a supported auth gives MCP its own sessions', () => {
  assertEquals(ownMcpSessions(pg), false)
  assertEquals(ownMcpSessions({ ...pg, ...mcp }), true)
  assertEquals(ownMcpSessions({ ...pg, ...mcp, auth: 'entra-default' }), false)
  assertEquals(ownMcpSessions(duck), true)
  assertEquals(ownMcpSessions({ ...duck, mcpExternalAccess: true }), false)
  assertEquals(ownMcpSessions({ ...duck, dialect: 'sqlite' }), false)
  assertEquals(ownMcpSessions({ ...duck, dialect: 'delta' }), false)
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

test('mcp session: only DuckDB without the opt-in is sandboxed', () => {
  assertEquals(mcpConfig(duck).mcpSandbox, true)
  assertEquals(mcpConfig({ ...duck, mcpExternalAccess: true }).mcpSandbox, undefined)
  assertEquals(mcpConfig(pg).mcpSandbox, undefined)
})
