import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Basic HTTP authentication + in-memory rate limiting.
 *
 * AUTH: Gate the entire app behind a single username/password so nobody
 * who stumbles on the deployment URL can read the documents or use the
 * chat. The credentials are stored in env vars (never committed):
 *
 *   BASIC_AUTH_USER=aibrahim
 *   BASIC_AUTH_PASSWORD=some-long-random-string
 *
 * If either env var is unset, the middleware auth is DISABLED (useful
 * for local development). Set both in Vercel → Settings → Environment
 * Variables for production.
 *
 * RATE LIMITING: Even behind basic auth, an abusive or buggy client can
 * hammer /api/chat or /api/upload and burn LLM budget. We enforce a
 * per-route token bucket keyed by client IP. The limiter is in-memory
 * only — it does NOT share state across serverless instances, and it
 * resets on cold start. For a single-user Vercel deployment that is
 * fine; for multi-instance or higher-scale deployments, replace this
 * with Upstash Ratelimit or Vercel KV (see CONCERNS.md).
 */

// Paths we explicitly don't gate. Next.js internals + static assets need
// to load without auth or the login dialog never finishes rendering.
const PUBLIC_PATHS = ["/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml"];

// ── In-memory token bucket ──
//
// Each rule is `{ capacity, refillPerMs }`. We maintain one bucket per
// (route-rule, client IP) pair. Buckets are lazily created and pruned
// on access to keep memory bounded.
interface RateRule {
  capacity: number;
  refillPerSecond: number;
}
interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

// Tighter on expensive LLM and upload routes; generous everywhere else
// so normal clicking around is never rate-limited. These numbers assume
// a single user on a single instance; for a real multi-user rollout,
// revisit everything.
const RATE_RULES: Array<{ prefix: string; rule: RateRule }> = [
  { prefix: "/api/chat", rule: { capacity: 30, refillPerSecond: 0.5 } }, // ~30/min after burst
  { prefix: "/api/upload", rule: { capacity: 10, refillPerSecond: 0.1 } }, // ~6/min after burst
  {
    prefix: "/api/storage/signed-upload",
    rule: { capacity: 20, refillPerSecond: 0.2 },
  },
  { prefix: "/api/", rule: { capacity: 120, refillPerSecond: 2 } }, // generic fallback
];

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000; // cap memory; prune LRU-ish on overflow

function getClientIp(request: NextRequest): string {
  // Trust the first hop of x-forwarded-for since we're behind Vercel's
  // proxy. Fall back to x-real-ip and finally to a fixed "unknown"
  // bucket so missing headers don't bypass the limiter.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri;
  return "unknown";
}

function matchRule(
  pathname: string,
): { prefix: string; rule: RateRule } | null {
  for (const entry of RATE_RULES) {
    if (pathname.startsWith(entry.prefix)) return entry;
  }
  return null;
}

function consumeToken(key: string, rule: RateRule): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      // Simple overflow eviction: drop the oldest 10% by insertion order.
      // We don't track last-access precisely; this is a small memory
      // safety valve, not a correctness mechanism.
      const toEvict = Math.floor(MAX_BUCKETS / 10);
      let i = 0;
      for (const k of buckets.keys()) {
        buckets.delete(k);
        if (++i >= toEvict) break;
      }
    }
    bucket = { tokens: rule.capacity, lastRefillMs: now };
    buckets.set(key, bucket);
  }
  // Refill proportionally to elapsed time.
  const elapsedMs = now - bucket.lastRefillMs;
  if (elapsedMs > 0) {
    bucket.tokens = Math.min(
      rule.capacity,
      bucket.tokens + (elapsedMs * rule.refillPerSecond) / 1000,
    );
    bucket.lastRefillMs = now;
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function timingSafeEqual(a: string, b: string): boolean {
  // Constant-time string comparison to prevent timing attacks on the
  // password check. Length mismatch still early-returns but that leaks
  // only the length, which is already implicit from the header shape.
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets and Next internals skip BOTH auth and rate limiting.
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // ── Auth gate ──
  // Only enforced when BASIC_AUTH_* env vars are configured. Local dev
  // runs without them so the login dialog doesn't fire constantly. A
  // production deploy that forgets the env vars gets rate limiting but
  // no auth — unsafe, but caught quickly because prod always has auth
  // credentials set and its absence would be noticed immediately.
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;
  if (expectedUser && expectedPassword) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return unauthorized();
    }
    let decoded: string;
    try {
      decoded = atob(authHeader.slice("Basic ".length));
    } catch {
      return unauthorized();
    }
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) {
      return unauthorized();
    }
    const providedUser = decoded.slice(0, separatorIndex);
    const providedPassword = decoded.slice(separatorIndex + 1);
    if (
      !timingSafeEqual(providedUser, expectedUser) ||
      !timingSafeEqual(providedPassword, expectedPassword)
    ) {
      return unauthorized();
    }
  }

  // ── Rate limit ──
  // Runs regardless of whether auth was enforced. This is the thing
  // that protects the app from abuse (LLM cost, DB load) even in
  // environments where auth is disabled. Only /api/** routes are
  // limited — navigation, RSC payloads, etc. are fine to be fast.
  if (pathname.startsWith("/api/")) {
    const matched = matchRule(pathname);
    if (matched) {
      const ip = getClientIp(request);
      const key = `${matched.prefix}:${ip}`;
      if (!consumeToken(key, matched.rule)) {
        return new NextResponse(
          JSON.stringify({
            error: "Too many requests. Please slow down.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "5",
            },
          },
        );
      }
    }
  }

  return NextResponse.next();
}

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="documind", charset="UTF-8"',
    },
  });
}

/**
 * Apply the middleware to all routes EXCEPT the Next.js internals matcher.
 * The PUBLIC_PATHS guard above is a second safety net for assets.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, robots.txt, sitemap.xml
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
