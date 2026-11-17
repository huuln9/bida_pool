-- Chạy 1 lần khi tạo database (dán vào tab Console của D1 trên Cloudflare).
CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,             -- YYYY-MM-DD
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- type = LEAGUE: rank để NULL, app tự tính theo số trận thắng.
-- type = CUP: rank nhập tay (1 = vô địch).
CREATE TABLE IF NOT EXISTS results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  type       TEXT NOT NULL CHECK (type IN ('LEAGUE', 'CUP')),
  win        INTEGER NOT NULL DEFAULT 0 CHECK (win >= 0),
  lose       INTEGER NOT NULL DEFAULT 0 CHECK (lose >= 0),
  rank       INTEGER,
  UNIQUE (session_id, player_id, type)
);

CREATE INDEX IF NOT EXISTS idx_results_session ON results(session_id);
