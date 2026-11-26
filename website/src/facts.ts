// Colwerk in a few quotable sentences and key facts, shared by llms.txt and the landing page. Keep them current.
import reference from './data/reference.json'

const engines = reference.engines.filter((e) => !e.lakehouse).map((e) => e.label.replace(' / ', ' and '))

export const summary =
  'Colwerk is a free, open-source (MIT) SQL editor and database client for macOS, Windows and Linux. It connects to ' +
  'PostgreSQL, MySQL and MariaDB, SQL Server, ClickHouse, DuckDB and SQLite, queries lakehouses and CSV, Parquet, ' +
  'JSON and Excel files with SQL, and has a built-in MCP server so AI assistants like Claude, ChatGPT or Cursor can ' +
  'explore databases read-only. It runs entirely on your computer: no account, no telemetry, no cloud service.'

/** [label, value] pairs, plain text */
export const facts: [string, string][] = [
  ['Price and license', 'Free and open source under the MIT license. No paid tier, no account, no trial.'],
  [
    'Platforms',
    'macOS (Apple Silicon), Windows (x64), Linux (x64 and arm64, .deb). Signed automatic updates on macOS and Windows.',
  ],
  ['Databases', `${engines.join(', ')}.`],
  [
    'Lakehouses and files',
    'Apache Iceberg, Delta Lake, Databricks Unity Catalog and Microsoft Fabric OneLake through DuckDB; CSV, TSV, Parquet, JSON and Excel files on disk, S3, Google Cloud Storage or the web.',
  ],
  [
    'AI assistants',
    'No built-in AI. A built-in MCP server lets Claude, ChatGPT, Codex, Cursor, VS Code or any MCP client browse schemas and run read-only queries; the assistant hands its final query to a new tab and you decide what runs.',
  ],
  [
    'Privacy',
    'No telemetry, no analytics, no account. Passwords are encrypted with AES-256-GCM, with the key in the OS keychain, and are never shown to an AI assistant.',
  ],
  [
    'Data tools',
    'Result grid with sorting, filters and row editing; export to CSV, Parquet, Excel, JSON, NDJSON, Markdown and SQL INSERT; data import; schema and data compare; ER diagrams; execution plans; session monitor; masking of personal data.',
  ],
  [
    'Switching from another tool',
    'Imports connections from DBeaver, Beekeeper Studio, Azure Data Studio, .pgpass and dbt profiles.yml.',
  ],
  ['Made by', 'Dennis Hendricks, Germany. Source code on GitHub.'],
]
