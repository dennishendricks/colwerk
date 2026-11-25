// Masking options (core/masking.ts): patterns of the settings, column lists of the connection, HMAC key from the store
import { createHmac } from 'node:crypto'
import type { ConnectionConfig, MaskOptions } from '#core'

let key: Promise<Uint8Array> | undefined

/** Options for results of `connection` (its column lists apply if given). */
export async function maskOptions(
  connection?: Pick<ConnectionConfig, 'maskColumns' | 'unmaskColumns'>,
  source?: MaskOptions['source'],
): Promise<MaskOptions> {
  key ??= store.maskKey()
  key.catch(() => (key = undefined))
  const [settings, secret] = await Promise.all([getSettings(), key])
  return {
    rules: settings.masking.rules,
    columns: connection?.maskColumns,
    exempt: connection?.unmaskColumns,
    hash: (text) => createHmac('sha256', secret).update(text).digest('hex').slice(0, 16),
    source,
  }
}

/** Whether MCP answers of `connection` are masked; on unless switched off. */
export const masksMcp = (connection: Pick<ConnectionConfig, 'maskMcp'>) => connection.maskMcp !== false
