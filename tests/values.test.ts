import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { markdownField, markdownRow } from '../core/values.ts'

test('escapes pipes, backslashes and line breaks in markdown cells', () => {
  assertEquals(markdownField('a|b\\c'), 'a\\|b\\\\c')
  assertEquals(markdownField('x\r\ny\nz'), 'x<br>y<br>z')
  assertEquals(markdownField(null), '')
  assertEquals(markdownField({ a: 1 }), '{"a":1}')
})

test('builds a markdown table with header, separator and row', () => {
  assertEquals(markdownRow(['id', 'n|m'], [1, null]), '| id | n\\|m |\n| --- | --- |\n| 1 |  |')
})
