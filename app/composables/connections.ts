import type { ConnectionInput, ConnectionSummary, Dialect, DriverStatus } from '#core'
import { forgetSchemas } from './schema'
import { forgetTransactions, hasOpenTransaction } from './tabs'

// Client-side state. The app is a single-window SPA, so module-level reactive state is sufficient.

const drivers = ref<DriverStatus[]>([])
const connections = ref<ConnectionSummary[]>([])
const activeConnectionId = ref<string>()
/** Database selected in the sidebar; undefined = the one configured in the connection. */
const activeDatabase = ref<string>()
const activeConnection = computed(() => connections.value.find((c) => c.id === activeConnectionId.value))

watch(activeConnectionId, () => (activeDatabase.value = undefined))

export function useConnections() {
  async function load() {
    ;[drivers.value, connections.value] = await Promise.all([
      api<DriverStatus[]>('/api/drivers'),
      api<ConnectionSummary[]>('/api/connections'),
    ])
    activeConnectionId.value ??= connections.value[0]?.id
  }

  function driverOf(connectionId?: string): DriverStatus | undefined {
    const dialect = connections.value.find((c) => c.id === connectionId)?.dialect
    return drivers.value.find((d) => d.dialect === dialect)
  }

  async function saveConnection(input: Partial<ConnectionInput>) {
    const saved = await api<ConnectionSummary>('/api/connections', { method: 'POST', body: input })
    connections.value = await api<ConnectionSummary[]>('/api/connections')
    forgetSchemas(saved.id)
    activeConnectionId.value = saved.id
    return saved
  }

  async function removeConnection(id: string) {
    await api(`/api/connections/${id}`, { method: 'DELETE' })
    connections.value = connections.value.filter((c) => c.id !== id)
    forgetSchemas(id)
    if (activeConnectionId.value === id) activeConnectionId.value = connections.value[0]?.id
  }

  /** Disconnecting closes all sessions of the connection on the server; open transactions are rolled back. */
  async function setConnected(id: string, connected: boolean) {
    await api(`/api/connections/${id}/${connected ? 'connect' : 'disconnect'}`, { method: 'POST' })
    const connection = connections.value.find((c) => c.id === id)
    if (connection) connection.disconnected = !connected
    if (connected) return
    forgetSchemas(id)
    forgetTransactions(id)
  }

  function testConnection(input: Partial<ConnectionInput>) {
    return api('/api/connections/test', { method: 'POST', body: input })
  }

  /** Downloads the driver's native library; `drivers` shows the progress meanwhile. */
  async function installDriver(dialect: Dialect) {
    let done = false
    const poll = setInterval(async () => {
      const status = await api<DriverStatus[]>('/api/drivers')
      if (!done) drivers.value = status
    }, 300)
    try {
      await api(`/api/drivers/${dialect}/install`, { method: 'POST' })
    } finally {
      done = true
      clearInterval(poll)
      drivers.value = await api<DriverStatus[]>('/api/drivers')
    }
  }

  return {
    drivers,
    connections,
    activeConnectionId,
    activeDatabase,
    activeConnection,
    load,
    driverOf,
    saveConnection,
    removeConnection,
    setConnected,
    testConnection,
    installDriver,
  }
}

// ---------------------------------------------------------------------------------------------
// Connect/disconnect of the active connection (sidebar button and application menu).

const togglingConnection = ref(false)
// Disconnecting waits for confirmation while a tab of the connection has an open transaction.
const confirmingDisconnect = ref(false)

export function useConnectionToggle() {
  const { setConnected, driverOf } = useConnections()

  // Embedded databases are locked while Colwerk has them open; disconnecting frees them for other tools.
  const canToggle = computed(
    () => !!activeConnection.value && !!driverOf(activeConnectionId.value)?.capabilities.locksDatabase,
  )

  async function toggleConnection(confirmed = false) {
    const connection = activeConnection.value
    if (!connection) return
    if (!connection.disconnected && !confirmed && hasOpenTransaction(connection.id)) {
      confirmingDisconnect.value = true
      return
    }
    confirmingDisconnect.value = false
    togglingConnection.value = true
    try {
      await setConnected(connection.id, !!connection.disconnected)
    } finally {
      togglingConnection.value = false
    }
  }

  return { canToggle, togglingConnection, confirmingDisconnect, toggleConnection }
}
