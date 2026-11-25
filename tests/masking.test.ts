// PII masking of result columns (core/masking.ts): rules, column lists, methods and the reference check of MCP queries
import { test } from 'bun:test'
import { assert, assertEquals } from './assert.ts'
import {
  columnCandidates,
  createMasker,
  defaultMaskRules,
  type MaskOptions,
  maskingSink,
  maskMethodOf,
  maskViolation,
  normalizeName,
  parseMaskRules,
} from '../core/masking.ts'
import type { CellValue, ResultColumn } from '../core/types.ts'

const options = (extra: Partial<MaskOptions> = {}): MaskOptions => ({
  rules: defaultMaskRules,
  hash: (text) => `h(${text})`,
  ...extra,
})

test('masking: built-in patterns match common PII column names and leave others alone', () => {
  const method = (name: string) => maskMethodOf(name, options())
  assertEquals(method('email'), 'partial')
  assertEquals(method('customerEmail'), 'partial')
  assertEquals(method('E_MAIL_ADRESSE'), 'partial')
  assertEquals(method('phone_number'), 'partial')
  assertEquals(method('tel'), 'partial')
  assertEquals(method('hotel'), undefined)
  for (const name of ['mobil1', 'mobil_1', 'Mobil2', 'fax1', 'fax_1', 'tel_2_privat', 'phone1']) {
    assertEquals(method(name), 'partial', name)
  }
  assertEquals(method('telemetry'), undefined)
  assertEquals(method('firstName'), 'redact')
  assertEquals(method('nachname'), 'redact')
  assertEquals(method('street'), 'redact')
  assertEquals(method('plz'), 'redact')
  assertEquals(method('zip_code'), 'redact')
  assertEquals(method('date_of_birth'), 'redact')
  assertEquals(method('iban'), 'partial')
  for (const name of ['kredit', 'kreditkarte', 'kreditor_nr', 'credit_limit', 'creditCardNumber', 'customer_credit']) {
    assertEquals(method(name), 'partial', name)
  }
  assertEquals(method('accredited'), undefined)
  assertEquals(method('ip_address'), 'hash')
  assertEquals(method('password_hash'), 'null')
  assertEquals(method('name'), undefined)
  assertEquals(method('product_name'), undefined)
  assertEquals(method('id'), undefined)
  assertEquals(method('description'), undefined)
  assertEquals(normalizeName('firstName'), 'first_name')
})

test('masking: German and abbreviated column names', () => {
  const rules = defaultMaskRules.map((r) => ({ ...r, enabled: true }))
  const rule = (name: string) => rules.find((r) => maskMethodOf(name, { rules: [r] }))?.id
  const expected: Record<string, string> = {
    Geburtsdatum: 'birthDate',
    geb_dat: 'birthDate',
    gebtag: 'birthDate',
    geb: 'birthDate',
    bday: 'birthDate',
    'E-Mail': 'email',
    mail: 'email',
    telnr: 'phone',
    mobilnummer: 'phone',
    fon: 'phone',
    familienname: 'personName',
    kontoinhaber: 'personName',
    adresszusatz: 'address',
    hausnr: 'address',
    postleitzahl: 'postalCode',
    blz: 'bankAccount',
    cvv: 'bankAccount',
    steuernummer: 'nationalId',
    versichertennummer: 'nationalId',
    kfz_kennzeichen: 'nationalId',
    geschlecht: 'sensitive',
    konfession: 'sensitive',
    staatsangehörigkeit: 'sensitive',
    kennwort: 'credentials',
    pin: 'credentials',
    mac_address: 'ip',
    latitude: 'location',
  }
  for (const [name, id] of Object.entries(expected)) assertEquals(rule(name), id, name)
  for (const name of ['gebuehr', 'mail_sent', 'kennzeichen', 'spin', 'structure', 'lateral', 'location_id', 'city']) {
    assertEquals(rule(name), undefined, name)
  }
  // Off by default.
  assertEquals(maskMethodOf('latitude', { rules: defaultMaskRules }), undefined)
})

test('masking: column lists override the patterns; qualified exemptions need a known source', () => {
  assertEquals(maskMethodOf('notes', options({ columns: ['notes'] })), 'redact')
  assertEquals(maskMethodOf('notes', options({ columns: ['crm.customers.notes'] })), 'redact')
  assertEquals(maskMethodOf('email', options({ exempt: ['email'] })), undefined)
  assertEquals(maskMethodOf('email', options({ exempt: ['support.email'] })), 'partial')
  assertEquals(
    maskMethodOf('email', options({ exempt: ['support.email'], source: { schema: 'public', table: 'support' } })),
    undefined,
  )
  assertEquals(
    maskMethodOf(
      'notes',
      options({ columns: ['crm.customers.notes'], source: { schema: 'public', table: 'customers' } }),
    ),
    undefined,
  )
})

test('masking: parseMaskRules keeps built-in patterns, stored choices and valid custom rules', () => {
  const rules = parseMaskRules([
    { id: 'email', pattern: 'x', method: 'hash', enabled: false },
    { id: 'c1', pattern: 'kunden_?nr', method: 'hash', enabled: true },
    { id: 'c2', pattern: '(', method: 'redact', enabled: true },
    { id: 'c3', pattern: 'x', method: 'scramble', enabled: true },
  ])
  const email = rules.find((r) => r.id === 'email')!
  assertEquals([email.pattern, email.method, email.enabled], ['e_?mail|^mail$', 'hash', false])
  assertEquals(rules.length, defaultMaskRules.length + 1)
  assertEquals(rules.at(-1), { id: 'c1', pattern: 'kunden_?nr', method: 'hash', enabled: true })
  // Custom rules are checked before built-in ones.
  assertEquals(maskMethodOf('Kundennr', { rules }), 'hash')
  assertEquals(parseMaskRules('nope'), defaultMaskRules)
})

test('masking: methods, null values, nested objects and whole rows', () => {
  const columns: ResultColumn[] = [
    { name: 'id', type: 'int4' },
    { name: 'email', type: 'text' },
    { name: 'last_name', type: 'text' },
    { name: 'iban', type: 'text' },
    { name: 'ip', type: 'inet' },
    { name: 'password', type: 'text' },
    { name: 'profile', type: 'jsonb' },
    { name: 'c', type: 'record' },
  ]
  const masker = createMasker(columns, options())
  assertEquals(masker.masked, ['email', 'last_name', 'iban', 'ip', 'password', 'c'])
  assertEquals(masker.columns[0], { name: 'id', type: 'int4' })
  assertEquals(masker.columns[4], { name: 'ip', type: 'text' })
  assertEquals(masker.columns[5], { name: 'password', type: 'text' })
  const row: CellValue[] = [
    1,
    'jane.doe@example.com',
    'Doe',
    'DE89370400440532013000',
    '10.0.0.1',
    'secret',
    { plan: 'pro', contact: { phone: '+49 30 1234567' } },
    '(1,jane.doe@example.com)',
  ]
  assertEquals(masker.mask([row])[0], [
    1,
    'j***@example.com',
    '***',
    '***3000',
    'h(10.0.0.1)',
    null,
    { plan: 'pro', contact: { phone: '***4567' } },
    '***',
  ])
  assertEquals(masker.mask([[2, null, null, null, null, null, null, null]])[0], [
    2,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ])
})

test('masking: maskingSink masks the rows and reports the masked columns', async () => {
  const written: CellValue[][] = []
  let header: ResultColumn[] = []
  let masked: string[] = []
  const sink = maskingSink(
    { columns: (c: ResultColumn[]) => void (header = c), rows: async (r: CellValue[][]) => void written.push(...r) },
    options(),
    (m) => (masked = m),
  )
  sink.columns([
    { name: 'id', type: 'int' },
    { name: 'surname', type: 'text' },
  ])
  await sink.rows([[1, 'Doe']])
  assertEquals(header, [
    { name: 'id', type: 'int' },
    { name: 'surname', type: 'text' },
  ])
  assertEquals(written, [[1, '***']])
  assertEquals(masked, ['surname'])
})

test('masking: column candidates skip tables, qualifiers, functions, strings and comments', () => {
  assertEquals(
    columnCandidates(
      `select c.id, "e-mail", lower(x) from crm.customer_addresses c join "phones" p on p.id = c.id
       where note = 'email' -- email`,
      'postgres',
    ),
    // Keywords are candidates too; no pattern matches them.
    ['select', 'id', 'e-mail', 'x', 'from', 'c', 'join', 'p', 'on', 'id', 'id', 'where', 'note'],
  )
  assertEquals(columnCandidates('select [Email] from dbo.Kunden', 'mssql'), ['select', 'Email', 'from'])
})

test('masking: maskViolation refuses masked columns and whole-row functions', () => {
  const check = (sql: string) => maskViolation(sql, 'postgres', options())
  assertEquals(check('select id, created_at from customer_addresses'), undefined)
  assertEquals(check('select count(*) from customers'), undefined)
  assertEquals(check("select id from customers where note = 'email'"), undefined)
  assert(check('select email as x from customers')?.includes('email'))
  assert(check("select count(*) from customers where c.email like 'a%'")?.includes('email'))
  assert(check('select lower("Email") from customers')?.includes('Email'))
  assert(check('select row_to_json(c) from customers c')?.includes('whole rows'))
  assert(maskViolation('select * from t for json path', 'mssql', options())?.includes('whole rows'))
  assertEquals(check('select id from customers'), undefined)
})
