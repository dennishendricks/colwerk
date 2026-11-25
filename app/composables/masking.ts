// PII masking in the UI: which result columns a connection masks (patterns of the settings, its column lists) and
// changing its column lists from the grid's column menu
import type { ConnectionSummary } from '#core'
import { maskMethodOf } from '~~/core/masking.ts'

export function useMasking() {
  const { settings } = useSettings()
  const { connections, connectionOf } = useConnections()

  /** Whether exports and MCP answers of `connectionId` mask column `name` (exports only when masking is chosen). */
  function isMasked(connectionId: string | undefined, name: string): boolean {
    const c = connectionOf(connectionId)
    return !!maskMethodOf(name, {
      rules: settings.value.masking.rules,
      columns: c?.maskColumns,
      exempt: c?.unmaskColumns,
    })
  }

  /** Masks or unmasks column `name` (by name, in every table) through the connection's column lists. */
  async function setMasked(connectionId: string, name: string, masked: boolean) {
    const c = connectionOf(connectionId)
    if (!c) return
    const other = (list?: string[]) => (list ?? []).filter((e) => e.toLowerCase() !== name.toLowerCase())
    const maskColumns = other(c.maskColumns)
    const unmaskColumns = other(c.unmaskColumns)
    const byPattern = !!maskMethodOf(name, { rules: settings.value.masking.rules })
    if (masked && !byPattern) maskColumns.push(name)
    if (!masked && byPattern) unmaskColumns.push(name)
    const saved = await api<ConnectionSummary>(`/api/connections/${connectionId}/masking`, {
      method: 'POST',
      body: { maskColumns, unmaskColumns },
    })
    connections.value = connections.value.map((x) => (x.id === saved.id ? saved : x))
  }

  return { isMasked, setMasked }
}
