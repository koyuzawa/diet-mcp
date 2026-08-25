import type {
  AuthUser,
  DayTotals,
  Env,
  Goals,
  HabitSummary,
  MealRow,
  Ranking,
  RankingEntry,
  Summary,
  WeightRow,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function tzOffsetHours(env: Env): number {
  const n = Number(env.TZ_OFFSET_HOURS ?? "9");
  return Number.isFinite(n) ? n : 9;
}

export function today(env: Env): string {
  return new Date(Date.now() + tzOffsetHours(env) * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

export function normalizeDate(env: Env, date: unknown): string {
  if (date === undefined || date === null || date === "" || date === "today") {
    return today(env);
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    throw new Error(`日付は YYYY-MM-DD 形式で指定してください: ${String(date)}`);
  }
  return date;
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/* ---------- ユーザー ---------- */

export async function findUserByToken(
  db: D1Database,
  token: string,
): Promise<AuthUser | null> {
  const row = await db
    .prepare(`SELECT id, name FROM users WHERE token = ?1`)
    .bind(token)
    .first<{ id: number; name: string }>();
  return row ? { id: row.id, name: row.name, admin: false } : null;
}

export async function getAdminUser(db: D1Database): Promise<AuthUser> {
  const row = await db
    .prepare(`SELECT id, name FROM users WHERE id = 1`)
    .first<{ id: number; name: string }>();
  return { id: 1, name: row?.name ?? "オーナー", admin: true };
}

export async function createUser(
  db: D1Database,
  name: string,
): Promise<{ id: number; token: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名前(name)は必須です");
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const res = await db
    .prepare(`INSERT INTO users (name, token) VALUES (?1, ?2)`)
    .bind(trimmed, token)
    .run();
  return { id: Number(res.meta.last_row_id), token };
}

/** ClaudeセッションのURLを保存する（nullで削除）。https:// のURLのみ許可 */
export async function setSessionUrl(
  db: D1Database,
  userId: number,
  url: string | null,
): Promise<void> {
  if (url !== null) {
    const trimmed = url.trim();
    if (!/^https:\/\/[^\s]+$/.test(trimmed) || trimmed.length > 500) {
      throw new Error("URLは https:// で始まる有効なURLを指定してください");
    }
    url = trimmed;
  }
  await db.prepare(`UPDATE users SET session_url = ?1 WHERE id = ?2`).bind(url, userId).run();
}

export async function getSessionUrl(db: D1Database, userId: number): Promise<string | null> {
  const row = await db
    .prepare(`SELECT session_url FROM users WHERE id = ?1`)
    .bind(userId)
    .first<{ session_url: string | null }>();
  return row?.session_url ?? null;
}

export async function renameUser(
  db: D1Database,
  userId: number,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名前(name)は必須です");
  await db.prepare(`UPDATE users SET name = ?1 WHERE id = ?2`).bind(trimmed, userId).run();
}

export async function listUsers(
  db: D1Database,
): Promise<{ id: number; name: string; created_at: string }[]> {
  const { results } = await db
    .prepare(`SELECT id, name, created_at FROM users ORDER BY id`)
    .all<{ id: number; name: string; created_at: string }>();
  return results;
}

/* ---------- 記録 ---------- */

export async function upsertWeight(
  db: D1Database,
  userId: number,
  w: { date: string; weight_kg: number; body_fat_pct?: number; note?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO weights (user_id, date, weight_kg, body_fat_pct, note)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id, date) DO UPDATE SET
         weight_kg = excluded.weight_kg,
         body_fat_pct = COALESCE(excluded.body_fat_pct, weights.body_fat_pct),
         note = COALESCE(excluded.note, weights.note),
         updated_at = datetime('now')`,
    )
    .bind(userId, w.date, w.weight_kg, w.body_fat_pct ?? null, w.note ?? null)
    .run();
}

export async function insertMeal(
  db: D1Database,
  userId: number,
  m: {
    date: string;
    meal_type: string;
    name: string;
    calories: number;
    protein_g?: number;
    fat_g?: number;
    carbs_g?: number;
    note?: string;
  },
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO meals (user_id, date, meal_type, name, calories, protein_g, fat_g, carbs_g, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      userId,
      m.date,
      m.meal_type,
      m.name,
      m.calories,
      m.protein_g ?? null,
      m.fat_g ?? null,
      m.carbs_g ?? null,
      m.note ?? null,
    )
    .run();
  return Number(res.meta.last_row_id);
}

export async function setGoals(
  db: D1Database,
  userId: number,
  goals: Goals,
): Promise<Goals> {
  const stmt = db.prepare(
    `INSERT INTO goals (user_id, key, value) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  const entries = Object.entries(goals).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v),
  );
  if (entries.length > 0) {
    await db.batch(entries.map(([k, v]) => stmt.bind(userId, k, v)));
  }
  return getGoals(db, userId);
}

export async function getGoals(db: D1Database, userId: number): Promise<Goals> {
  const { results } = await db
    .prepare(`SELECT key, value FROM goals WHERE user_id = ?1`)
    .bind(userId)
    .all<{ key: string; value: number }>();
  const goals: Record<string, number> = {};
  for (const row of results) goals[row.key] = row.value;
  return goals as Goals;
}

/* ---------- 習慣 ---------- */

export async function logHabit(
  db: D1Database,
  userId: number,
  name: string,
  date: string,
  done: boolean,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("習慣名(name)は必須です");
  const habit = await db
    .prepare(`SELECT id FROM habits WHERE name = ?1 AND archived = 0`)
    .bind(trimmed)
    .first<{ id: number }>();
  if (!habit) {
    const { results } = await db
      .prepare(`SELECT name FROM habits WHERE archived = 0 ORDER BY id`)
      .all<{ name: string }>();
    const available = results.map((r) => `「${r.name}」`).join("、") || "（なし）";
    throw new Error(`習慣「${trimmed}」は追跡対象ではありません。記録できる習慣: ${available}`);
  }
  if (done) {
    await db
      .prepare(`INSERT OR IGNORE INTO habit_logs (habit_id, user_id, date) VALUES (?1, ?2, ?3)`)
      .bind(habit.id, userId, date)
      .run();
  } else {
    await db
      .prepare(`DELETE FROM habit_logs WHERE habit_id = ?1 AND user_id = ?2 AND date = ?3`)
      .bind(habit.id, userId, date)
      .run();
  }
}

function calcStreak(done: Set<string>, todayStr: string): number {
  let cursor = done.has(todayStr) ? todayStr : addDays(todayStr, -1);
  let streak = 0;
  while (done.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

async function getHabitSummaries(
  db: D1Database,
  userId: number,
  todayStr: string,
  rangeStart: string,
): Promise<HabitSummary[]> {
  const habits = await db
    .prepare(`SELECT id, name FROM habits WHERE archived = 0 ORDER BY id`)
    .all<{ id: number; name: string }>();
  if (habits.results.length === 0) return [];
  const logs = await db
    .prepare(
      `SELECT habit_id, date FROM habit_logs
       WHERE user_id = ?1 AND date >= ?2 AND date <= ?3`,
    )
    .bind(userId, addDays(todayStr, -365), todayStr)
    .all<{ habit_id: number; date: string }>();
  const byHabit = new Map<number, Set<string>>();
  for (const row of logs.results) {
    let set = byHabit.get(row.habit_id);
    if (!set) byHabit.set(row.habit_id, (set = new Set()));
    set.add(row.date);
  }
  return habits.results.map((habit) => {
    const done = byHabit.get(habit.id) ?? new Set<string>();
    return {
      id: habit.id,
      name: habit.name,
      streak: calcStreak(done, todayStr),
      done_today: done.has(todayStr),
      dates: [...done].filter((d) => d >= rangeStart).sort(),
    };
  });
}

/* ---------- サマリー ---------- */

export async function getSummary(
  db: D1Database,
  user: { id: number; name: string },
  todayStr: string,
  days: number,
): Promise<Summary> {
  const start = addDays(todayStr, -(days - 1));

  const [goals, latest, weights, mealTotals, todayMeals, habits, sessionUrl] = await Promise.all([
    getGoals(db, user.id),
    db
      .prepare(
        `SELECT date, weight_kg, body_fat_pct, note FROM weights
         WHERE user_id = ?1 ORDER BY date DESC LIMIT 1`,
      )
      .bind(user.id)
      .first<WeightRow>(),
    db
      .prepare(
        `SELECT date, weight_kg, body_fat_pct, note FROM weights
         WHERE user_id = ?1 AND date >= ?2 AND date <= ?3 ORDER BY date`,
      )
      .bind(user.id, start, todayStr)
      .all<WeightRow>(),
    db
      .prepare(
        `SELECT date, SUM(calories) AS calories_in, SUM(protein_g) AS protein_g,
                SUM(fat_g) AS fat_g, SUM(carbs_g) AS carbs_g, COUNT(*) AS meal_count
         FROM meals WHERE user_id = ?1 AND date >= ?2 AND date <= ?3 GROUP BY date`,
      )
      .bind(user.id, start, todayStr)
      .all<{
        date: string;
        calories_in: number;
        protein_g: number | null;
        fat_g: number | null;
        carbs_g: number | null;
        meal_count: number;
      }>(),
    db
      .prepare(
        `SELECT id, date, meal_type, name, calories, protein_g, fat_g, carbs_g, note
         FROM meals WHERE user_id = ?1 AND date = ?2 ORDER BY id`,
      )
      .bind(user.id, todayStr)
      .all<MealRow>(),
    getHabitSummaries(db, user.id, todayStr, start),
    getSessionUrl(db, user.id),
  ]);

  const mealsByDate = new Map(mealTotals.results.map((r) => [r.date, r]));

  const daily: DayTotals[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const m = mealsByDate.get(date);
    daily.push({
      date,
      calories_in: m?.calories_in ?? null,
      protein_g: m?.protein_g ?? null,
      fat_g: m?.fat_g ?? null,
      carbs_g: m?.carbs_g ?? null,
      meal_count: m?.meal_count ?? 0,
    });
  }

  return {
    today: todayStr,
    days,
    user: { id: user.id, name: user.name, session_url: sessionUrl },
    goals,
    latest_weight: latest ?? null,
    weights: weights.results,
    daily,
    today_meals: todayMeals.results,
    habits,
  };
}

export async function listDay(
  db: D1Database,
  userId: number,
  date: string,
): Promise<{ date: string; weight: WeightRow | null; meals: MealRow[] }> {
  const [weight, meals] = await Promise.all([
    db
      .prepare(
        `SELECT date, weight_kg, body_fat_pct, note FROM weights
         WHERE user_id = ?1 AND date = ?2`,
      )
      .bind(userId, date)
      .first<WeightRow>(),
    db
      .prepare(
        `SELECT id, date, meal_type, name, calories, protein_g, fat_g, carbs_g, note
         FROM meals WHERE user_id = ?1 AND date = ?2 ORDER BY id`,
      )
      .bind(userId, date)
      .all<MealRow>(),
  ]);
  return {
    date,
    weight: weight ?? null,
    meals: meals.results,
  };
}

export async function deleteEntry(
  db: D1Database,
  userId: number,
  type: "meal" | "weight",
  opts: { id?: number; date?: string },
): Promise<number> {
  let res: D1Result;
  if (type === "meal") {
    if (opts.id === undefined) throw new Error("mealの削除にはidが必要です");
    res = await db
      .prepare(`DELETE FROM meals WHERE id = ?1 AND user_id = ?2`)
      .bind(opts.id, userId)
      .run();
  } else {
    if (!opts.date) throw new Error("weightの削除にはdateが必要です");
    res = await db
      .prepare(`DELETE FROM weights WHERE user_id = ?1 AND date = ?2`)
      .bind(userId, opts.date)
      .run();
  }
  return res.meta.changes ?? 0;
}

/* ---------- ランキング ---------- */

export async function getRanking(
  db: D1Database,
  todayStr: string,
  days: number,
): Promise<Ranking> {
  const start = addDays(todayStr, -(days - 1));

  const [users, weightRows, mealDays, calorieTargets, kintore, lastRecords] = await Promise.all([
    listUsers(db),
    db
      .prepare(
        `SELECT user_id, date, weight_kg FROM weights
         WHERE date >= ?1 AND date <= ?2 ORDER BY user_id, date`,
      )
      .bind(start, todayStr)
      .all<{ user_id: number; date: string; weight_kg: number }>(),
    db
      .prepare(
        `SELECT user_id, date, SUM(calories) AS calories_in
         FROM meals WHERE date >= ?1 AND date <= ?2 GROUP BY user_id, date`,
      )
      .bind(start, todayStr)
      .all<{ user_id: number; date: string; calories_in: number }>(),
    db
      .prepare(`SELECT user_id, value FROM goals WHERE key = 'daily_calorie_target'`)
      .all<{ user_id: number; value: number }>(),
    db
      .prepare(
        `SELECT hl.user_id, hl.date FROM habit_logs hl
         JOIN habits h ON h.id = hl.habit_id
         WHERE h.name = '筋トレ' AND hl.date >= ?1 AND hl.date <= ?2`,
      )
      .bind(addDays(todayStr, -365), todayStr)
      .all<{ user_id: number; date: string }>(),
    db
      .prepare(
        `SELECT user_id, MAX(date) AS last_date FROM (
           SELECT user_id, date FROM weights
           UNION ALL SELECT user_id, date FROM meals
           UNION ALL SELECT user_id, date FROM habit_logs
         ) WHERE date <= ?1 GROUP BY user_id`,
      )
      .bind(todayStr)
      .all<{ user_id: number; last_date: string }>(),
  ]);

  const weightsByUser = new Map<number, { date: string; weight_kg: number }[]>();
  for (const row of weightRows.results) {
    let list = weightsByUser.get(row.user_id);
    if (!list) weightsByUser.set(row.user_id, (list = []));
    list.push(row);
  }
  const targetByUser = new Map(calorieTargets.results.map((r) => [r.user_id, r.value]));
  const mealsByUser = new Map<number, { date: string; calories_in: number }[]>();
  for (const row of mealDays.results) {
    let list = mealsByUser.get(row.user_id);
    if (!list) mealsByUser.set(row.user_id, (list = []));
    list.push(row);
  }
  const kintoreByUser = new Map<number, Set<string>>();
  for (const row of kintore.results) {
    let set = kintoreByUser.get(row.user_id);
    if (!set) kintoreByUser.set(row.user_id, (set = new Set()));
    set.add(row.date);
  }
  const lastByUser = new Map(lastRecords.results.map((r) => [r.user_id, r.last_date]));
  const dayDiff = (from: string, to: string) =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

  const entries: RankingEntry[] = users.map((user) => {
    const weights = weightsByUser.get(user.id) ?? [];
    const first = weights[0];
    const last = weights[weights.length - 1];
    const hasChange = weights.length >= 2 && first.weight_kg > 0;
    const change = hasChange
      ? ((last.weight_kg - first.weight_kg) / first.weight_kg) * 100
      : null;

    const target = targetByUser.get(user.id);
    const dayList = mealsByUser.get(user.id) ?? [];
    const within =
      target === undefined
        ? 0
        : dayList.filter((d) => d.calories_in <= target).length;
    const adherence =
      target === undefined || dayList.length === 0
        ? null
        : (within / dayList.length) * 100;

    const kintoreSet = kintoreByUser.get(user.id) ?? new Set<string>();
    const kintoreInRange = [...kintoreSet].filter((d) => d >= start).length;

    return {
      user_id: user.id,
      name: user.name,
      weight_change_pct: change === null ? null : Math.round(change * 100) / 100,
      calorie_days_recorded: dayList.length,
      calorie_days_within: target === undefined ? 0 : within,
      calorie_adherence_pct: adherence === null ? null : Math.round(adherence),
      kintore_count: kintoreInRange,
      kintore_streak: calcStreak(kintoreSet, todayStr),
      last_record_date: lastByUser.get(user.id) ?? null,
      days_since_record:
        lastByUser.get(user.id) !== undefined
          ? dayDiff(lastByUser.get(user.id) as string, todayStr)
          : null,
    };
  });

  return { days, entries };
}
