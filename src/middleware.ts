import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Basic HTTP authentication middleware.
 *
 * Gate the entire app behind a single username/password so nobody who
 * stumbles on the deployment URL can read the documents or use the chat.
 * The credentials are stored in env vars (never committed):
 *
 *   BASIC_AUTH_USER=aibrahim
 *   BASIC_AUTH_PASSWORD=some-long-random-string
 *
 * If either env var is unset, the middleware is DISABLED (useful for
 * local development where you don't want to type a password constantly).
 * Set both in Vercel → Settings → Environment Variables for production.
 *
 * Browsers cache the credentials for the session after the first prompt,
 * so it's a one-time entry per browser session. To force a new prompt,
 * open a private window.
 */

// Paths we explicitly don't gate. Next.js internals + static assets need
// to load without auth or the login dialog never finishes rendering.
const PUBLIC_PATHS = [
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

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
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

  // No credentials configured → middleware is disabled. This keeps local
  // dev frictionless while still protecting prod as long as Vercel env
  // vars are set.
  if (!expectedUser || !expectedPassword) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

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

  return NextResponse.next();
}

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="DocuMind", charset="UTF-8"',
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
