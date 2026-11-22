import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { decodeText } from '../core/text-file.ts'
import { isShowplan, parseShowplan } from '../app/utils/showplan.ts'
import { assertEquals } from './assert.ts'

const actual = readFileSync(new URL('./fixtures/showplan/actual.sqlplan', import.meta.url), 'utf8')

test('reads the statement of an actual plan', () => {
  const statements = parseShowplan(actual)
  assertEquals(statements.length, 1)
  const [s] = statements
  assertEquals(
    s!.text,
    `select o.id from dbo.orders o join dbo.customers c on c.id = o.customer_id where c.country = N'DE' -- "note"`,
  )
  assertEquals([s!.type, s!.cost, s!.actual], ['SELECT', 1, true])
  assertEquals(s!.warnings, ['PlanAffectingConvert: Seek Plan: CONVERT_IMPLICIT(nvarchar(2),[c].[country],0)'])
  assertEquals(s!.missingIndexes.length, 1)
  assertEquals(s!.missingIndexes[0]!.impact, 87.5)
  assertEquals(
    s!.missingIndexes[0]!.create,
    'create nonclustered index [ix_customers_country] on [dbo].[customers] ([country]) include ([id])',
  )
})

test('reads the operator tree', () => {
  const root = parseShowplan(actual)[0]!.root!
  assertEquals(
    [root.physicalOp, root.logicalOp, root.actualRows, root.cost, root.costShare],
    ['Hash Match', 'Inner Join', 100, 0.25, 0.25],
  )
  assertEquals(root.warnings, ['SpillToTempDb (level 1)'])
  assertEquals(
    root.children.map((c) => [c.nodeId, c.object, c.actualRows]),
    [
      [1, 'dbo.customers (pk_customers)', 5],
      [2, 'dbo.orders', 1000],
    ],
  )
})

test('reads an estimated plan', () => {
  const xml = `<ShowPlanXML xmlns="x"><Statements><StmtSimple StatementText=" select 1 " StatementType="SELECT">
    <QueryPlan><RelOp NodeId="0" PhysicalOp="Constant Scan" LogicalOp="Constant Scan" EstimateRows="1" EstimatedTotalSubtreeCost="0.5"/></QueryPlan>
    </StmtSimple></Statements></ShowPlanXML>`
  const [s] = parseShowplan(xml)
  assertEquals([s!.text, s!.cost, s!.actual, s!.root!.actualRows], ['select 1', 0.5, false, undefined])
})

test('rejects broken and foreign XML', () => {
  expect(() => parseShowplan('<ShowPlanXML><a></b></ShowPlanXML>')).toThrow('Invalid XML')
  expect(() => parseShowplan('<other/>')).toThrow('Not a SQL Server execution plan')
  assertEquals([isShowplan(actual), isShowplan('<other/>')], [true, false])
})

test('decodes text by its byte order mark', () => {
  const text = 'select 1 -- äö€'
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()])
  const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])
  for (const bytes of [utf16le, utf16be, utf8, Buffer.from(text)]) assertEquals(decodeText(new Uint8Array(bytes)), text)
})
