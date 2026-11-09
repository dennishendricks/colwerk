import type { TokenCredential } from '@azure/identity'
import { isLoginForbidden } from '../login.ts'
import { AppError, type ConnectionConfig } from '../types.ts'

/** OAuth scopes of Azure SQL and of Azure Database for PostgreSQL / MySQL. */
export const ENTRA_SCOPE = {
  mssql: 'https://database.windows.net/.default',
  ossrdbms: 'https://ossrdbms-aad.database.windows.net/.default',
}

// Time the user has to finish the browser login.
const LOGIN_TIMEOUT = 5 * 60_000

// Credentials cache their tokens (and the browser login's refresh token) in memory only. They are kept for the
// lifetime of the process, shared by connections with the same login, so reconnects and cancel connections
// need no new login.
const credentials = new Map<string, TokenCredential>()

// @azure/identity is heavy, so it is loaded only on the first Entra login.
const identity = () => import('@azure/identity')

async function credential(c: ConnectionConfig): Promise<TokenCredential> {
  const { ClientSecretCredential, DefaultAzureCredential, InteractiveBrowserCredential } = await identity()
  const key = JSON.stringify([
    c.auth,
    c.tenantId,
    c.clientId,
    c.user,
    c.auth === 'entra-service-principal' ? c.password : undefined,
  ])
  let cred = credentials.get(key)
  if (!cred) {
    if (c.auth === 'entra-interactive') {
      // A login hint skips the account picker; database users of Entra groups are no account names.
      // getToken never opens the browser by itself: entraToken decides whether a login may start.
      cred = new InteractiveBrowserCredential({
        tenantId: c.tenantId,
        clientId: c.clientId,
        loginHint: c.user?.includes('@') ? c.user : undefined,
        disableAutomaticAuthentication: true,
      })
    } else if (c.auth === 'entra-service-principal') {
      cred = new ClientSecretCredential(c.tenantId ?? '', c.clientId ?? '', c.password ?? '')
    } else {
      cred = new DefaultAzureCredential({ tenantId: c.tenantId })
    }
    credentials.set(key, cred)
  }
  return cred
}

export const isEntra = (c: ConnectionConfig) => c.auth?.startsWith('entra-') ?? false

/** Access token of the connection's Entra login for `scope`; the interactive login may open the system browser (not inside `withoutLogin`). */
export async function entraToken(c: ConnectionConfig, scope: string): Promise<string> {
  const { AuthenticationRequiredError, InteractiveBrowserCredential } = await identity()
  const cred = await credential(c)
  const options = { abortSignal: AbortSignal.timeout(LOGIN_TIMEOUT) }
  let detail: string
  try {
    // Without a valid token (or refresh token) the interactive credential asks for a login.
    const token = await cred.getToken(scope, options).catch(async (e) => {
      if (!(e instanceof AuthenticationRequiredError && cred instanceof InteractiveBrowserCredential)) throw e
      if (isLoginForbidden()) {
        throw new AppError(
          'entraLoginRequired',
          'Microsoft Entra sign-in required: open the connection in Colwerk to sign in in the browser, then retry.',
          { code: 'EENTRALOGIN' },
        )
      }
      await cred.authenticate(scope, options)
      return cred.getToken(scope, options)
    })
    if (token) return token.token
    detail = 'no token received'
  } catch (e) {
    if (e instanceof AppError) throw e
    detail = (e as Error).message
  }
  throw new AppError('entraFailed', `Microsoft Entra login failed: ${detail}`, { code: 'EENTRA', params: { detail } })
}
