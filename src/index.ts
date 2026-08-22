import { findUserByToken, getAdminUser, getRanking, getSummary, today } from "./data";
import { handleMcp } from "./mcp";
import type { AuthUser, Env } from "./types";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
  "access-control-expose-headers": "mcp-session-id",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * トークンからユーザーを解決する。
 * - AUTH_TOKEN（管理者トークン）ならユーザー1（管理者）
 * - usersテーブルのトークンならそのユーザー
 * - AUTH_TOKEN未設定の環境（ローカル開発）ではすべてユーザー1（管理者）
 */
async function resolveUser(request: Request, url: URL, env: Env): Promise<AuthUser | null> {
  if (!env.AUTH_TOKEN) return getAdminUser(env.DB);
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const token = bearer || (url.searchParams.get("token") ?? "");
  if (!token) return null;
  if (timingSafeEqual(token, env.AUTH_TOKEN)) return getAdminUser(env.DB);
  return findUserByToken(env.DB, token);
}

function unauthorized(): Response {
  return withCors(
    new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="diet-mcp"',
      },
    }),
  );
}

async function handleApi(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  const jsonHeaders = { "content-type": "application/json", "cache-control": "no-store" };
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
  if (url.pathname === "/api/summary") {
    const summary = await getSummary(env.DB, user, today(env), days);
    return new Response(JSON.stringify(summary), { headers: jsonHeaders });
  }
  if (url.pathname === "/api/ranking") {
    const ranking = await getRanking(env.DB, today(env), Math.max(7, days));
    return new Response(JSON.stringify(ranking), { headers: jsonHeaders });
  }
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/api/")) {
      const user = await resolveUser(request, url, env);
      if (!user) return unauthorized();
      const res =
        url.pathname === "/mcp"
          ? await handleMcp(request, env, user)
          : await handleApi(request, env, url, user);
      return withCors(res);
    }

    // それ以外は静的アセット（ダッシュボード）
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
