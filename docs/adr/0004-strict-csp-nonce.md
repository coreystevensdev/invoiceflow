# 4. Strict nonce-based CSP without `unsafe-inline`

Date: 2026-05-02
Status: Accepted

## Context

Browser Content Security Policy (CSP) is the standard mitigation against XSS injection. Most apps either skip CSP entirely (Next.js default) or ship a permissive policy with `'unsafe-inline'` to avoid breaking inline scripts and styles.

Both defaults leave the application open to script injection. The middle ground (hashing every inline script and adding the hash to the CSP header) is brittle and breaks on every script change.

InvoiceFlow's privacy thesis (zero retention, no logging of customer content) is undermined if a successful XSS injection can exfiltrate field values from the rendered results panel before the user even sees them.

## Decision

`src/proxy.ts` (the Next.js 16 middleware, replaces `middleware.ts` in App Router) generates a per-request nonce on every request. The CSP header is set with:

```
script-src 'self' 'nonce-<RANDOM>' 'strict-dynamic';
style-src 'self' 'nonce-<RANDOM>';
... (other directives)
```

Layout reads the nonce via `headers()` from `next/headers` and passes it to any inline `<script>` that's absolutely required. No third-party script that requires `'unsafe-inline'` is allowed.

Alongside CSP, the middleware ships HSTS, Referrer-Policy, X-Content-Type-Options, and Permissions-Policy headers so the security posture is consistent.

## Consequences

Positive:
- Blocks all inline script injection. Even a successful HTML-injection (in field values, in error messages, anywhere) cannot execute as script because the nonce won't match.
- Meets best-practice security baselines (Mozilla Observatory grades A or higher) without relying on developer discipline.
- Forces architectural rejection of any third-party integration that needs `'unsafe-inline'` or `'unsafe-eval'`. This is a feature: integrations that demand those flags are integrations that should be refused.
- Surfaces accidental inline scripts as immediate browser console errors, so they're caught in development rather than after deploy.

Negative:
- JSON-LD structured data has to be served at a dedicated `/schema.jsonld` route instead of an inline `<script type="application/ld+json">` tag. Google's crawler prefers inline structured data; linked structured data is best-effort across crawlers.
- Some third-party scripts (analytics, embeds) won't work without weakening the policy. Project policy is to refuse those integrations.
- Module workers (`new Worker(url, { type: "module" })`) under strict CSP have edge cases on older iOS Safari versions; mitigated by ADR 0005's static-worker pattern.
- The nonce is generated on every request, which means the CSP header is request-scoped and cannot be cached at a CDN edge as a static value. This is fine for InvoiceFlow's traffic volume.

## Alternatives considered

**`'unsafe-inline'`.** Default for many Next.js apps. Fails most CSP audits. Allows trivial XSS injection. Rejected outright.

**Hash-based CSP.** Compute SHA-256 of every inline script at build time and add the hashes to the CSP header. Brittle: every script change requires regenerating the hashes, and the CSP header grows linearly with the number of inline scripts. Operationally fragile.

**No CSP.** The Next.js default. Leaves XSS protection to the absence of inline scripts, which can't be enforced. Rejected because the privacy thesis depends on the rendered page being trustworthy.
