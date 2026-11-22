// State of the connection dialog: the form, which fields the dialect and login show, and the payload to save
import type { ConnectionAuth, ConnectionInput, ConnectionSummary } from '#core'

export function useConnectionForm(open: Ref<boolean>, connection: () => ConnectionSummary | undefined) {
  const { drivers } = useConnections()
  const { t } = useI18n()

  const form = reactive<Partial<ConnectionInput>>({})
  const clearPassword = ref(false)
  const clearSshSecret = ref(false)
  const clearMcpPassword = ref(false)
  const showAdvanced = ref(false)
  // Files: the sources, one per line.
  const sourcesText = ref('')

  watch(
    open,
    (isOpen) => {
      if (!isOpen) return
      const c = connection()
      clearPassword.value = false
      clearSshSecret.value = false
      clearMcpPassword.value = false
      sourcesText.value = c?.sources?.join('\n') ?? ''
      Object.assign(form, connectionFormValues(c))
      showAdvanced.value = usesAdvancedOptions(c)
    },
    { immediate: true },
  )

  const driver = computed(() => drivers.value.find((d) => d.dialect === form.dialect))
  const authItems = computed(() =>
    (driver.value?.auths ?? []).map((a) => ({ label: t(`connection.auths.${a}`), value: a })),
  )
  // Another dialect may not offer the selected login.
  watch(
    driver,
    (d) => {
      if (d && !d.auths.includes(form.auth as ConnectionAuth)) form.auth = d.auths[0]
    },
    { immediate: true },
  )
  const isEntra = computed(() => form.auth?.startsWith('entra-') ?? false)
  // Lakehouses: the address is the catalog URL (Iceberg, Unity) or the workspace (OneLake), the database its
  // warehouse, catalog or lakehouse; they log in with a token or an Entra login, without user name.
  const lakehouse = computed(() => !!form.dialect && isLakehouse(form.dialect))
  const hostField = computed(
    () =>
      ({
        iceberg: {
          label: 'catalogUrl',
          help: 'catalogUrlHelp',
          placeholder: 'https://catalog.example.com/api/catalog',
        },
        unity: {
          label: 'workspaceUrl',
          help: undefined,
          placeholder: 'https://adb-1234567890123456.7.azuredatabricks.net',
        },
        onelake: { label: 'workspace', help: 'workspaceHelp', placeholder: '' },
      })[form.dialect as string] ?? { label: 'host', help: undefined, placeholder: '' },
  )
  const databaseField = computed(
    () =>
      ({
        iceberg: { label: 'warehouse', help: 'warehouseHelp' },
        unity: { label: 'catalog', help: 'catalogHelp' },
        onelake: { label: 'lakehouse', help: 'lakehouseHelp' },
      })[form.dialect as string] ?? { label: 'database', help: undefined },
  )
  // A host prefilled for a server is no catalog URL or workspace.
  watch(lakehouse, (isLake) => {
    if (isLake && form.host === '127.0.0.1') form.host = ''
    else if (!isLake && !form.host) form.host = '127.0.0.1'
  })
  // SQL Server takes the user from the Entra token; PostgreSQL and MySQL need the database user that belongs to it.
  const showUser = computed(
    () => !lakehouse.value && (!isEntra.value || form.dialect !== 'mssql' || form.auth === 'entra-interactive'),
  )
  const showPassword = computed(() =>
    (
      ['password', 'windows', 'entra-service-principal', 'token', 'oauth-client', 's3', 'gcs'] as (string | undefined)[]
    ).includes(form.auth),
  )
  const passwordLabel = computed(() =>
    form.auth === 'entra-service-principal' || form.auth === 'oauth-client'
      ? t('connection.clientSecret')
      : form.auth === 's3'
        ? t('connection.secretAccessKey')
        : form.auth === 'gcs'
          ? t('connection.hmacSecret')
          : form.auth === 'token'
            ? t('connection.token')
            : t('connection.password'),
  )
  const mcpLoginAvailable = computed(
    () => !!driver.value?.auths.length && mcpLoginAuths.includes(form.auth as ConnectionAuth),
  )
  // Lakehouses have further options only for some logins.
  const hasAdvanced = computed(
    () =>
      !lakehouse.value ||
      mcpLoginAvailable.value ||
      form.auth === 'oauth-client' ||
      form.auth === 'entra-default' ||
      form.auth === 'entra-interactive' ||
      form.dialect === 'unity',
  )

  // An empty password field keeps the stored password (sent as `undefined`), `''` removes it (also when the login needs none).
  // A reference to a password manager replaces a stored secret, which is then removed.
  function payload(): Partial<ConnectionInput> {
    const passwordRef = showPassword.value ? form.passwordRef : undefined
    const password =
      passwordRef || clearPassword.value || !showPassword.value
        ? ''
        : form.password || (connection()?.hasPassword ? undefined : '')
    // Like the password: empty keeps the stored SSH secret, `''` removes it.
    const sshSecretRef = form.ssh && form.sshAuth !== 'agent' ? form.sshSecretRef : undefined
    const sshSecret =
      sshSecretRef || clearSshSecret.value || !form.ssh || form.sshAuth === 'agent'
        ? ''
        : form.sshSecret || (connection()?.hasSshSecret ? undefined : '')
    // Like the password: empty keeps the stored MCP password, `''` removes it.
    const mcpPassword =
      clearMcpPassword.value || !form.mcpLogin || !mcpLoginAvailable.value
        ? ''
        : form.mcpPassword || (connection()?.hasMcpPassword ? undefined : '')
    // The fields that exclude a tunnel are hidden with it on.
    const sources = form.dialect === 'files' ? sourcesText.value.split('\n') : undefined
    return {
      ...form,
      password,
      passwordRef,
      sshSecret,
      sshSecretRef,
      mcpPassword,
      sources,
      ...(form.ssh && { socket: '', instanceName: '' }),
    }
  }

  return {
    form,
    clearPassword,
    clearSshSecret,
    clearMcpPassword,
    showAdvanced,
    sourcesText,
    driver,
    authItems,
    isEntra,
    lakehouse,
    hostField,
    databaseField,
    showUser,
    showPassword,
    passwordLabel,
    mcpLoginAvailable,
    hasAdvanced,
    payload,
  }
}
