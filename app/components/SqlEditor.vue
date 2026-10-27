<script setup lang="ts">
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { MSSQL, MySQL, PostgreSQL, sql, type SQLDialect } from '@codemirror/lang-sql'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Dialect } from '#core'

const props = defineProps<{
  dialect?: Dialect
  schema: Record<string, Record<string, string[]>>
  defaultSchema?: string
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
  '.cm-content': { caretColor: 'var(--ui-text-highlighted)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--ui-text-highlighted)' },
  '.cm-placeholder': { color: 'var(--ui-text-muted)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in oklab, var(--ui-primary) 25%, transparent) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--ui-bg-elevated)', border: '1px solid var(--ui-border)', color: 'var(--ui-text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--ui-bg-accented)', color: 'var(--ui-text-highlighted)' },
})

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
        syntaxHighlighting(highlight),
        placeholder('SQL eingeben … (⌘/Strg + Enter führt aus)'),
        language.of(languageExtension()),
        keymap.of([
          { key: 'Mod-Enter', run: () => (emit('run'), true) },
          { key: 'Mod-e', run: () => (emit('explain'), true) },
          ...closeBracketsKeymap,
          ...completionKeymap,
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

/** The selection if there is one, otherwise the statement under the cursor. */
function runnableSql(): string {
  if (!view) return ''
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return state.sliceDoc(sel.from, sel.to)
  const doc = state.doc.toString()
  const range = statementAt(doc, props.dialect ?? 'postgres', sel.head)
  if (!range) return ''
  // Select what is about to run, so it is visible which statement was executed.
  view.dispatch({ selection: { anchor: range.from, head: range.to } })
  return doc.slice(range.from, range.to)
}

defineExpose({ runnableSql, focus: () => view?.focus() })
</script>

<template>
  <div ref="host" class="h-full overflow-hidden" />
</template>
