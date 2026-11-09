// tedious' value parser, patched (patches/tedious@*.patch) to decode DECIMAL/NUMERIC/MONEY exactly as strings.
// Runs without a server: the TDS bytes of a value are built by hand.
import { test } from 'bun:test'
import { readValue } from 'tedious/lib/value-parser.js'
import { assertEquals } from './assert.ts'

const read = (type: string, bytes: number[], scale = 0) =>
  readValue(Buffer.from(bytes), 0, { type: { name: type }, scale } as never, {} as never).value

/** `value` as `length` little-endian bytes (two's complement for negatives). */
function le(value: bigint, length: number): number[] {
  const v = BigInt.asUintN(length * 8, value)
  return Array.from({ length }, (_, i) => Number((v >> BigInt(i * 8)) & 0xffn))
}

/** DECIMAL/NUMERIC: length, sign byte (1 = positive), magnitude in 4, 8, 12 or 16 bytes. */
const decimal = (unscaled: bigint, size: number) => [
  size + 1,
  unscaled < 0n ? 0 : 1,
  ...le(unscaled < 0n ? -unscaled : unscaled, size),
]

test('decimal and numeric keep every digit and the scale', () => {
  assertEquals(read('DecimalN', decimal(12345n, 4), 2), '123.45')
  assertEquals(read('NumericN', decimal(-5n, 4), 3), '-0.005')
  assertEquals(read('DecimalN', decimal(0n, 4), 2), '0.00')
  assertEquals(read('DecimalN', decimal(9007199254740993n, 8), 0), '9007199254740993')
  assertEquals(read('DecimalN', decimal(12345678901234567890123n, 12), 3), '12345678901234567890.123')
  const max = 10n ** 38n - 1n
  assertEquals(read('DecimalN', decimal(max, 16), 0), max.toString())
  assertEquals(read('DecimalN', decimal(-max, 16), 10), '-9999999999999999999999999999.9999999999')
  assertEquals(read('DecimalN', decimal(1n, 16), 38), `0.${'0'.repeat(37)}1`)
  assertEquals(read('DecimalN', [0]), null)
})

test('money and smallmoney keep every digit, with four decimals', () => {
  // MONEY: high 4 bytes, then low 4 bytes (MoneyN with a length byte first).
  const money = (v: bigint) => [8, ...le(v >> 32n, 4), ...le(v, 4)]
  assertEquals(read('Money', money(125000n).slice(1)), '12.5000')
  assertEquals(read('MoneyN', money(2n ** 63n - 1n)), '922337203685477.5807')
  assertEquals(read('MoneyN', money(-(2n ** 63n))), '-922337203685477.5808')
  assertEquals(read('MoneyN', money(-1n)), '-0.0001')
  assertEquals(read('MoneyN', [4, ...le(-(2n ** 31n), 4)]), '-214748.3648')
  assertEquals(read('SmallMoney', le(2n ** 31n - 1n, 4)), '214748.3647')
  assertEquals(read('MoneyN', [0]), null)
})
