/**
 * In-memory sliding-window rate limiter.
 *
 * Scope: per Fluid Compute instance. Under horizontal scale each instance
 * limits independently, a 10/hr cap becomes effectively 10/hr × instance
 * count. Acceptable for abuse prevention on a demo tool; not acceptable
 * for a production billing quota. Upgrade to a shared store (Redis / KV)
 * when traffic grows.
 *
 * Extraction of client IP: prefer `x-forwarded-for` first hop, then
 * `x-real-ip`, then the connection address. Edge platforms set at least
 * one of these.
 *
 * Memory safety: stale buckets (all timestamps older than the widest
 * window) are pruned opportunistically on every `check()` call, bounded
 * to a small sample so one call can't stall. Under a DDoS with many
 * unique IPs, the Map still grows during an active window, but empties
 * automatically when traffic subsides. Fluid Compute instances recycle
 * often enough that hard bounds are unnecessary for this scope.
 */

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
}

const buckets = new Map<string, number[]>();
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const EVICTION_SAMPLE = 32;

function evictStale(now: number): void {
  let inspected = 0;
  const cutoff = now - MAX_WINDOW_MS;
  for (const [key, history] of buckets) {
    if (inspected >= EVICTION_SAMPLE) break;
    inspected++;
    const lastSeen = history[history.length - 1] ?? 0;
    if (lastSeen < cutoff) buckets.delete(key);
  }
}

export function check(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  evictStale(now);
  const windowStart = now - opts.windowMs;
  const history = buckets.get(key) ?? [];
  const recent = history.filter((t) => t > windowStart);

  if (recent.length >= opts.limit) {
    const oldest = recent[0];
    const retryAfterMs = Math.max(0, oldest + opts.windowMs - now);
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      resetAt: oldest + opts.windowMs,
    };
  }

  recent.push(now);
  buckets.set(key, recent);
  return {
    ok: true,
    remaining: Math.max(0, opts.limit - recent.length),
    retryAfterSeconds: 0,
    resetAt: now + opts.windowMs,
  };
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

function validIp(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  if (IPV4_RE.test(trimmed)) return trimmed;
  if (trimmed.includes(":") && IPV6_RE.test(trimmed) && trimmed.length <= 45) {
    return trimmed;
  }
  return null;
}

/**
 * Extract a validated client IP from request headers.
 *
 * Security note: `x-forwarded-for` is set by clients and proxies alike.
 * An attacker can inject arbitrary strings as the "first hop." We validate
 * the candidate is a well-formed IPv4/IPv6 address before using it as a
 * rate-limit key; otherwise rate limits could be bypassed by varying the
 * header value per request. Falls back to `x-real-ip` (typically
 * platform-set and not client-writable) and finally "unknown", which
 * buckets all unclassified requests under one shared quota.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded && forwarded.length > 0) {
    for (const hop of forwarded.split(",")) {
      const ip = validIp(hop);
      if (ip) return ip;
    }
  }
  const real = validIp(headers.get("x-real-ip") ?? undefined);
  if (real) return real;
  return "unknown";
}

export const INQUIRY_LIMIT: RateLimitOptions = {
  limit: 10,
  windowMs: 60 * 60 * 1000,
};

export const EXTRACT_LIMIT: RateLimitOptions = {
  limit: 20,
  windowMs: 60 * 60 * 1000,
};

export function inquiryLimit(ip: string): RateLimitResult {
  return check(`inquiry:${ip}`, INQUIRY_LIMIT);
}

export function extractLimit(ip: string): RateLimitResult {
  return check(`extract:${ip}`, EXTRACT_LIMIT);
}

export function resetForTests(): void {
  buckets.clear();
}
