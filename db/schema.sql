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
