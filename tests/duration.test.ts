import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { formatClock, formatDuration } from '../app/utils/duration.ts'

test('formats durations in the largest fitting unit', () => {
  assertEquals(formatDuration(0.4), '0 ms')
  assertEquals(formatDuration(182), '182 ms')
  assertEquals(formatDuration(2400), '2.4 s')
  assertEquals(formatDuration(65_000), '1 min 05 s')
  assertEquals(formatDuration(3_720_000), '1 h 02 min')
})

test('rounding never shows a value of the next unit', () => {
  assertEquals(formatDuration(999.6), '1.0 s')
  assertEquals(formatDuration(59_960), '1 min 00 s')
  assertEquals(formatDuration(3_599_700), '1 h 00 min')
})

test('formats the time as hh:mm:ss', () => {
  assertEquals(formatClock(new Date(2026, 0, 2, 3, 4, 5).getTime()), '03:04:05')
})
