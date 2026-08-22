-- 習慣（運動した/しない などのチェック式トラッキング）
CREATE TABLE habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 達成記録（行があれば達成、なければ未達成）
CREATE TABLE habit_logs (
  habit_id INTEGER NOT NULL REFERENCES habits(id),
  date TEXT NOT NULL, -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (habit_id, date)
);
