export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 設定するとMCP・APIにBearerトークン認証がかかる（wrangler secret put AUTH_TOKEN） */
  AUTH_TOKEN?: string;
  /** 「今日」を決めるタイムゾーンのUTCオフセット（時間）。既定は9（日本時間） */
  TZ_OFFSET_HOURS?: string;
}

export interface AuthUser {
  id: number;
  name: string;
  admin: boolean;
}

export interface RankingEntry {
  user_id: number;
  name: string;
  /** 体重変化率(%)。実数値(kg)はプライバシーのためランキングには含めない */
  weight_change_pct: number | null;
  /** カロリー目標達成率: 記録がある日のうち目標以内だった日の割合（目標未設定ならnull） */
  calorie_days_recorded: number;
  calorie_days_within: number;
  calorie_adherence_pct: number | null;
  /** 筋トレ: 期間内の回数と現在の連続日数 */
  kintore_count: number;
  kintore_streak: number;
  /** 最終記録日（体重・食事・習慣のいずれか）。一度も記録がなければnull */
  last_record_date: string | null;
  /** 最終記録からの経過日数（0=今日記録済み）。一度も記録がなければnull */
  days_since_record: number | null;
}

export interface Ranking {
  days: number;
  entries: RankingEntry[];
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
  user: { id: number; name: string };
  goals: Goals;
  latest_weight: WeightRow | null;
  weights: WeightRow[];
  daily: DayTotals[];
  today_meals: MealRow[];
  habits: HabitSummary[];
}
