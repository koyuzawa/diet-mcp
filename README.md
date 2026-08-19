# diet-mcp

AIとのダイエットセッション用のリモートMCPサーバー + ダッシュボード。
Cloudflare Workers + D1 で動きます。

- **MCPサーバー** (`/mcp`): AIセッション中に体重・食事（カロリー/PFC）・運動・目標を記録するツールを提供
- **ダッシュボード** (`/`): 体重の推移、日別カロリー、PFCバランス、今日の記録をグラフで表示

AIに「今日の体重は65.2kg」「昼はカレーを食べた」と話すだけで記録され、ダッシュボードにすぐ反映されます。

## セットアップ

前提: Node.js 18+、Cloudflareアカウント

```bash
npm install
npx wrangler login

# 1. D1データベースを作成
npm run db:create
#    → 出力された database_id を wrangler.jsonc の
#      "REPLACE_WITH_YOUR_D1_DATABASE_ID" に貼り付ける

# 2. マイグレーションを適用
npm run db:migrate

# 3. デプロイ
npm run deploy
#    → https://diet-mcp.<あなたのサブドメイン>.workers.dev が発行される
```

### アクセス保護（推奨）

デフォルトでは誰でもアクセスできます。トークンを設定すると MCP と API に認証がかかります:

```bash
npx wrangler secret put AUTH_TOKEN
# 任意の長いランダム文字列を入力
```

- MCP接続時: ヘッダー `Authorization: Bearer <トークン>` を設定
- ダッシュボード: 初回アクセス時にトークン入力欄が出ます（ブラウザに保存されます）

## Claudeへの接続

### claude.ai（カスタムコネクタ）

設定 → コネクタ → 「カスタムコネクタを追加」で
`https://<あなたのWorker>.workers.dev/mcp` を登録します。

### Claude Code

```bash
claude mcp add --transport http diet https://<あなたのWorker>.workers.dev/mcp
# AUTH_TOKENを設定した場合:
claude mcp add --transport http diet https://<あなたのWorker>.workers.dev/mcp \
  --header "Authorization: Bearer <トークン>"
```

## MCPツール一覧

| ツール | 説明 |
|---|---|
| `log_weight` | 体重（+体脂肪率）を記録。同じ日は上書き |
| `log_meal` | 食事を記録（名前・kcal・PFC） |
| `log_exercise` | 運動を記録（時間・消費kcal） |
| `set_goals` | 目標体重・1日の摂取カロリー/たんぱく質目標を設定 |
| `get_summary` | 直近N日のサマリー（体重推移・日別集計・今日の記録） |
| `list_day` | 指定日の記録をID付きで一覧（修正・削除用） |
| `delete_entry` | 記録の削除（食事/運動はid、体重は日付で指定） |

使い方の例（AIとのセッションで）:

> 「今朝の体重は65.2kgだった」→ `log_weight`
> 「昼にサラダチキンとおにぎり食べた」→ カロリーを推定して `log_meal`
> 「目標体重は60kgにする。1日1800kcalまで」→ `set_goals`

## ローカル開発

```bash
npm run db:migrate:local   # ローカルD1にマイグレーション適用
npm run dev                # http://localhost:8787
```

## 構成

```
src/index.ts     ルーティング・認証・CORS
src/mcp.ts       MCPサーバー（Streamable HTTP、ステートレス）とツール定義
src/data.ts      D1クエリ（記録・集計）
src/types.ts     型定義
public/index.html ダッシュボード（依存ライブラリなしの単一ファイル）
migrations/      D1スキーマ
```

MCPは外部ライブラリなしのステートレスな Streamable HTTP 実装です
（`initialize` / `tools/list` / `tools/call` に応答。セッション管理なし）。

## 環境変数

| 変数 | 説明 |
|---|---|
| `AUTH_TOKEN` | （secret・任意）設定するとMCP/APIにBearer認証がかかる |
| `TZ_OFFSET_HOURS` | 「今日」を決めるUTCオフセット。既定 `9`（日本時間） |
