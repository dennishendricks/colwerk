// The splitter lives in core (the drivers split scripts too); re-exported for the app's auto-imports.
export { isReadOnlyStatement, maskLiterals, type SplitDialect, splitStatements, statementAt, type StatementRange } from '../../core/sql-split.ts'
