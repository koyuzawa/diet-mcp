import type {
  DayTotals,
  Env,
  ExerciseRow,
  Goals,
  MealRow,
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

export async function upsertWeight(
  db: D1Database,
  w: { date: string; weight_kg: number; body_fat_pct?: number; note?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO weights (date, weight_kg, body_fat_pct, note)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(date) DO UPDATE SET
         weight_kg = excluded.weight_kg,
         body_fat_pct = COALESCE(excluded.body_fat_pct, weights.body_fat_pct),
         note = COALESCE(excluded.note, weights.note),
         updated_at = datetime('now')`,
    )
    .bind(w.date, w.weight_kg, w.body_fat_pct ?? null, w.note ?? null)
    .run();
}

export async function insertMeal(
  db: D1Database,
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
      `INSERT INTO meals (date, meal_type, name, calories, protein_g, fat_g, carbs_g, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
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

export async function insertExercise(
  db: D1Database,
  e: {
    date: string;
    name: string;
    duration_min?: number;
    calories_burned?: number;
    note?: string;
  },
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO exercises (date, name, duration_min, calories_burned, note)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(
      e.date,
      e.name,
      e.duration_min ?? null,
      e.calories_burned ?? null,
      e.note ?? null,
    )
    .run();
  return Number(res.meta.last_row_id);
}

export async function setGoals(db: D1Database, goals: Goals): Promise<Goals> {
  const stmt = db.prepare(
    `INSERT INTO goals (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  const entries = Object.entries(goals).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v),
  );
  if (entries.length > 0) {
    await db.batch(entries.map(([k, v]) => stmt.bind(k, v)));
  }
  return getGoals(db);
}

export async function getGoals(db: D1Database): Promise<Goals> {
  const { results } = await db
    .prepare(`SELECT key, value FROM goals`)
    .all<{ key: string; value: number }>();
  const goals: Record<string, number> = {};
  for (const row of results) goals[row.key] = row.value;
  return goals as Goals;
}

export async function getSummary(
  db: D1Database,
  todayStr: string,
  days: number,
): Promise<Summary> {
  const start = addDays(todayStr, -(days - 1));

  const [goals, latest, weights, mealTotals, exTotals, todayMeals, todayExercises] =
    await Promise.all([
      getGoals(db),
      db
        .prepare(
          `SELECT date, weight_kg, body_fat_pct, note FROM weights ORDER BY date DESC LIMIT 1`,
        )
        .first<WeightRow>(),
      db
        .prepare(
          `SELECT date, weight_kg, body_fat_pct, note FROM weights
           WHERE date >= ?1 AND date <= ?2 ORDER BY date`,
        )
        .bind(start, todayStr)
        .all<WeightRow>(),
      db
        .prepare(
          `SELECT date, SUM(calories) AS calories_in, SUM(protein_g) AS protein_g,
                  SUM(fat_g) AS fat_g, SUM(carbs_g) AS carbs_g, COUNT(*) AS meal_count
           FROM meals WHERE date >= ?1 AND date <= ?2 GROUP BY date`,
        )
        .bind(start, todayStr)
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
          `SELECT date, SUM(calories_burned) AS calories_burned
           FROM exercises WHERE date >= ?1 AND date <= ?2 GROUP BY date`,
        )
        .bind(start, todayStr)
        .all<{ date: string; calories_burned: number | null }>(),
      db
        .prepare(
          `SELECT id, date, meal_type, name, calories, protein_g, fat_g, carbs_g, note
           FROM meals WHERE date = ?1 ORDER BY id`,
        )
        .bind(todayStr)
        .all<MealRow>(),
      db
        .prepare(
          `SELECT id, date, name, duration_min, calories_burned, note
           FROM exercises WHERE date = ?1 ORDER BY id`,
        )
        .bind(todayStr)
        .all<ExerciseRow>(),
    ]);

  const mealsByDate = new Map(mealTotals.results.map((r) => [r.date, r]));
  const exByDate = new Map(exTotals.results.map((r) => [r.date, r]));

  const daily: DayTotals[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const m = mealsByDate.get(date);
    const e = exByDate.get(date);
    daily.push({
      date,
      calories_in: m?.calories_in ?? null,
      protein_g: m?.protein_g ?? null,
      fat_g: m?.fat_g ?? null,
      carbs_g: m?.carbs_g ?? null,
      calories_burned: e?.calories_burned ?? null,
      meal_count: m?.meal_count ?? 0,
    });
  }

  return {
    today: todayStr,
    days,
    goals,
    latest_weight: latest ?? null,
    weights: weights.results,
    daily,
    today_meals: todayMeals.results,
    today_exercises: todayExercises.results,
  };
}

export async function listDay(
  db: D1Database,
  date: string,
): Promise<{ date: string; weight: WeightRow | null; meals: MealRow[]; exercises: ExerciseRow[] }> {
  const [weight, meals, exercises] = await Promise.all([
    db
      .prepare(`SELECT date, weight_kg, body_fat_pct, note FROM weights WHERE date = ?1`)
      .bind(date)
      .first<WeightRow>(),
    db
      .prepare(
        `SELECT id, date, meal_type, name, calories, protein_g, fat_g, carbs_g, note
         FROM meals WHERE date = ?1 ORDER BY id`,
      )
      .bind(date)
      .all<MealRow>(),
    db
      .prepare(
        `SELECT id, date, name, duration_min, calories_burned, note
         FROM exercises WHERE date = ?1 ORDER BY id`,
      )
      .bind(date)
      .all<ExerciseRow>(),
  ]);
  return {
    date,
    weight: weight ?? null,
    meals: meals.results,
    exercises: exercises.results,
  };
}

export async function deleteEntry(
  db: D1Database,
  type: "meal" | "exercise" | "weight",
  opts: { id?: number; date?: string },
): Promise<number> {
  let res: D1Result;
  if (type === "meal") {
    if (opts.id === undefined) throw new Error("mealの削除にはidが必要です");
    res = await db.prepare(`DELETE FROM meals WHERE id = ?1`).bind(opts.id).run();
  } else if (type === "exercise") {
    if (opts.id === undefined) throw new Error("exerciseの削除にはidが必要です");
    res = await db.prepare(`DELETE FROM exercises WHERE id = ?1`).bind(opts.id).run();
  } else {
    if (!opts.date) throw new Error("weightの削除にはdateが必要です");
    res = await db.prepare(`DELETE FROM weights WHERE date = ?1`).bind(opts.date).run();
  }
  return res.meta.changes ?? 0;
}
