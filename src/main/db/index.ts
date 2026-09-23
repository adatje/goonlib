import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { migrations } from './migrations'
import { hamming } from './hamming'

let handle: Database.Database | null = null

export function dbPath(): string {
  return join(app.getPath('userData'), 'goonlib.db')
}

export function getDb(): Database.Database {
  if (!handle) throw new Error('Database has not been initialised — call initDb() first')
  return handle
}

/**
 * Opens (creating if needed) the library database and brings it up to the latest
 * schema version. Safe to call once at startup; `path` is injectable for tests.
 */
export function initDb(path: string = dbPath()): Database.Database {
  mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path)

  // WAL lets the scan workers write while the UI reads, which is the whole point.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  db.function('hamming', { deterministic: true }, (a: unknown, b: unknown) =>
    hamming(typeof a === 'string' ? a : null, typeof b === 'string' ? b : null),
  )

  runMigrations(db)

  handle = db
  return db
}

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number

  for (const migration of migrations) {
    if (migration.version <= current) continue

    // DDL and the version bump land together, so a crash mid-migration can never
    // leave the file claiming a version it doesn't have.
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${(err as Error).message}`,
        { cause: err },
      )
    }
  }
}

export function closeDb(): void {
  if (!handle) return
  // Fold the WAL back into the main file so the DB is a single tidy artifact at rest.
  try {
    handle.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // A checkpoint failure on shutdown is not worth blocking quit over.
  }
  handle.close()
  handle = null
}
