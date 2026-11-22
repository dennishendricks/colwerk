// The editing logic lives in core (the server checks the dialect too); re-exported for the app's auto-imports.
export {
  buildEditTarget,
  canUpdateToDefault,
  type Changes,
  editBlocker,
  type EditBlock,
  type EditColumn,
  editDialects,
  editorKind,
  editStatements,
  type EditTarget,
  type EditValue,
  singleTableSource,
  sqlLiteral,
} from '../../core/table-edit.ts'
