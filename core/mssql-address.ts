// SQL Server notation `host\instance` and `DOMAIN\user`, split into the connection's separate fields

/** Splits `host\instance` into host and named instance, and `DOMAIN\user` into domain and user with Windows login. */
export function splitMssqlBackslashes(body: Record<string, unknown>): Record<string, unknown> {
  const split = (value: unknown) => {
    const parts = typeof value === 'string' ? value.split('\\') : []
    return parts.length === 2 && parts[0] && parts[1] ? parts : undefined
  }
  const next = { ...body }
  const host = split(body.host)
  if (host) [next.host, next.instanceName] = host
  // Entra logins take the user as it is.
  const user = [undefined, '', 'password', 'windows'].includes(body.auth as string) ? split(body.user) : undefined
  if (user) Object.assign(next, { auth: 'windows', domain: user[0], user: user[1] })
  return next
}
