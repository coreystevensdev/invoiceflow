import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import dns from "node:dns";
import { Agent } from "undici";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isPrivateOrReservedIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, covers the cloud metadata IP
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (RFC 2544)
  if (a === 0) return true; // "this" network
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified
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

/**
 * dns.lookup-compatible resolver that rejects private/reserved addresses at
 * the moment of connection instead of at a separate check beforehand.
 * assertPublicHttpUrl validates DNS once, upfront, for a fast, clear error;
 * this closes the gap that leaves open on its own, a DNS record that's
 * public at check time and rebinds to a private address before the request
 * actually connects (TOCTOU/DNS rebinding). Passed as the dispatcher's
 * connect.lookup so the same resolution that gets validated is the one
 * that gets connected to, with no window between the two.
 */
export function pinnedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, result) => {
    if (err) {
      callback(err, "");
      return;
    }
    const addresses = result as dns.LookupAddress[];
    const blocked = addresses.find((entry) => isPrivateOrReservedIp(entry.address));
    if (blocked) {
      callback(new Error("Webhook URL resolves to a private or reserved address."), "");
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    callback(null, addresses[0].address, addresses[0].family);
  });
}

/** Shared dispatcher for outbound webhook requests: pins DNS resolution to
 * addresses validated at the exact moment of connection (see pinnedLookup). */
export const webhookDispatcher = new Agent({ connect: { lookup: pinnedLookup } });
