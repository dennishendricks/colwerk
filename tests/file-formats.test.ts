import { test } from 'bun:test'
import { extensionsFor, fileFormat, isRemote, scanSql } from '../core/file-formats.ts'
import { assertEquals } from './assert.ts'

test('fileFormat: by extension, also of URLs; compressed binary formats and Excel 97 are not supported', () => {
  const formats: [string, string | undefined][] = [
    ['a.csv', 'csv'],
    ['A.CSV', 'csv'],
    ['a.csv.gz', 'csv'],
    ['a.tsv', 'tsv'],
    ['a.tab', 'tsv'],
    ['x.parquet', 'parquet'],
    ['x.parquet.gz', undefined],
    ['x.ndjson', 'json'],
    ['x.jsonl', 'json'],
    ['x.json', 'json'],
    ['x.xlsx', 'xlsx'],
    ['x.xls', undefined],
    ['notes.txt', undefined],
    ['noextension', undefined],
    ['C:\\data\\x.csv', 'csv'],
    ['https://h/p/data.csv?sig=1', 'csv'],
    ['s3://b/k/a.parquet', 'parquet'],
    ['gs://b/a.json', 'json'],
  ]
  for (const [source, format] of formats) assertEquals(fileFormat(source), format, source)
})

test('scanSql: the table function per format, quoted', () => {
  assertEquals(scanSql(`/d/it's.csv`, 'csv'), `read_csv('/d/it''s.csv')`)
  assertEquals(scanSql('/d/a.tsv', 'tsv'), `read_csv('/d/a.tsv', delim = '\t')`)
  assertEquals(scanSql('/d/a.parquet', 'parquet'), `read_parquet('/d/a.parquet')`)
  assertEquals(scanSql('/d/a.ndjson', 'json'), `read_json('/d/a.ndjson')`)
  assertEquals(scanSql('/d/a.xlsx', 'xlsx'), `read_xlsx('/d/a.xlsx')`)
})

test('isRemote and extensionsFor: httpfs for URLs, excel for workbooks', () => {
  assertEquals(
    ['s3://b/a.csv', 'gs://b/a.csv', 'gcs://b/a.csv', 'http://h/a.csv', 'HTTPS://h/a.csv'].every(isRemote),
    true,
  )
  assertEquals(['/d/a.csv', 'C:\\a.csv', 'file:///a.csv', 'abfss://x/a.csv'].some(isRemote), false)
  assertEquals(extensionsFor('/d/a.csv', 'csv'), [])
  assertEquals(extensionsFor('/d/a.xlsx', 'xlsx'), ['excel'])
  assertEquals(extensionsFor('s3://b/a.parquet', 'parquet'), ['httpfs'])
  assertEquals(extensionsFor('https://h/a.xlsx', 'xlsx'), ['excel', 'httpfs'])
})
