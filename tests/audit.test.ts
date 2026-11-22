import { test } from 'bun:test'
import { AUDIT_LIMIT, type AuditEntry, parseAuditLog, pruneAudit } from '../core/audit.ts'
import { assertEquals } from './assert.ts'

const now = Date.parse('2026-06-30T12:00:00Z')
const entry = (id: string, at: string): AuditEntry => ({
  id,
  at,
  client: 'test',
  tool: 'run-query',
  durationMs: 1,
  status: 'ok',
})

test('audit: unreadable lines are skipped and the order is kept', () => {
  const a = entry('a', '2026-06-01T00:00:00Z')
  const b = entry('b', '2026-06-02T00:00:00Z')
  const text = [JSON.stringify(a), '', 'not json', '{"id":"x"}', JSON.stringify(b), '{"id":"c","at":"2026-06-03'].join(
    '\n',
  )
  assertEquals(parseAuditLog(text), [a, b])
})

test('audit: pruning respects the retention and keeps the newest entries within the limit', () => {
  const old = entry('old', '2026-06-01T11:59:59Z')
  const recent = entry('recent', '2026-06-02T12:00:00Z')
  assertEquals(pruneAudit([old, recent], 28, now), [recent])
  assertEquals(pruneAudit([old, recent], 30, now), [old, recent])
  const many = Array.from({ length: AUDIT_LIMIT + 2 }, (_, i) => entry(String(i), '2026-06-29T00:00:00Z'))
  const kept = pruneAudit(many, 7, now)
  assertEquals([kept.length, kept[0]!.id, kept.at(-1)!.id], [AUDIT_LIMIT, '2', String(AUDIT_LIMIT + 1)])
})
