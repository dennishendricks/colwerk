import { assertEquals } from 'jsr:@std/assert@1'
import { addToHistory, HISTORY_LIMIT, type HistoryEntry } from '../core/history.ts'

const entry = (id: string, sql: string, connectionId = 'c1'): HistoryEntry => ({ id, connectionId, sql, executedAt: '2026-01-01T00:00:00.000Z' })

Deno.test('history: newest first, capped', () => {
  let history: HistoryEntry[] = []
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) history = addToHistory(history, entry(String(i), `select ${i}`))
  assertEquals(history.length, HISTORY_LIMIT)
  assertEquals(history[0]!.id, String(HISTORY_LIMIT + 4))
  assertEquals(history.at(-1)!.id, '5')
})

Deno.test('history: a repeat of the newest query replaces it', () => {
  let history = [entry('1', 'select 1'), entry('2', 'select 2')]
  history = addToHistory(history, entry('3', 'select 1'))
  assertEquals(history.map(e => e.id), ['3', '2'])
  // Same SQL on another connection, or not the newest entry: kept.
  history = addToHistory(history, entry('4', 'select 1', 'c2'))
  history = addToHistory(history, entry('5', 'select 2'))
  assertEquals(history.map(e => e.id), ['5', '4', '3', '2'])
})
