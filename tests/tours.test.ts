// Status of the guided tours stored in tours.json
import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { parseTourStates, withTourStatus } from '../core/tours.ts'

test('tours: keeps only valid states', () => {
  assertEquals(parseTourStates(null), {})
  assertEquals(parseTourStates([1]), {})
  assertEquals(parseTourStates({ a: 'completed', b: 'cancelled', c: 'open', d: 1 }), { a: 'completed', b: 'cancelled' })
})

test('tours: sets a status, a completed tour stays completed when cancelled', () => {
  assertEquals(withTourStatus({}, 'a', 'cancelled'), { a: 'cancelled' })
  assertEquals(withTourStatus({ a: 'cancelled' }, 'a', 'completed'), { a: 'completed' })
  assertEquals(withTourStatus({ a: 'completed' }, 'a', 'cancelled'), { a: 'completed' })
  assertEquals(withTourStatus({ a: 'completed', b: 'cancelled' }, 'a', 'open'), { b: 'cancelled' })
})
