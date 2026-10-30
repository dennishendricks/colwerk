<script setup lang="ts">
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { MSSQL, MySQL, PostgreSQL, sql, type SQLDialect } from '@codemirror/lang-sql'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, placeholder, tooltips } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Dialect } from '#core'

const props = defineProps<{
  dialect?: Dialect
  schema: Record<string, Record<string, string[]>>
  defaultSchema?: string
  /** Document offset of the last run's error. */
  errorAt?: number
}>()
const emit = defineEmits<{ run: [], explain: [] }>()
const model = defineModel<string>({ required: true })

// DuckDB's grammar is close to PostgreSQL's.
const DIALECTS: Record<Dialect, SQLDialect> = { postgres: PostgreSQL, duckdb: PostgreSQL, mysql: MySQL, mssql: MSSQL }

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--sql-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--sql-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--sql-number)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--sql-comment)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.standard(tags.name)], color: 'var(--sql-type)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--ui-bg)', color: 'var(--ui-text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  // Colors from the theme tokens so both color modes keep a readable contrast (WCAG AA):
  // `drawSelection` draws its own cursor, which is black by default and invisible in dark mode.
  '.cm-gutters': { backgroundColor: 'var(--ui-bg-muted)', color: 'var(--ui-text-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--ui-primary) 6%, transparent)' },
  '.cm-errorLine': { backgroundColor: 'color-mix(in oklab, var(--ui-error) 10%, transparent)' },
  '.cm-errorMark': { textDecoration: 'underline wavy var(--ui-error)', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
  '.cm-content': { caretColor: 'var(--ui-text-highlighted)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--ui-text-highlighted)' },
  '.cm-placeholder': { color: 'var(--ui-text-muted)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in oklab, var(--ui-primary) 25%, transparent) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--ui-bg-elevated)', border: '1px solid var(--ui-border)', color: 'var(--ui-text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--ui-bg-accented)', color: 'var(--ui-text-highlighted)' },
  // Search panel (⌘F)
  '.cm-panels': { backgroundColor: 'var(--ui-bg-muted)', color: 'var(--ui-text)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--ui-border)' },
  '.cm-textfield': { backgroundColor: 'var(--ui-bg)', border: '1px solid var(--ui-border-accented)', borderRadius: '4px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--ui-bg-elevated)', border: '1px solid var(--ui-border-accented)', borderRadius: '4px' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklab, var(--ui-warning) 30%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklab, var(--ui-primary) 45%, transparent)' },
})

const phrases = EditorState.phrases.of({
  Find: 'Suchen',
  Replace: 'Ersetzen',
  next: 'Weiter',
  previous: 'Zurück',
  all: 'Alle',
  'match case': 'Groß-/Kleinschreibung',
  regexp: 'Regulärer Ausdruck',
  'by word': 'Ganzes Wort',
  replace: 'Ersetzen',
  'replace all': 'Alle ersetzen',
  close: 'Schließen',
  'current match': 'Aktueller Treffer',
  'on line': 'in Zeile',
  'replaced $ matches': '$ Treffer ersetzt',
  'replaced match on line $': 'Treffer in Zeile $ ersetzt',
  'Go to line': 'Gehe zu Zeile',
  go: 'OK',
})

// The error mark refers to the text that was run, so any edit removes it.
const setError = StateEffect.define<number | undefined>()
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    if (tr.docChanged) marks = Decoration.none
    for (const e of tr.effects) {
      if (e.is(setError)) marks = e.value === undefined ? Decoration.none : errorDecorations(tr.state, e.value)
    }
    return marks
  },
  provide: f => EditorView.decorations.from(f),
})

/** Underlines the word at `pos` (at least one character) and highlights its line. */
function errorDecorations(state: EditorState, pos: number): DecorationSet {
  const { length } = state.doc
  if (!length) return Decoration.none
  // A position at the end (e.g. "end of input") marks the last character.
  const from = Math.max(0, Math.min(pos, length - 1))
  const to = Math.max(state.wordAt(from)?.to ?? 0, from + 1)
  return Decoration.set([
    Decoration.line({ class: 'cm-errorLine' }).range(state.doc.lineAt(from).from),
    Decoration.mark({ class: 'cm-errorMark' }).range(from, to),
  ])
}

const host = ref<HTMLElement>()
const language = new Compartment()
let view: EditorView | undefined

function languageExtension() {
  return sql({
    dialect: DIALECTS[props.dialect ?? 'postgres'],
    schema: props.schema,
    defaultSchema: props.defaultSchema,
    upperCaseKeywords: false,
  })
}

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: model.value,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        // Outside the editor so the completion list is not clipped by the panel and can flip upwards.
        tooltips({ parent: document.body }),
        search({ top: true }),
        phrases,
        syntaxHighlighting(highlight),
        placeholder('SQL eingeben … (⌘/Strg + Enter führt aus)'),
        language.of(languageExtension()),
        errorField,
        keymap.of([
          { key: 'Mod-Enter', run: () => (emit('run'), true) },
          { key: 'Mod-e', run: () => (emit('explain'), true) },
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) model.value = u.state.doc.toString()
        }),
        theme,
      ],
    }),
  })
  // Each tab mounts its editor once on creation, so new tabs are ready for typing right away.
  view.focus()
})

onBeforeUnmount(() => view?.destroy())

watch(() => [props.dialect, props.schema, props.defaultSchema], () => {
  view?.dispatch({ effects: language.reconfigure(languageExtension()) })
}, { deep: true })

watch(model, (value) => {
  if (!view) return
  const doc = view.state.doc.toString()
  if (value === doc) return
  if (value.startsWith(doc)) {
    // Appended from outside (e.g. a generated SELECT): keep the undo history and select the new part.
    const from = value.length - value.slice(doc.length).replace(/^[\s;]+/, '').length
    view.dispatch({ changes: { from: doc.length, insert: value.slice(doc.length) }, selection: { anchor: from, head: value.length }, scrollIntoView: true })
  } else {
    view.dispatch({ changes: { from: 0, to: doc.length, insert: value } })
  }
})

watch(() => props.errorAt, (pos) => {
  if (!view) return
  if (pos === undefined) return view.dispatch({ effects: setError.of(undefined) })
  const at = Math.min(pos, view.state.doc.length)
  view.dispatch({ effects: setError.of(at), selection: { anchor: at }, scrollIntoView: true })
  view.focus()
})

/** The selection if there is one, otherwise the statement under the cursor; `from`: its document offset. */
function runnableSql(): { sql: string, from: number } {
  if (!view) return { sql: '', from: 0 }
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return { sql: state.sliceDoc(sel.from, sel.to), from: sel.from }
  const doc = state.doc.toString()
  const range = statementAt(doc, props.dialect ?? 'postgres', sel.head)
  if (!range) return { sql: '', from: 0 }
  // Select what is about to run, so it is visible which statement was executed.
  view.dispatch({ selection: { anchor: range.from, head: range.to } })
  return { sql: doc.slice(range.from, range.to), from: range.from }
}

// Only while focused: otherwise copy acts on the page's selection, not the editor's.
const hasSelection = () => !!view?.hasFocus && !view.state.selection.main.empty

defineExpose({ runnableSql, hasSelection, focus: () => view?.focus() })
</script>

<template>
  <div ref="host" class="h-full overflow-hidden" />
</template>
