// Driver and API tests run against real databases; Bun's default of 5 s is too short for some of them. Set here because
// Bun ignores `timeout` in bunfig.toml.
import { setDefaultTimeout } from 'bun:test'

setDefaultTimeout(60_000)
