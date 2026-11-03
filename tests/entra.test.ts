import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { ENTRA_SCOPE, entraToken } from '../core/drivers/entra.ts'
import { withoutLogin } from '../core/login.ts'
import { AppError, type ConnectionConfig } from '../core/types.ts'

Deno.test('entra: without a login, MCP requests get an error instead of a browser window', async () => {
  const config: ConnectionConfig = { id: 'e', name: 'e', dialect: 'mssql', host: 'example.database.windows.net', auth: 'entra-interactive' }
  const e = await assertRejects(() => withoutLogin(() => entraToken(config, ENTRA_SCOPE.mssql)), AppError)
  assertEquals(e.key, 'entraLoginRequired')
})
