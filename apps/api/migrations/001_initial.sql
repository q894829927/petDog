CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE pets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  personality TEXT NOT NULL CHECK (personality IN ('playful', 'affectionate', 'reserved')),
  adopted_at INTEGER NOT NULL,
  hunger REAL NOT NULL DEFAULT 76 CHECK (hunger BETWEEN 0 AND 100),
  hydration REAL NOT NULL DEFAULT 84 CHECK (hydration BETWEEN 0 AND 100),
  energy REAL NOT NULL DEFAULT 62 CHECK (energy BETWEEN 0 AND 100),
  cleanliness REAL NOT NULL DEFAULT 93 CHECK (cleanliness BETWEEN 0 AND 100),
  happiness REAL NOT NULL DEFAULT 70 CHECK (happiness BETWEEN 0 AND 100),
  affection REAL NOT NULL DEFAULT 0 CHECK (affection BETWEEN 0 AND 100),
  sleeping INTEGER NOT NULL DEFAULT 0 CHECK (sleeping IN (0, 1)),
  last_simulated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE pet_actions (
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pet_id, request_id)
) STRICT;
