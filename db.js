import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bundledDb = path.join(__dirname, "data.db");
const runtimeDb = process.env.VERCEL ? path.join("/tmp", "data.db") : bundledDb;

// On read-only deployments (e.g., Vercel) copy the bundled DB into /tmp for writes
if (process.env.VERCEL && !fs.existsSync(runtimeDb) && fs.existsSync(bundledDb)) {
  fs.copyFileSync(bundledDb, runtimeDb);
}

const db = new sqlite3.Database(runtimeDb);

export function initDb() {
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0
      )
    `);

  db.run(`
    CREATE TABLE IF NOT EXISTS company_content (
      id TEXT PRIMARY KEY,
      overview TEXT,
      summary TEXT,
      prices TEXT,
      financials TEXT,
      news TEXT,
      price_private INTEGER NOT NULL DEFAULT 0,
      ticker TEXT
    )
  `);

  // Backfill new columns if table already existed
  db.run(`ALTER TABLE company_content ADD COLUMN summary TEXT`, () => {});
  db.run(`ALTER TABLE company_content ADD COLUMN price_private INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE company_content ADD COLUMN ticker TEXT`, () => {});

  seedAdmin();
  seedCompanies();
});
}

function seedAdmin() {
  const adminPass = bcrypt.hashSync("password", 10);
  db.run(
    `INSERT OR IGNORE INTO users(username, password_hash, is_admin) VALUES ('admin', ?, 1)`,
    [adminPass]
  );
}

function seedCompanies() {
  const companies = [
    {
      id: "citadel",
      name: "Citadel Securities",
      overview: "Global market maker; equities/options/fixed income.",
      summary: "",
      prices: [32,34,36,33,35],
      pricePrivate: true,
      ticker: "",
      financials: { columns: ["date","revenue","ebitda"], rows: [{ date: "2024-12-31", revenue: 6200, ebitda: 2852 }] },
      news: ["Expanding APAC options franchise."]
    },
    {
      id: "jane",
      name: "Jane Street",
      overview: "Multi-asset liquidity provider with deep research culture.",
      summary: "",
      prices: [22,23,25,26,25],
      pricePrivate: true,
      ticker: "",
      financials: { columns: ["date","revenue","ebitda"], rows: [{ date: "2024-12-31", revenue: 3800, ebitda: 1444 }] },
      news: ["Hiring in digital assets MM."]
    },
    {
      id: "hrt",
      name: "Hudson River Trading",
      overview: "Quant market maker across equities/FX with low-latency infra.",
      summary: "",
      prices: [18,19,19,21,24],
      pricePrivate: true,
      ticker: "",
      financials: { columns: ["date","revenue","ebitda"], rows: [{ date: "2024-12-31", revenue: 1900, ebitda: 665 }] },
      news: ["New microwave routes EU↔US."]
    },
    {
      id: "drw",
      name: "DRW",
      overview: "Diversified principal trading across rates, credit, energy, crypto.",
      summary: "",
      prices: [12,14,13,15,17],
      pricePrivate: true,
      ticker: "",
      financials: { columns: ["date","revenue","ebitda"], rows: [{ date: "2024-12-31", revenue: 2400, ebitda: 792 }] },
      news: ["Scaling energy/power trading footprint."]
    },
    {
      id: "virtu",
      name: "Virtu Financial",
      overview: "Public electronic market maker with equities/ETF focus.",
      summary: "",
      prices: [9,9.5,10,11,10.5],
      pricePrivate: false,
      ticker: "VIRT:NASDAQ",
      financials: { columns: ["date","revenue","ebitda"], rows: [{ date: "2024-12-31", revenue: 3000, ebitda: 900 }] },
      news: ["Expanding analytics suite."]
    },
    {
      id: "flow",
      name: "Flow Traders",
      overview: "European ETF/derivatives liquidity provider.",
      summary: "",
      prices: [7,7.5,8,8.4,8.2],
      pricePrivate: true,
      ticker: "",
      financials: { columns: ["date","revenue","ebitda"], rows: [{ date: "2024-12-31", revenue: 1100, ebitda: 319 }] },
      news: ["Launching FI ETF quoting in NYC."]
    }
  ];

  const companyStmt = db.prepare(`INSERT OR IGNORE INTO companies(id, name) VALUES (?, ?)`);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO company_content(id, overview, summary, prices, financials, news, price_private, ticker)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  companies.forEach((c) => {
    companyStmt.run(c.id, c.name);
    stmt.run(
      c.id,
      c.overview,
      c.summary || "",
      JSON.stringify(c.prices || []),
      JSON.stringify(c.financials || []),
      JSON.stringify(c.news || []),
      c.pricePrivate ? 1 : 0,
      c.ticker || null
    );
  });
  companyStmt.finalize();
  stmt.finalize();
}

export const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

export const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

export const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
