import { COUNTERPARTY_API_BASE } from "@/lib/constants";

/** Emergency GET fallback when a direct wallet read fails behind CORS.
 * Live node requests remain primary for quotes, composition and preflight.
 * Broadcasting stays on the SDK's existing direct provider transports. */
function protocolPath(path: string[]): string | null {
  if (path[0] !== "v2" || path.some((part) => !part || part === "." || part === ".." || /[\\/]/.test(part))) return null;
  return path.length === 1 ? "/" : `/${path.slice(1).map(encodeURIComponent).join("/")}`;
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const path = protocolPath((await context.params).path);
  if (path === null) return Response.json({ error: "Not found" }, { status: 404 });
  let response: Response;
  try {
    response = await fetch(`${COUNTERPARTY_API_BASE}${path}${new URL(request.url).search}`, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
      redirect: "manual",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    return Response.json({ error: "Protocol service unavailable" }, {
      status: 502, headers: { "cache-control": "no-store" },
    });
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    return Response.json({ error: "Unexpected node redirect" }, {
      status: 502, headers: { "cache-control": "no-store" },
    });
  }
  const retryAfter = response.headers.get("retry-after");
  const encoding = response.headers.get("content-encoding");
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      ...(retryAfter ? { "retry-after": retryAfter } : {}),
      ...(encoding ? { "content-encoding": encoding } : {}),
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  await request.body?.cancel().catch(() => undefined);
  return Response.json({ error: "Method not allowed" }, {
    status: 405, headers: { allow: "GET", "cache-control": "no-store" },
  });
}
