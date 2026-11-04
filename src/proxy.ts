import { NextRequest, NextResponse } from "next/server";

// With HARMONIA_PUBLIC_LOCK=1 a public deployment serves only read-only pages, so
// a shared link cannot start jobs or spend model budget on someone's behalf.
const PUBLIC_PATHS = [
  /^\/$/, /^\/proof$/, /^\/api\/proof$/, /^\/api\/health$/, /^\/api\/agent-card$/, /^\/\.well-known\/agent-card\.json$/, /^\/docs(\/.*)?$/,
  /^\/privacy$/, /^\/terms$/, /^\/data-deletion$/, /^\/b\/[A-Za-z0-9_-]{32}$/,
  /^\/_next\//, /^\/(favicon\.ico|icon\.png|apple-icon\.png|og\.png|brand\/.*|architecture\/.*)$/,
];

export function publicPathAllowed(method: string, pathname: string): boolean {
  return (method === "GET" || method === "HEAD") && PUBLIC_PATHS.some((pattern) => pattern.test(pathname));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (process.env.HARMONIA_PUBLIC_LOCK === "1" && !publicPathAllowed(request.method, pathname)) {
    return new NextResponse("Not published on this deployment.", { status: 404 });
  }
  if (pathname.startsWith("/dashboard") && !request.cookies.get("harmonia_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
