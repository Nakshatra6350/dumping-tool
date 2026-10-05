import dns from "node:dns/promises";
import net from "node:net";
import { badRequest } from "../errors";

/**
 * Server-side request forgery guard.
 *
 * Tenants can type in hosts that the server then connects to (an S3 endpoint
 * today, database hosts later). On a shared, hosted deployment that must never
 * reach the server's own network: cloud metadata services, internal databases,
 * localhost. This rejects any host that resolves to a private, loopback or
 * link-local address.
 *
 * Self-hosters and local development legitimately use private addresses, so the
 * check is switched off there (ALLOW_PRIVATE_NETWORK_TARGETS).
 */
const isPrivateV4 = (ip: string): boolean => {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, includes cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
};

const isPrivateV6 = (ip: string): boolean => {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7);
    return net.isIPv4(mapped) ? isPrivateV4(mapped) : true;
  }
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower); // unique-local, link-local
};

export const isPrivateAddress = (ip: string): boolean => (net.isIPv4(ip) ? isPrivateV4(ip) : isPrivateV6(ip));

export const assertPublicHost = async (hostname: string): Promise<void> => {
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw badRequest("host_not_found", `The host "${hostname}" could not be found`);
  }
  if (addresses.some(isPrivateAddress)) {
    throw badRequest(
      "private_address_not_allowed",
      `"${hostname}" points to a private or internal address, which is not allowed`,
    );
  }
};

/** Validates a tenant-supplied endpoint URL. An empty endpoint means Amazon S3 itself. */
export const assertSafeEndpoint = async (endpoint: string, allowPrivate: boolean): Promise<void> => {
  if (!endpoint) return;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw badRequest("invalid_endpoint", "The endpoint is not a valid URL");
  }
  if (!allowPrivate) {
    if (url.protocol !== "https:") throw badRequest("invalid_endpoint", "The endpoint must use https://");
    await assertPublicHost(url.hostname);
  }
};
