// XLSX: one sheet with inline strings (no shared-strings table, so a single pass is enough), written through a
// streaming deflate into a minimal ZIP container. No ZIP64: results beyond the limits of the format fail.
import { cellText } from '../values.ts'
import { AppError, type CellValue } from '../types.ts'
import { encoder, type Exporter, needColumns, type Write } from './common.ts'
import { parseTimestamp } from './timestamp.ts'
import { ZipWriter } from './zip.ts'

const xlsxLimit = () =>
  new AppError('xlsxLimit', 'The result exceeds the limits of an Excel sheet (1,048,576 rows, 16,384 columns, 4 GB).')

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

// Styles of `xlsxCell`: 1 header (bold), 2 date, 3 date-time, 4 time.
const XLSX_PARTS: [string, string][] = [
  [
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${OFFICE_TYPE}.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${OFFICE_TYPE}.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="${OFFICE_TYPE}.styles+xml"/></Types>`,
  ],
  [
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ],
  [
    'xl/workbook.xml',
    `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Result" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  ],
  [
    'xl/_rels/workbook.xml.rels',
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL}">` +
      `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  ],
  [
    'xl/styles.xml',
    `${XML_HEAD}<styleSheet xmlns="${NS}">` +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>' +
      '<numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/><numFmt numFmtId="166" formatCode="hh:mm:ss"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  ],
]

const XLSX_SHEET_START =
  `${XML_HEAD}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0">` +
  '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'

type XlsxKind = 'number' | 'date' | 'time' | 'datetime' | 'text'

// Same numeric types as `NUMERIC_TYPE` in sql-literals.ts.
const NUMERIC_TYPE =
  /^(?:u?int\d*|tinyint|smallint|mediumint|bigint|integer|hugeint|uhugeint|ubigint|uinteger|usmallint|utinyint|decimal|numeric|dec|float\d*|double|real|money|smallmoney)\b/
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
const TIME_OF_DAY = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/
const EXCEL_EPOCH = 25569 // 1970-01-01 as Excel serial
const EXCEL_LEAP_BUG = 61 // 1900-03-01: earlier dates are off by one in Excel

function xlsxKind(type: string): XlsxKind {
  const t = type.toLowerCase().replace(/^(?:(?:nullable|lowcardinality)\()*/, '')
  if (NUMERIC_TYPE.test(t)) return 'number'
  if (/^(date|newdate|date32)$/.test(t)) return 'date'
  if (/^time( without time zone)?(\(\d\))?$/.test(t)) return 'time'
  if (/timestamp|datetime|smalldatetime/.test(t)) return 'datetime'
  return 'text'
}

/** Column letters: A…Z, AA…, up to XFD. */
function columnName(i: number): string {
  let name = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

// Characters invalid in XML 1.0.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

const textCell = (ref: string, text: string, style = '') =>
  `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text
    // Excel holds at most 32,767 characters per cell.
    .replace(XML_INVALID, '')
    .slice(0, 32767)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')}</t></is></c>`

/** One cell, NULL excluded; what does not fit its column's kind stays text. */
function xlsxCell(value: CellValue, kind: XlsxKind, ref: string): string {
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  if (typeof value === 'string') {
    // Beyond 15 significant digits a number would lose precision in Excel.
    if (kind === 'number' && NUMBER.test(value) && value.split(/e/i)[0]!.replace(/^[+-]?[0.]*|\./g, '').length <= 15) {
      return `<c r="${ref}"><v>${value}</v></c>`
    }
    if (kind === 'time') {
      const m = value.match(TIME_OF_DAY)
      if (m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3]) < 60) {
        const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4] ?? 0}`)
        return `<c r="${ref}" s="4"><v>${seconds / 86400}</v></c>`
      }
    } else if (kind === 'date' || kind === 'datetime') {
      const t = parseTimestamp(value)
      const serial = t ? Number(t.micros) / 86_400_000_000 + EXCEL_EPOCH : 0
      if (t && serial >= EXCEL_LEAP_BUG) return `<c r="${ref}" s="${kind === 'date' ? 2 : 3}"><v>${serial}</v></c>`
    }
  }
  return textCell(ref, cellText(value))
}

export function xlsxExporter(write: Write): Exporter {
  const zip = new ZipWriter(write, xlsxLimit)
  let kinds: XlsxKind[] | undefined
  let names: string[] = []
  let sheet: ReturnType<ZipWriter['entry']> | undefined
  let row = 1
  const start = async () => {
    if (sheet) return sheet
    for (const [name, xml] of XLSX_PARTS) {
      const part = zip.entry(name)
      await part.write(encoder.encode(xml))
      await part.close()
    }
    sheet = zip.entry('xl/worksheets/sheet1.xml')
    const header = names.map((n, i) => textCell(`${columnName(i)}1`, n, ' s="1"')).join('')
    await sheet.write(encoder.encode(`${XLSX_SHEET_START}<row r="1">${header}</row>`))
    return sheet
  }
  return {
    columns: (columns) => {
      if (columns.length > 16384) throw xlsxLimit()
      names = columns.map((c) => c.name)
      kinds = columns.map((c) => xlsxKind(c.type))
    },
    rows: async (rows) => {
      const entry = await start()
      if (row - 1 + rows.length > 1_048_575) throw xlsxLimit()
      const xml = rows.map((cells) => {
        row++
        const cs = cells.map((v, i) => (v === null ? '' : xlsxCell(v, kinds![i] ?? 'text', `${columnName(i)}${row}`)))
        return `<row r="${row}">${cs.join('')}</row>`
      })
      await entry.write(encoder.encode(xml.join('')))
    },
    finish: async () => {
      if (!kinds) throw needColumns()
      const entry = await start()
      await entry.write(encoder.encode('</sheetData></worksheet>'))
      await entry.close()
      await zip.finish()
    },
    dispose: async () => {},
  }
}
