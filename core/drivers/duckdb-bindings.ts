// Loads the Node-API addon `@duckdb/node-bindings`. In packaged builds the addon is not embedded: the launcher
// downloads it and passes the path of its `duckdb.node` through globalThis (launcher/native.ts). From source it
// comes from the project's node_modules.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import type * as Bindings from '@duckdb/node-bindings'
import { DbError } from '../types.ts'

function load(): typeof Bindings {
  const path = (globalThis as { colwerkDuckdbLibrary?: string }).colwerkDuckdbLibrary
  if (path) return createRequire(path)(path)
  // Resolved from the working directory (dev server and tests run in the project root), since Nitro's bundles
  // do not keep `import.meta.url`.
  return createRequire(join(process.cwd(), 'package.json'))('@duckdb/node-bindings')
}

let bindings: typeof Bindings | undefined
export const duckdb = () => (bindings ??= load())

/** The addon rejects with plain errors; the driver expects `DbError`. */
export async function call<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (e) {
    throw e instanceof DbError ? e : new DbError(e instanceof Error ? e.message : String(e))
  }
}
