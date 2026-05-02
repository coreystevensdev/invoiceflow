import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js 16 proxy (renamed from middleware).
 *
 * Responsibilities:
 *   - Generate a per-request CSP nonce so no page script needs `'unsafe-inline'`.
 *   - Emit a strict set of security headers on every HTML response:
 *     Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options,
 *     Referrer-Policy, Permissions-Policy.
 *   - Propagate the nonce as `x-nonce` request header so Server Components
 *     (RootLayout) can read it via `headers()` and inject nonce-bearing
 *     `<script type="application/ld+json">` tags.
 *
 * The matcher below excludes API routes (their own handlers own their
 * headers), static assets, and favicon. Prefetch requests and next/image
 * requests are skipped to keep them cache-friendly.
 *
 * Loom is whitelisted in frame-src / img-src / media-src to support the
 * Sunday hero video. Drop those entries if Loom is ever removed.
 *
 * `blob:` is whitelisted in frame-src so the results view can render the
 * uploaded PDF in an iframe via URL.createObjectURL. The blob URL is
 * same-origin and the lifecycle is controlled in src/app/page.tsx.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ""}`,
    `img-src 'self' blob: data: https://cdn.loom.com https://www.loom.com`,
    `font-src 'self' data:`,
    `connect-src 'self' blob:${isDev ? " ws: http://localhost:*" : ""}`,
    `media-src 'self' https://cdn.loom.com https://www.loom.com`,
    `frame-src 'self' blob: https://www.loom.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];
  const cspHeaderValue = directives.join("; ");

  const permissionsPolicy = [
    "accelerometer=()",
    "camera=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "payment=()",
    "usb=()",
    "interest-cohort=()",
  ].join(", ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeaderValue);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", cspHeaderValue);
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Referrer-Policy",
    "strict-origin-when-cross-origin",
  );
  response.headers.set("Permissions-Policy", permissionsPolicy);
  response.headers.set("X-Frame-Options", "DENY");

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|schema.jsonld).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
