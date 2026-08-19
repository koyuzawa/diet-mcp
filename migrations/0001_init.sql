-- 体重の記録（1日1件、上書き更新）
CREATE TABLE weights (
  date TEXT PRIMARY KEY, -- YYYY-MM-DD
  weight_kg REAL NOT NULL,
  body_fat_pct REAL,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 食事の記録
CREATE TABLE meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, -- YYYY-MM-DD
  meal_type TEXT NOT NULL DEFAULT 'other', -- breakfast / lunch / dinner / snack / other
  name TEXT NOT NULL,
  calories REAL NOT NULL,
  protein_g REAL,
  fat_g REAL,
  carbs_g REAL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meals_date ON meals(date);

-- 運動の記録
CREATE TABLE exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, -- YYYY-MM-DD
  name TEXT NOT NULL,
  duration_min REAL,
  calories_burned REAL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_exercises_date ON exercises(date);

-- 目標値（key-value）
CREATE TABLE goals (
  key TEXT PRIMARY KEY, -- target_weight_kg / daily_calorie_target / daily_protein_target_g
  value REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
