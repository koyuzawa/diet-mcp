export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 設定するとMCP・APIにBearerトークン認証がかかる（wrangler secret put AUTH_TOKEN） */
  AUTH_TOKEN?: string;
  /** 「今日」を決めるタイムゾーンのUTCオフセット（時間）。既定は9（日本時間） */
  TZ_OFFSET_HOURS?: string;
}

export interface WeightRow {
  date: string;
  weight_kg: number;
  body_fat_pct: number | null;
  note: string | null;
}

export interface MealRow {
  id: number;
  date: string;
  meal_type: string;
  name: string;
  calories: number;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  note: string | null;
}

export interface ExerciseRow {
  id: number;
  date: string;
  name: string;
  duration_min: number | null;
  calories_burned: number | null;
  note: string | null;
}

export interface Goals {
  target_weight_kg?: number;
  daily_calorie_target?: number;
  daily_protein_target_g?: number;
}

export interface DayTotals {
  date: string;
  calories_in: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  calories_burned: number | null;
  meal_count: number;
}

export interface HabitSummary {
  id: number;
  name: string;
  /** 連続達成日数（今日が未達成でも昨日までの連続を数える） */
  streak: number;
  done_today: boolean;
  /** サマリー期間内で達成した日付 */
  dates: string[];
}

export interface Summary {
  today: string;
  days: number;
  goals: Goals;
  latest_weight: WeightRow | null;
  weights: WeightRow[];
  daily: DayTotals[];
  today_meals: MealRow[];
  today_exercises: ExerciseRow[];
  habits: HabitSummary[];
}
