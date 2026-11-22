import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import type { ServerSession } from '../core/types.ts'
import { blockers, blockingChains, type BlockingNode } from '../app/utils/blocking.ts'

const session = (id: string, blockedBy: string[] = []): ServerSession => ({
  id,
  user: null,
  database: null,
  client: null,
  application: null,
  state: null,
  active: true,
  seconds: null,
  query: null,
  wait: null,
  blockedBy,
})

const shape = (nodes: BlockingNode[]): unknown[] => nodes.map((n) => [n.session.id, shape(n.blocked)])

test('a chain has its head blocker at the root', () => {
  const sessions = [session('3', ['2']), session('2', ['1']), session('1'), session('9')]
  assertEquals(shape(blockingChains(sessions)), [['1', [['2', [['3', []]]]]]])
  assertEquals(blockers(sessions), new Set(['1', '2']))
})

test('every head blocker is a chain', () => {
  const sessions = [session('2', ['1']), session('1'), session('12', ['11']), session('11')]
  assertEquals(shape(blockingChains(sessions)), [
    ['1', [['2', []]]],
    ['11', [['12', []]]],
  ])
})

test('the smallest id heads a cycle', () => {
  const sessions = [session('8', ['7']), session('7', ['8'])]
  assertEquals(shape(blockingChains(sessions)), [['7', [['8', []]]]])
})

test('a blocker missing from the list becomes a placeholder head', () => {
  const [chain] = blockingChains([session('2', ['5'])])
  assertEquals(chain!.session.id, '5')
  assertEquals(chain!.session.active, true)
  assertEquals(shape(chain!.blocked), [['2', []]])
})

test('sessions without relations make no chains', () => {
  assertEquals(blockingChains([session('1'), session('2')]), [])
})
