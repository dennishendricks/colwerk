import { type CompletionSource, snippetCompletion } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { type Diagnostic, linter } from '@codemirror/lint'
import { identifier } from './sql-ident.ts'
import { SQL_FUNCTIONS } from './sql-functions.ts'
import { lintSql, type LintOptions, type SqlDiagnostic } from './sql-lint.ts'
import { findTable, joinSuggestions, resolveQualifier, type SchemaModel } from './sql-scope.ts'
import { maskLiterals, type SplitDialect } from './sql-split.ts'

// CodeMirror glue for the editor: completion and linting from the analysis in sql-scope.ts.

// After these a table is expected, not a function.
const TABLE_KEYWORDS = new Set(['from', 'join', 'into', 'update', 'table'])

function unquote(ident: string): string {
  const close = { '"': '"', '`': '`', '[': ']' }[ident[0]!]
  return close ? ident.slice(1, -1).replaceAll(close + close, close) : ident
}

/**
 * Completion beyond `@codemirror/lang-sql`, which only knows tables and columns by their full names: tables related
 * by foreign keys after `join`, columns of aliases, CTEs and subqueries after `x.`, and functions of the dialect.
 */
export function assistCompletion(get: () => { dialect: SplitDialect; model?: SchemaModel }): CompletionSource {
  return (context) => {
    const { dialect, model } = get()
    const { state, pos } = context
    if (!model || ['String', 'LineComment', 'BlockComment'].includes(syntaxTree(state).resolveInner(pos, -1).name)) {
      return null
    }
    const doc = state.doc.toString()
    // Same offsets as the text; quoted names are `___`, so their original is read from `doc`.
    const before = maskLiterals(doc.slice(0, pos), dialect)

    const join = /\bjoin\s+([\w$.]*)$/i.exec(before)
    if (join) {
      const options = joinSuggestions(doc, pos, dialect, model).map((s) => ({ ...s, type: 'class', boost: 10 }))
      return options.length ? { from: pos - join[1]!.length, options, validFor: /^[\w$.]*$/ } : null
    }

    const dot = /([\w$]+)\s*\.\s*([\w$]*)$/.exec(before)
    if (dot) {
      const resolved = resolveQualifier(
        doc,
        pos,
        unquote(doc.slice(dot.index, dot.index + dot[1]!.length)),
        dialect,
        model,
      )
      const columns =
        resolved &&
        ('table' in resolved ? findTable(model, resolved.table.schema, resolved.table.name)?.columns : resolved.columns)
      // No detail: lang-sql lists the same columns of a table, and CodeMirror merges options that look alike.
      return columns
        ? {
            from: pos - dot[2]!.length,
            options: columns.map((label) => ({ label, type: 'property' })),
            validFor: /^[\w$]*$/,
          }
        : null
    }

    const word = context.matchBefore(/[\w$]+/)
    if (!word && !context.explicit) return null
    if (TABLE_KEYWORDS.has(/(\w+)\s+[\w$]*$/.exec(before)?.[1]?.toLowerCase() ?? '')) return null
    const options = [
      ...SQL_FUNCTIONS[dialect].map(([name, args]) =>
        snippetCompletion(`${name}(\${})`, { label: name, type: 'function', detail: `(${args})` }),
      ),
      ...model.functions.map((name) =>
        snippetCompletion(`${identifier(dialect, name)}(\${})`, {
          label: name,
          type: 'function',
          detail: 'user-defined',
        }),
      ),
    ]
    return { from: word?.from ?? pos, options, validFor: /^[\w$]*$/ }
  }
}

/** Warnings from `lintSql`, shown after the user paused typing; `message` words a diagnostic. */
export function assistLinter(
  get: () => { dialect: SplitDialect; model?: SchemaModel; options: LintOptions },
  message: (d: SqlDiagnostic) => string,
) {
  return linter(
    (view): Diagnostic[] => {
      const { dialect, model, options } = get()
      if (!model) return []
      return lintSql(view.state.doc.toString(), dialect, model, options).map((d) => ({
        from: d.from,
        to: d.to,
        severity: 'warning',
        message: message(d),
      }))
    },
    { delay: 750 },
  )
}
