// db.js — Postgres connection + schema setup.
// Using a hosted Postgres database (e.g. free Neon) means data survives
// Render restarts without needing a paid persistent disk — the database
// lives outside Render entirely.
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL environment variable is not set. See .env.example.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  // Most free Postgres hosts (Neon, Supabase, Render's own Postgres) require SSL.
  ssl: { rejectUnauthorized: false }
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','manager','employee')),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      public_id TEXT UNIQUE NOT NULL,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL DEFAULT 'Hotel Account',
      amount NUMERIC NOT NULL DEFAULT 0,
      bank TEXT NOT NULL DEFAULT 'Unknown',
      category TEXT NOT NULL DEFAULT 'Miscellaneous',
      date DATE NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      image_data TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_tx_created_by ON transactions(created_by);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
  `);
}

module.exports = { pool, initSchema };
