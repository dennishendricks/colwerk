// Property and fuzz tests of the SQL splitter: a wrong split runs the wrong statements, so the splitter is checked
// against generated scripts with known statements and against random input. Seeded, so a failure is reproducible:
// the message names the seed and the script.
import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { maskLiterals, type SplitDialect, splitStatements } from '../core/sql-split.ts'

const DIALECTS: SplitDialect[] = ['postgres', 'mysql', 'mssql', 'duckdb', 'sqlite', 'clickhouse']
const RUNS = 1500

/** mulberry32 */
function random(seed: number) {
  let a = seed
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  const pick = <T>(items: readonly T[]) => items[int(items.length)]!
  return { int, pick }
}

// Tokens that keep `;`, line breaks, `GO`, `DELIMITER` and the like inside a literal or comment. Each must be one
// complete token, so that tokens joined by a space never form another construct.
const COMMON = [
  'select',
  'from',
  't',
  'x1',
  '42',
  '3.5',
  '*',
  ',',
  '=',
  '(1)',
  "'a;b'",
  "'it''s;'",
  "'line\n\nGO\nnext;'",
  "'delimiter //'",
  '"q;id"',
  '-- c;d\n',
  '-- GO\n',
  '/* x; */',
  '/*\nGO\n;*/',
  '/* -- ; */',
]
const TOKENS: Record<SplitDialect, string[]> = {
  postgres: [...COMMON, '$$;$$', '$t$ $$ ; $t$', 'a$b', '$1', "E'\\';'", "E'a\\\\'", '/* /* ; */ ; */', '"x""y;"'],
  duckdb: [...COMMON, '$$;$$', '$t$;$t$', "E'\\';'", '/* /* ; */ ; */'],
  clickhouse: [...COMMON, '$$;$$', "'\\';'", '"\\";"', '`a\\`;`', '# h;\n', '/* /* ; */ ; */'],
  mysql: [...COMMON, "'\\';'", '"\\";"', '`a;b`', '`a``;`', '# h;\n', '1--1', '/*! ; */'],
  mssql: [...COMMON, '[a;b]', '[a]];]', "N'x;'", '/* /* ; */ ; */', '@v', 'gone'],
  sqlite: [...COMMON, '[a;b]', '`a;b`', '$v', 'case when 1 then 2 end'],
}
// Statements whose body contains `;`; each is one statement of the script.
const BLOCKS: Partial<Record<SplitDialect, string[]>> = {
  postgres: ['create function f() returns int language sql begin atomic select 1; select 2; end'],
  mysql: ['create procedure p() begin if 1 then select 1; end if; select 2; end'],
  sqlite: ['create trigger tr after insert on t begin select 1; delete from u; end'],
}

function statement(r: ReturnType<typeof random>, dialect: SplitDialect): string {
  const blocks = BLOCKS[dialect]
  if (blocks && !r.int(8)) return r.pick(blocks)
  // Starts with a keyword, so that a statement never begins with a comment that swallows the rest.
  const tokens = ['select']
  for (let k = r.int(6); k > 0; k--) tokens.push(r.pick(TOKENS[dialect]))
  // A trailing line comment keeps its line break in the script (see `script`).
  return tokens.join(' ')
}

const WHITESPACE = [' ', '\n', '\t', '\n\n', ' \r\n']

/** A script of known statements, joined the way the dialect's client separates them. */
function script(seed: number, dialect: SplitDialect, mode: 'statements' | 'batches' | 'delimiter') {
  const r = random(seed)
  const raw = Array.from({ length: 1 + r.int(5) }, () => statement(r, dialect))
  // Ranges are trimmed: without the line break that ends a trailing line comment.
  const statements = raw.map((s) => s.trim())
  const ws = () => r.pick(WHITESPACE)
  let sql: string
  if (mode === 'batches') {
    sql = raw.map((s) => `${s}\n${r.pick(['GO', 'go', '  Go  ', 'GO -- next'])}\n`).join(ws())
  } else if (mode === 'delimiter') {
    // The block statements contain `;` and need the other delimiter.
    sql = `DELIMITER //\n${raw.map((s) => `${s}${ws()}//`).join(ws())}\nDELIMITER ;\nselect 0;`
    statements.push('select 0')
  } else {
    sql = raw.map((s) => `${s}${ws()};${r.int(3) ? '' : ';'}`).join(ws())
  }
  return { sql, statements }
}

const texts = (sql: string, d: SplitDialect, semicolons = true) =>
  splitStatements(sql, d, { semicolons }).map((r) => sql.slice(r.from, r.to))

test('generated scripts split into exactly their statements', () => {
  for (const dialect of DIALECTS) {
    for (let seed = 0; seed < RUNS; seed++) {
      const { sql, statements } = script(seed, dialect, 'statements')
      assertEquals(texts(sql, dialect), statements, `${dialect} seed ${seed}: ${JSON.stringify(sql)}`)
    }
  }
})

test('generated mssql batches split at GO only', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const { sql, statements } = script(seed, 'mssql', 'batches')
    assertEquals(texts(sql, 'mssql', false), statements, `seed ${seed}: ${JSON.stringify(sql)}`)
  }
})

test('generated mysql scripts with DELIMITER', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const { sql, statements } = script(seed, 'mysql', 'delimiter')
    assertEquals(texts(sql, 'mysql'), statements, `seed ${seed}: ${JSON.stringify(sql)}`)
  }
})

// Characters that start or end literals, comments and statements, so random input hits the edge cases often.
const ALPHABET = [...'\';"`[]$-/*#\\()\n \tEeGgOo1aä', 'go', 'GO\n', '$$', '$a$', 'begin ', 'end', 'case ', 'create ']

function fuzz(seed: number): string {
  const r = random(seed)
  let s = ''
  for (let k = r.int(60); k > 0; k--) s += r.pick(ALPHABET)
  return s
}

test('fuzz: ranges are ordered, trimmed and drop nothing but delimiters and blanks', () => {
  for (const dialect of DIALECTS) {
    for (let seed = 0; seed < RUNS * 2; seed++) {
      const sql = fuzz(seed)
      const at = `${dialect} seed ${seed}: ${JSON.stringify(sql)}`
      const ranges = splitStatements(sql, dialect)
      let end = 0
      for (const { from, to } of ranges) {
        assertEquals(from >= end && to > from && to <= sql.length, true, at)
        assertEquals(/^\s|\s$/.test(sql.slice(from, to)), false, at)
        // Between two statements: only blanks and `;` (mssql also `GO` lines, mysql also `DELIMITER` lines).
        const gap = sql.slice(end, from)
        if (dialect !== 'mssql' && dialect !== 'mysql') assertEquals(/^[\s;]*$/.test(gap), true, `${at} gap ${gap}`)
        end = to
      }
      if (dialect !== 'mssql' && dialect !== 'mysql') assertEquals(/^[\s;]*$/.test(sql.slice(end)), true, at)
    }
  }
})

test('fuzz: a statement splits into itself again', () => {
  // mssql and mysql are left out: `GO` and `DELIMITER` depend on the line start, which a range may cut off.
  for (const dialect of ['postgres', 'duckdb', 'sqlite', 'clickhouse'] as const) {
    for (let seed = 0; seed < RUNS * 2; seed++) {
      const sql = fuzz(seed)
      for (const text of texts(sql, dialect)) {
        assertEquals(texts(text, dialect), [text], `${dialect} seed ${seed}: ${JSON.stringify(sql)}`)
      }
    }
  }
})

test('fuzz: masking keeps length and line breaks', () => {
  for (const dialect of DIALECTS) {
    for (let seed = 0; seed < RUNS; seed++) {
      const sql = fuzz(seed)
      const masked = maskLiterals(sql, dialect)
      assertEquals(masked.length, sql.length, `${dialect} seed ${seed}`)
      assertEquals(
        [...masked].map((c, i) => c === '\n' || sql[i] !== '\n'),
        [...masked].map(() => true),
      )
    }
  }
})
