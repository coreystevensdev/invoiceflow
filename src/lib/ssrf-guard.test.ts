import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl } from "./ssrf-guard";

describe("assertPublicHttpUrl", () => {
  it("allows a public IPv4 literal", async () => {
    await expect(assertPublicHttpUrl("https://8.8.8.8/webhook")).resolves.toBeUndefined();
  });

  it("rejects loopback", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/webhook")).rejects.toThrow();
  });

  it("rejects localhost by name", async () => {
    await expect(assertPublicHttpUrl("http://localhost/webhook")).rejects.toThrow();
  });

  it("rejects RFC 1918 private ranges", async () => {
    await expect(assertPublicHttpUrl("http://10.0.0.5/webhook")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://172.16.0.1/webhook")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://192.168.1.1/webhook")).rejects.toThrow();
  });

  it("rejects the cloud metadata address", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
  });

  it("rejects IPv6 loopback and link-local", async () => {
    await expect(assertPublicHttpUrl("http://[::1]/webhook")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://[fe80::1]/webhook")).rejects.toThrow();
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertPublicHttpUrl("ftp://8.8.8.8/webhook")).rejects.toThrow();
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow();
  });
});
