import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isPrivateOrReservedIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, covers the cloud metadata IP
  if (a === 0) return true; // "this" network
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isPrivateOrReservedIpv4(mapped);
  }
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateOrReservedIpv4(ip);
  if (version === 6) return isPrivateOrReservedIpv6(ip);
  return true; // not a valid IP we recognize, don't take the risk
}

/**
 * Throws if the URL isn't a plain http(s) request to a public address.
 * Blocks localhost, private ranges, link-local (which covers the AWS/GCP
 * metadata IP 169.254.169.254), and non-http(s) schemes. Resolves DNS
 * itself rather than trusting the hostname, since a public-looking name
 * can still resolve to an internal address.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Webhook URL must use http or https.");
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("Webhook URL host is not allowed.");
  }

  const directIpVersion = isIP(hostname);
  const addresses = directIpVersion
    ? [hostname]
    : (await lookup(hostname, { all: true })).map((entry) => entry.address);

  for (const address of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error("Webhook URL resolves to a private or reserved address.");
    }
  }
}
