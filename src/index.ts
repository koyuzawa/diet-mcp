import { getSummary, today } from "./data";
import { handleMcp } from "./mcp";
import type { Env } from "./types";

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

/** AUTH_TOKEN が設定されている場合のみ認証を要求する */
function authorized(request: Request, url: URL, env: Env): boolean {
  const token = env.AUTH_TOKEN;
  if (!token) return true;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = url.searchParams.get("token") ?? "";
  return timingSafeEqual(bearer, token) || timingSafeEqual(query, token);
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

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.pathname === "/api/summary") {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
    const summary = await getSummary(env.DB, today(env), days);
    return new Response(JSON.stringify(summary), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
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
      if (!authorized(request, url, env)) return unauthorized();
      const res =
        url.pathname === "/mcp"
          ? await handleMcp(request, env)
          : await handleApi(request, env, url);
      return withCors(res);
    }

    // それ以外は静的アセット（ダッシュボード）
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
