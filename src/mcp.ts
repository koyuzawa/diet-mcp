import {
  createUser,
  deleteEntry,
  setSessionUrl,
  getRanking,
  getSummary,
  insertMeal,
  listDay,
  listUsers,
  logHabit,
  normalizeDate,
  renameUser,
  setGoals,
  today,
  upsertWeight,
} from "./data";
import type { AuthUser, Env, Goals } from "./types";

const SERVER_INFO = { name: "diet-mcp", version: "0.3.0" };
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const INSTRUCTIONS = [
  "ダイエット（体重・食事・習慣）記録用のマルチユーザーMCPサーバーです。記録は接続トークンに紐づくユーザーのものになります。",
  "ユーザーがダイエットセッション中に体重・食べたものを口にしたら、対応するツールでこまめに記録してください。",
  "食事はカロリーが分からなければ一般的な値を推定して calories に入れ、note にその旨を書いてください。",
  "習慣トラッカーもあります（共通の固定セット。現在は「筋トレ」のみ）。ユーザーが筋トレをしたと言ったら log_habit でチェックしてください。",
  "get_ranking でユーザー間のランキング（体重変化率・カロリー目標達成率・筋トレ）が見られます。days_since_record が2以上のユーザーは記録をサボっています。ランキングの話題のときは、サボっている人を軽くいじって発破をかけてください（悪意のない言い方で）。",
  "記録はダッシュボード（このサーバーのルートURL）に即時反映されます。",
].join("\n");

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (env: Env, user: AuthUser, args: Record<string, unknown>) => Promise<string>;
}

const dateProp = {
  type: "string",
  description: "記録日 (YYYY-MM-DD)。省略時は今日（日本時間）",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
};

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${key} は数値で指定してください`);
  return n;
}

function requireNum(args: Record<string, unknown>, key: string): number {
  const n = num(args, key);
  if (n === undefined) throw new Error(`${key} は必須です`);
  return n;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  return String(v);
}

function requireStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key);
  if (v === undefined || v === "") throw new Error(`${key} は必須です`);
  return v;
}

const TOOLS: ToolDef[] = [
  {
    name: "log_weight",
    description:
      "体重を記録する（同じ日付は上書き）。体脂肪率も一緒に記録できる。ユーザーが体重を報告したら必ずこれで記録する。",
    inputSchema: {
      type: "object",
      properties: {
        date: dateProp,
        weight_kg: { type: "number", description: "体重 (kg)" },
        body_fat_pct: { type: "number", description: "体脂肪率 (%)（任意）" },
        note: { type: "string", description: "メモ（任意）" },
      },
      required: ["weight_kg"],
    },
    handler: async (env, user, args) => {
      const date = normalizeDate(env, args.date);
      const weight_kg = requireNum(args, "weight_kg");
      await upsertWeight(env.DB, user.id, {
        date,
        weight_kg,
        body_fat_pct: num(args, "body_fat_pct"),
        note: str(args, "note"),
      });
      return `${date} の体重を ${weight_kg}kg で記録しました。`;
    },
  },
  {
    name: "log_meal",
    description:
      "食事を記録する。カロリー(kcal)は必須。分からなければ一般的な値を推定して入れ、noteに推定と書く。PFC（たんぱく質・脂質・炭水化物、g）も分かれば入れる。",
    inputSchema: {
      type: "object",
      properties: {
        date: dateProp,
        meal_type: {
          type: "string",
          enum: ["breakfast", "lunch", "dinner", "snack", "other"],
          description: "食事の区分。朝食=breakfast 昼食=lunch 夕食=dinner 間食=snack",
        },
        name: { type: "string", description: "食事の内容（例: 鶏むね肉のサラダ）" },
        calories: { type: "number", description: "カロリー (kcal)" },
        protein_g: { type: "number", description: "たんぱく質 (g)（任意）" },
        fat_g: { type: "number", description: "脂質 (g)（任意）" },
        carbs_g: { type: "number", description: "炭水化物 (g)（任意）" },
        note: { type: "string", description: "メモ（任意）" },
      },
      required: ["name", "calories"],
    },
    handler: async (env, user, args) => {
      const date = normalizeDate(env, args.date);
      const name = requireStr(args, "name");
      const calories = requireNum(args, "calories");
      const id = await insertMeal(env.DB, user.id, {
        date,
        meal_type: str(args, "meal_type") ?? "other",
        name,
        calories,
        protein_g: num(args, "protein_g"),
        fat_g: num(args, "fat_g"),
        carbs_g: num(args, "carbs_g"),
        note: str(args, "note"),
      });
      return `${date} の食事「${name}」(${calories}kcal) を記録しました (id: ${id})。`;
    },
  },
  {
    name: "log_habit",
    description:
      "習慣の達成をチェックする。習慣は共通の固定セットで、現在は「筋トレ」のみ。ユーザーが筋トレをしたと言ったら呼ぶ。done=false でチェックの取り消し。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", enum: ["筋トレ"], description: "習慣名" },
        date: dateProp,
        done: { type: "boolean", description: "達成ならtrue（既定）。falseで取り消し" },
      },
      required: ["name"],
    },
    handler: async (env, user, args) => {
      const date = normalizeDate(env, args.date);
      const name = requireStr(args, "name");
      const done = args.done === undefined ? true : Boolean(args.done);
      await logHabit(env.DB, user.id, name, date, done);
      return done
        ? `${date} の「${name}」を達成として記録しました。`
        : `${date} の「${name}」のチェックを取り消しました。`;
    },
  },
  {
    name: "set_goals",
    description:
      "目標を設定する（指定した項目だけ更新）。目標体重・1日の摂取カロリー目標・1日のたんぱく質目標。",
    inputSchema: {
      type: "object",
      properties: {
        target_weight_kg: { type: "number", description: "目標体重 (kg)" },
        daily_calorie_target: { type: "number", description: "1日の摂取カロリー目標 (kcal)" },
        daily_protein_target_g: { type: "number", description: "1日のたんぱく質目標 (g)" },
      },
    },
    handler: async (env, user, args) => {
      const goals: Goals = {
        target_weight_kg: num(args, "target_weight_kg"),
        daily_calorie_target: num(args, "daily_calorie_target"),
        daily_protein_target_g: num(args, "daily_protein_target_g"),
      };
      const updated = await setGoals(env.DB, user.id, goals);
      return `目標を更新しました:\n${JSON.stringify(updated, null, 2)}`;
    },
  },
  {
    name: "get_summary",
    description:
      "自分の直近の記録のサマリーを取得する（体重推移・日別カロリー/PFC・目標・習慣・今日の食事）。セッション開始時に呼んで状況を把握するとよい。",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description: "何日分さかのぼるか（既定14）",
        },
      },
    },
    handler: async (env, user, args) => {
      const days = Math.min(90, Math.max(1, num(args, "days") ?? 14));
      const summary = await getSummary(env.DB, user, today(env), days);
      return JSON.stringify(summary, null, 2);
    },
  },
  {
    name: "get_ranking",
    description:
      "全ユーザーのランキングを取得する（体重変化率・カロリー目標達成率・筋トレ回数/連続日数・最終記録日）。プライバシーのため体重の実数値(kg)は含まれない（変化率のみ）。「みんなの調子は?」「ランキング見せて」「サボってるのは誰?」のときに呼ぶ。",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 7,
          maximum: 90,
          description: "集計期間（日数、既定30）",
        },
      },
    },
    handler: async (env, user, args) => {
      const days = Math.min(90, Math.max(7, num(args, "days") ?? 30));
      const ranking = await getRanking(env.DB, today(env), days);
      return JSON.stringify(ranking, null, 2);
    },
  },
  {
    name: "set_session_url",
    description:
      "自分のClaudeセッションの共有URLを登録する。登録するとダッシュボードの上部に「セッションを開く」リンクが表示される。ユーザーが会話の共有URLを渡してきたら呼ぶ。url省略で削除。",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Claudeセッションの共有URL (https://claude.ai/share/... など)。省略すると登録解除",
        },
      },
    },
    handler: async (env, user, args) => {
      const url = str(args, "url");
      await setSessionUrl(env.DB, user.id, url && url.trim() !== "" ? url : null);
      return url && url.trim() !== ""
        ? "セッションURLを登録しました。ダッシュボード上部にリンクが表示されます。"
        : "セッションURLの登録を解除しました。";
    },
  },
  {
    name: "set_name",
    description: "ランキングなどに表示される自分の名前を変更する。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "新しい表示名" },
      },
      required: ["name"],
    },
    handler: async (env, user, args) => {
      const name = requireStr(args, "name");
      await renameUser(env.DB, user.id, name);
      return `表示名を「${name}」に変更しました。`;
    },
  },
  {
    name: "create_user",
    description:
      "新しいユーザーを追加してアクセストークンを発行する（管理者のみ）。発行されたトークンを本人に渡し、コネクタURL https://<このサーバー>/mcp?token=<トークン> で接続してもらう。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "ユーザーの表示名" },
      },
      required: ["name"],
    },
    handler: async (env, user, args) => {
      if (!user.admin) throw new Error("ユーザーの追加は管理者のみ可能です");
      const name = requireStr(args, "name");
      const created = await createUser(env.DB, name);
      return [
        `ユーザー「${name}」を追加しました (id: ${created.id})。`,
        `トークン: ${created.token}`,
        "本人への案内:",
        `- MCPコネクタURL: <このサーバーのURL>/mcp?token=${created.token}`,
        `- ダッシュボード: <このサーバーのURL>/ を開いてトークンを入力`,
      ].join("\n");
    },
  },
  {
    name: "list_users",
    description: "登録ユーザーの一覧（idと名前）を取得する。",
    inputSchema: { type: "object", properties: {} },
    handler: async (env, _user, _args) => {
      const users = await listUsers(env.DB);
      return JSON.stringify(
        users.map((u) => ({ id: u.id, name: u.name })),
        null,
        2,
      );
    },
  },
  {
    name: "list_day",
    description: "指定日の自分の記録（体重・食事）をID付きで一覧する。修正・削除の前に呼ぶ。",
    inputSchema: {
      type: "object",
      properties: { date: dateProp },
    },
    handler: async (env, user, args) => {
      const date = normalizeDate(env, args.date);
      const day = await listDay(env.DB, user.id, date);
      return JSON.stringify(day, null, 2);
    },
  },
  {
    name: "delete_entry",
    description:
      "自分の記録を削除する。食事は list_day で確認した id を、体重は date を指定する。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["meal", "weight"] },
        id: { type: "integer", description: "meal の削除対象ID" },
        date: { ...dateProp, description: "weight の削除対象日 (YYYY-MM-DD)" },
      },
      required: ["type"],
    },
    handler: async (env, user, args) => {
      const type = requireStr(args, "type");
      if (type !== "meal" && type !== "weight") {
        throw new Error("type は meal / weight のいずれかです");
      }
      const deleted = await deleteEntry(env.DB, user.id, type, {
        id: num(args, "id"),
        date: str(args, "date"),
      });
      return deleted > 0 ? "削除しました。" : "該当する記録がありませんでした。";
    },
  },
];

function rpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRequest(
  env: Env,
  user: AuthUser,
  req: JsonRpcRequest,
): Promise<object | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return isNotification ? null : rpcError(id, -32600, "Invalid Request");
  }

  // 通知（idなし）はレスポンス不要
  if (isNotification) return null;

  const params = req.params ?? {};

  switch (req.method) {
    case "initialize": {
      const requested = String(params.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case "tools/call": {
      const name = String(params.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await tool.handler(env, user, args);
        return rpcResult(id, { content: [{ type: "text", text }], isError: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return rpcResult(id, {
          content: [{ type: "text", text: `エラー: ${message}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

/** ステートレスなStreamable HTTPエンドポイント (POST /mcp) */
export async function handleMcp(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (request.method === "DELETE") {
    // セッション終了要求。ステートレスなので何もしない
    return new Response(null, { status: 200 });
  }
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify(rpcError(null, -32000, "Method Not Allowed: use POST")),
      { status: 405, headers: { "content-type": "application/json", allow: "POST, DELETE" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const requests: JsonRpcRequest[] = Array.isArray(body)
    ? (body as JsonRpcRequest[])
    : [body as JsonRpcRequest];
  const responses: object[] = [];
  for (const r of requests) {
    const res = await handleRequest(env, user, r);
    if (res !== null) responses.push(res);
  }

  // 通知のみ（レスポンスなし）は202 Acceptedを返す
  if (responses.length === 0) return new Response(null, { status: 202 });

  const payload = Array.isArray(body) ? responses : responses[0];
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}
