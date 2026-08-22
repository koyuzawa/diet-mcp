-- マルチユーザー化。既存データはすべてユーザー1（オーナー）に引き継ぐ。
-- オーナーの認証は環境のAUTH_TOKEN（管理者トークン）で行うため、
-- ここで生成するtokenはプレースホルダー（使われない）。
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users (id, name, token)
  VALUES (1, 'オーナー', 'unused-admin-' || lower(hex(randomblob(16))));

-- weights: 主キーを (user_id, date) に
CREATE TABLE weights_v2 (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  body_fat_pct REAL,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);
INSERT INTO weights_v2 (user_id, date, weight_kg, body_fat_pct, note, updated_at)
  SELECT 1, date, weight_kg, body_fat_pct, note, updated_at FROM weights;
DROP TABLE weights;
ALTER TABLE weights_v2 RENAME TO weights;

-- meals: user_id列を追加
ALTER TABLE meals ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
DROP INDEX IF EXISTS idx_meals_date;
CREATE INDEX idx_meals_user_date ON meals(user_id, date);

-- goals: 主キーを (user_id, key) に
CREATE TABLE goals_v2 (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
INSERT INTO goals_v2 (user_id, key, value, updated_at)
  SELECT 1, key, value, updated_at FROM goals;
DROP TABLE goals;
ALTER TABLE goals_v2 RENAME TO goals;

-- habit_logs: 主キーを (habit_id, user_id, date) に
CREATE TABLE habit_logs_v2 (
  habit_id INTEGER NOT NULL REFERENCES habits(id),
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (habit_id, user_id, date)
);
INSERT INTO habit_logs_v2 (habit_id, user_id, date, created_at)
  SELECT habit_id, 1, date, created_at FROM habit_logs;
DROP TABLE habit_logs;
ALTER TABLE habit_logs_v2 RENAME TO habit_logs;
