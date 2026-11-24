import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export type BarcodeRow = {
  barcode: string
  name: string
  um: string
  price: number
  quantity: number
  fel: string
  updatedAt: number
}

export type BarcodeApiItem = {
  barcode: number | string
  name: string
  um: string
  price: number
  quantity: number
  fel?: string | null
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true })
}

export class BarcodeRepository {
  private db: Database.Database

  constructor() {
    const userData = app.getPath('userData')
    ensureDir(userData)
    const dbPath = path.join(userData, 'printnew.sqlite3')
    this.db = new Database(dbPath)

    const schema = `
CREATE TABLE IF NOT EXISTS barcodes (
  barcode TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  um TEXT NOT NULL,
  price REAL NOT NULL,
  quantity REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_barcodes_updated_at ON barcodes(updated_at);

CREATE TABLE IF NOT EXISTS app_meta (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  last_sync INTEGER
);

INSERT OR IGNORE INTO app_meta (id, last_sync) VALUES (0, NULL);
`.trim()
    this.db.exec(schema)
    // Migrare pentru baze create inainte de campul "fel"
    const cols = this.db.prepare(`PRAGMA table_info(barcodes)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'fel')) {
      this.db.exec(`ALTER TABLE barcodes ADD COLUMN fel TEXT NOT NULL DEFAULT ''`)
    }
  }

  listBarcodes(): BarcodeRow[] {
    const stmt = this.db.prepare(
      `SELECT barcode, name, um, price, quantity, fel, updated_at AS updatedAt
       FROM barcodes
       ORDER BY updated_at DESC, barcode ASC`
    )
    return stmt.all() as BarcodeRow[]
  }

  setLastSync(ts: number): void {
    this.db.prepare(`UPDATE app_meta SET last_sync = ? WHERE id = 0`).run(ts)
  }

  getLastSync(): number | null {
    const row = this.db.prepare(`SELECT last_sync FROM app_meta WHERE id = 0`).get() as {
      last_sync: number | null
    }
    return row?.last_sync ?? null
  }

  upsertMany(items: BarcodeApiItem[], now: number = Date.now()): { inserted: number; updated: number } {
    const upsert = this.db.prepare(
      `INSERT INTO barcodes (barcode, name, um, price, quantity, fel, updated_at)
       VALUES (@barcode, @name, @um, @price, @quantity, @fel, @updated_at)
       ON CONFLICT(barcode) DO UPDATE SET
         name=excluded.name,
         um=excluded.um,
         price=excluded.price,
         quantity=excluded.quantity,
         fel=excluded.fel,
         updated_at=excluded.updated_at`
    )

    const existingStmt = this.db.prepare(`SELECT 1 FROM barcodes WHERE barcode = ? LIMIT 1`)

    let inserted = 0
    let updated = 0

    const tx = this.db.transaction((rows: BarcodeApiItem[]) => {
      for (const r of rows) {
        const barcode = String(r.barcode)
        const existed = !!existingStmt.get(barcode)
        upsert.run({
          barcode,
          name: r.name ?? '',
          um: r.um ?? '',
          price: Number(r.price ?? 0),
          quantity: Number(r.quantity ?? 0),
          fel: String(r.fel ?? '').trim().toUpperCase(),
          updated_at: now
        })
        if (existed) updated += 1
        else inserted += 1
      }
    })

    tx(items)
    return { inserted, updated }
  }

  deleteMany(barcodes: string[]): number {
    if (!barcodes.length) return 0
    const placeholders = barcodes.map(() => '?').join(',')
    const stmt = this.db.prepare(`DELETE FROM barcodes WHERE barcode IN (${placeholders})`)
    const info = stmt.run(barcodes)
    return info.changes ?? 0
  }

  updateMany(items: Array<{ barcode: string; name: string; price: number }>): number {
    if (!items.length) return 0
    const now = Date.now()
    const stmt = this.db.prepare(
      `UPDATE barcodes
       SET name = ?, price = ?, updated_at = ?
       WHERE barcode = ?`
    )

    const tx = this.db.transaction((rows: Array<{ barcode: string; name: string; price: number }>) => {
      let changes = 0
      for (const r of rows) {
        const info = stmt.run(r.name, r.price, now, r.barcode)
        changes += info.changes ?? 0
      }
      return changes
    })

    return tx(items)
  }
}

