import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

// Own module without further imports: the launcher's MCP bridge needs it outside the server bundle.
export function defaultDataDir(): string {
  const env = process.env.DBM_DATA_DIR
  if (env) return env
  const home = homedir()
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'colwerk')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'colwerk')
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'colwerk')
}
