import { expect, test } from 'bun:test'
import { modalOrigin } from '../app/utils/motion.ts'

test('modal origin: offset of a recent pointer press from the viewport center', () => {
  expect(modalOrigin({ x: 100, y: 50, at: 1000 }, 1200, 800, 600)).toEqual({ x: -300, y: -250 })
})

test('modal origin: none without a pointer press or after a stale one (keyboard, no input)', () => {
  expect(modalOrigin(undefined, 1000, 800, 600)).toBeUndefined()
  expect(modalOrigin({ x: 100, y: 50, at: 0 }, 1500, 800, 600)).toBeUndefined()
})
