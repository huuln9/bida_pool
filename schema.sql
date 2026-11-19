-- Chạy 1 lần khi tạo database (dán vào tab Console của D1 trên Cloudflare).
CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  note       TEXT,
  color      TEXT,                      -- màu đại diện #rrggbb (NULL = mặc định)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- DB đã tạo từ trước: chạy 1 lần để thêm cột màu
-- ALTER TABLE players ADD COLUMN color TEXT;

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

-- Ảnh đại diện cơ thủ (base64), admin cập nhật trong tab Cơ thủ.
CREATE TABLE IF NOT EXISTS avatars (player_id INTEGER PRIMARY KEY REFERENCES players(id), mime TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));

-- Người đã mở app từ Telegram (chỉ admin xem).
CREATE TABLE IF NOT EXISTS visitors (tg_id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, username TEXT, photo_url TEXT, visits INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')));
