import { beforeEach, describe, expect, it } from "vitest";
import {
  check,
  clientIpFrom,
  extractLimit,
  inquiryLimit,
  resetForTests,
} from "./rate-limit";

beforeEach(() => {
  resetForTests();
});

describe("check", () => {
  it("allows requests up to the limit", () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(check("k", opts).ok).toBe(true);
    expect(check("k", opts).ok).toBe(true);
    expect(check("k", opts).ok).toBe(true);
  });

  it("rejects the next request after the limit", () => {
    const opts = { limit: 2, windowMs: 60_000 };
    check("k", opts);
    check("k", opts);
    const result = check("k", opts);
    expect(result.ok).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(0);
    expect(result.remaining).toBe(0);
  });

  it("scopes buckets by key", () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(check("a", opts).ok).toBe(true);
    expect(check("b", opts).ok).toBe(true);
  });

  it("decrements remaining as requests accumulate", () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(check("k", opts).remaining).toBe(2);
    expect(check("k", opts).remaining).toBe(1);
    expect(check("k", opts).remaining).toBe(0);
  });
});

describe("clientIpFrom", () => {
  it("returns the first valid IP from x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.5, 198.51.100.1",
    });
    expect(clientIpFrom(headers)).toBe("203.0.113.5");
  });

  it("rejects non-IP strings injected into x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "not-an-ip, also-not-one",
      "x-real-ip": "192.0.2.1",
    });
    expect(clientIpFrom(headers)).toBe("192.0.2.1");
  });

  it("accepts a well-formed IPv6 address", () => {
    const headers = new Headers({
      "x-forwarded-for": "2001:db8::1",
    });
    expect(clientIpFrom(headers)).toBe("2001:db8::1");
  });

  it("falls back to 'unknown' when no header is valid", () => {
    const headers = new Headers({
      "x-forwarded-for": "garbage",
      "x-real-ip": "still-garbage",
    });
    expect(clientIpFrom(headers)).toBe("unknown");
  });
});

describe("inquiryLimit and extractLimit", () => {
  it("track buckets independently per IP", () => {
    expect(inquiryLimit("1.1.1.1").ok).toBe(true);
    expect(extractLimit("1.1.1.1").ok).toBe(true);
    // The two limiters share neither key prefix nor capacity.
    expect(inquiryLimit("1.1.1.1").remaining).toBeLessThanOrEqual(9);
    expect(extractLimit("1.1.1.1").remaining).toBeLessThanOrEqual(19);
  });
});
