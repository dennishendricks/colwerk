import { AsyncLocalStorage } from 'node:async_hooks'

// Separate from drivers/entra.ts, which is loaded with the drivers only.
const loginForbidden = new AsyncLocalStorage<boolean>()

/** Runs `fn` without browser logins: connections opened inside need the token of an earlier login (MCP clients). */
export function withoutLogin<T>(fn: () => T): T {
  return loginForbidden.run(true, fn)
}

export const isLoginForbidden = () => loginForbidden.getStore() === true
