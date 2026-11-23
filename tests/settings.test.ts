// Validation of the settings stored in settings.json
import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { defaultSettings, defaultSqlFormatOptions, parseSettings } from '../core/settings.ts'

test('settings: keeps valid values and replaces missing or invalid ones by the default', () => {
  assertEquals(parseSettings(null), defaultSettings)
  assertEquals(parseSettings({ csv: { delimiter: '\t', quote: "'", escape: 'nope', encoding: 'latin9' }, other: 1 }), {
    csv: { delimiter: '\t', quote: "'", escape: 'double', encoding: 'utf-8-bom' },
    sqlFormat: defaultSqlFormatOptions,
  })
  assertEquals(
    parseSettings({ sqlFormat: { keywordCase: 'upper', indent: 'tab', expressionWidth: 5, bangNotEqual: 'no' } })
      .sqlFormat,
    { ...defaultSqlFormatOptions, keywordCase: 'upper', indent: 'tab' },
  )
})
