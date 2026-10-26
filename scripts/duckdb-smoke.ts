// Smoke test: does the native DuckDB addon load in this runtime (run / compile / desktop)?
import { prepareDuckdbNative } from '../launcher/native.ts'

async function probe(): Promise<string> {
  try {
    await prepareDuckdbNative(import.meta.filename ?? Deno.mainModule)
    const { DuckDBInstance } = await import('@duckdb/node-api')
    const instance = await DuckDBInstance.create(':memory:')
    const conn = await instance.connect()
    const reader = await conn.runAndReadAll('select 42::bigint as answer, version() as v')
    return `OK ${JSON.stringify(reader.getRowObjectsJson())}`
  } catch (e) {
    return `FAIL ${e instanceof Error ? e.stack ?? e.message : String(e)}`
  }
}

const result = await probe()
console.log(result)
const out = Deno.env.get('SMOKE_OUT')
if (out) await Deno.writeTextFile(out, result)
if ('BrowserWindow' in Deno) {
  Deno.serve(() => new Response(`<pre>${result}</pre>`, { headers: { 'content-type': 'text/html' } }))
}
