// Initial values of the connection dialog, from a saved connection or the defaults of a new one
import type { ConnectionInput, ConnectionSummary } from '#core'

export function connectionFormValues(c?: ConnectionSummary): Partial<ConnectionInput> {
  return {
    id: c?.id,
    name: c?.name ?? '',
    folder: c?.folder ?? '',
    dialect: c?.dialect ?? 'postgres',
    host: c?.host ?? '127.0.0.1',
    port: c?.port,
    database: c?.database ?? '',
    user: c?.user ?? '',
    password: '',
    // Copied, so edits do not change the connection list.
    passwordRef: c?.passwordRef && { ...c.passwordRef },
    auth: c?.auth,
    domain: c?.domain ?? '',
    tenantId: c?.tenantId ?? '',
    clientId: c?.clientId ?? '',
    socket: c?.socket ?? '',
    searchPath: c?.searchPath ?? '',
    instanceName: c?.instanceName ?? '',
    readOnlyIntent: c?.readOnlyIntent ?? false,
    multiSubnetFailover: c?.multiSubnetFailover ?? false,
    connectRetries: c?.connectRetries,
    language: c?.language ?? '',
    dateFormat: c?.dateFormat,
    ssl: c?.ssl ?? false,
    sslCa: c?.sslCa ?? '',
    sslInsecure: c?.sslInsecure ?? false,
    sslStrict: c?.sslStrict ?? false,
    sslServerName: c?.sslServerName ?? '',
    file: c?.file ?? '',
    readOnly: c?.readOnly ?? false,
    v1Storage: c?.v1Storage ?? false,
    region: c?.region ?? '',
    oauthServerUri: c?.oauthServerUri ?? '',
    oauthScope: c?.oauthScope ?? '',
    ssh: c?.ssh ?? false,
    sshHost: c?.sshHost ?? '',
    sshPort: c?.sshPort,
    sshUser: c?.sshUser ?? '',
    sshAuth: c?.sshAuth ?? 'password',
    sshKeyFile: c?.sshKeyFile ?? '',
    sshSecret: '',
    sshSecretRef: c?.sshSecretRef && { ...c.sshSecretRef },
    sshHostKey: c?.sshHostKey,
    color: c?.color,
    confirmWrites: c?.confirmWrites ?? false,
    checkPlan: c?.checkPlan,
    scanRowThreshold: c?.scanRowThreshold,
    mcpLogin: c?.mcpLogin ?? false,
    mcpUser: c?.mcpUser ?? '',
    mcpPassword: '',
    mcpExternalAccess: c?.mcpExternalAccess ?? false,
    requireWhere: c?.requireWhere,
  }
}

// The dialog opens with the further options shown when the connection uses one of them.
export function usesAdvancedOptions(c?: ConnectionSummary): boolean {
  return !!(
    c &&
    (c.tenantId ||
      c.clientId ||
      c.socket ||
      c.searchPath ||
      c.instanceName ||
      c.readOnlyIntent ||
      c.multiSubnetFailover ||
      c.connectRetries !== undefined ||
      c.language ||
      c.dateFormat ||
      c.sslCa ||
      c.sslInsecure ||
      c.sslStrict ||
      c.sslServerName ||
      c.region ||
      c.oauthServerUri ||
      c.oauthScope ||
      c.ssh ||
      c.mcpLogin ||
      c.v1Storage ||
      c.mcpExternalAccess ||
      c.color ||
      c.readOnly ||
      c.confirmWrites ||
      c.requireWhere !== undefined ||
      c.checkPlan !== undefined ||
      c.scanRowThreshold !== undefined)
  )
}
