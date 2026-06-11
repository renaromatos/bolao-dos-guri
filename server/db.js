const { Pool } = require("pg");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  home_score INTEGER NOT NULL CHECK (home_score >= 0 AND home_score <= 30),
  away_score INTEGER NOT NULL CHECK (away_score >= 0 AND away_score <= 30),
  penalty_winner TEXT CHECK (penalty_winner IN ('home', 'away') OR penalty_winner IS NULL),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, match_id)
);

CREATE TABLE IF NOT EXISTS results (
  match_id TEXT PRIMARY KEY,
  home_score INTEGER NOT NULL CHECK (home_score >= 0 AND home_score <= 30),
  away_score INTEGER NOT NULL CHECK (away_score >= 0 AND away_score <= 30),
  penalty_winner TEXT CHECK (penalty_winner IN ('home', 'away') OR penalty_winner IS NULL),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS predictions_match_id_idx ON predictions (match_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
`;

let pool;
let schemaReady;

function getPool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!connectionString) {
    throw Object.assign(new Error("DATABASE_URL/POSTGRES_URL não configurada."), {
      publicMessage: "DATABASE_URL ou POSTGRES_URL não configurada.",
      statusCode: 500,
    });
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: process.env.POSTGRES_DISABLE_SSL === "true" ? false : { rejectUnauthorized: false },
    });
  }

  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(SCHEMA_SQL).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

async function query(text, params = []) {
  await ensureSchema();
  return getPool().query(text, params);
}

module.exports = {
  query,
};
