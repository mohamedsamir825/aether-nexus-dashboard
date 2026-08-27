/**
 * The URL guard -- what the division is allowed to reach over the network.
 *
 * Retrieval targets are attacker-influenced in the general case (a URL can
 * arrive from a document, a config file, or a redirect), so this fails closed:
 * a URL is refused unless it is affirmatively a public HTTP(S) address. Every
 * rule below exists because some spelling of "localhost" is not spelled
 * "localhost".
 *
 * ## What this does NOT do, on purpose
 *
 * It never resolves DNS. Resolving here would be worse than not resolving:
 * the name is resolved again when the request is actually made, so a hostile
 * name can answer public at check time and private a moment later (TOCTOU),
 * and the check itself would leak every URL to a resolver. So the guarantee is
 * precise and limited: **no literal or syntactic path to a private address**.
 * A public name that an attacker points at 10.0.0.1 is not stopped here, and
 * that is a documented limit rather than an oversight -- closing it needs
 * connection-time pinning, which belongs to the fetch layer, not to a parser.
 */
import { type Result, ok, err, nexusError } from '@nexus/core';

/** Hostnames that mean "this machine" or "this network" without an IP. */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'local',
  'lan',
  'internal',
  'intranet',
  'localdomain',
  'home.arpa',
  'instance-data',
  'metadata',
  'metadata.google.internal',
]);

/** Suffixes reserved for private networks by convention or by RFC 8375/6762. */
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.lan',
  '.internal',
  '.intranet',
  '.localdomain',
  '.home.arpa',
];

function fail(reason: string, url: string): Result<URL> {
  return err(
    nexusError('PERMISSION_DENIED', `refusing to retrieve: ${reason}`, {
      details: { url, reason },
    }),
  );
}

/**
 * Parses an IPv4 literal in every spelling the C resolver has historically
 * accepted, not just dotted-quad.
 *
 * `http://2130706433/`, `http://017700000001/` and `http://127.1/` are all
 * loopback, and a dotted-quad-only check waves all three through. Returns the
 * four octets, or null when the host is not an IPv4 literal at all.
 */
export function parseIpv4(host: string): readonly number[] | null {
  const parts = host.split('.');
  if (parts.length === 0 || parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    if (part.length === 0) return null;
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
      value = Number.parseInt(part.slice(2), 16);
    } else if (/^0[0-7]+$/.test(part)) {
      value = Number.parseInt(part.slice(1), 8);
    } else if (/^\d+$/.test(part)) {
      value = Number.parseInt(part, 10);
    } else {
      return null; // not numeric in any base -- a normal hostname
    }
    if (!Number.isFinite(value) || value < 0) return null;
    values.push(value);
  }

  // The last part absorbs the remaining octets: 127.1 is 127.0.0.1, and
  // a bare 2130706433 is the whole address.
  const last = values[values.length - 1];
  if (last === undefined) return null;
  const maxLast = 256 ** (4 - values.length + 1);
  if (last >= maxLast) return null;
  for (const value of values.slice(0, -1)) if (value > 255) return null;

  const octets = [0, 0, 0, 0];
  for (let i = 0; i < values.length - 1; i++) octets[i] = values[i] as number;
  let remainder = last;
  for (let i = 3; i >= values.length - 1; i--) {
    octets[i] = remainder % 256;
    remainder = Math.floor(remainder / 256);
  }
  return octets;
}

/** Everything RFC 1918, RFC 6598, RFC 3927 and friends reserve. */
export function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 192 && b === 0) return true; // RFC 5736/6890 special-purpose
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * IPv6 that is not globally routable.
 *
 * Deliberately an allowlist inversion: anything outside 2000::/3 (the only
 * currently-allocated global unicast range) is refused, so a range this code
 * has never heard of fails closed instead of open.
 */
export function isPrivateIpv6(host: string): boolean {
  const address = host.toLowerCase();
  if (address === '::1' || address === '::') return true;

  // IPv4-mapped and IPv4-compatible forms smuggle an IPv4 address inside IPv6.
  const mapped = /^::(ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) {
    const octets = parseIpv4(mapped[2] as string);
    return octets === null || isPrivateIpv4(octets);
  }

  const firstGroup = address.split(':')[0] ?? '';
  const leading = Number.parseInt(firstGroup || '0', 16);
  if (!Number.isFinite(leading)) return true;
  // 2000::/3 is global unicast. fc00::/7 (unique local) and fe80::/10
  // (link-local) fall outside it, as does everything unallocated.
  return !(leading >= 0x2000 && leading <= 0x3fff);
}

/**
 * Normalises a URL, or refuses it.
 *
 * The returned URL is what should actually be fetched -- callers must use it
 * rather than the string they passed in, so that parsing and fetching cannot
 * disagree about what the target was.
 */
export function normalizePublicHttpUrl(raw: string): Result<URL> {
  const candidate = String(raw ?? '').trim();
  if (candidate.length === 0) return fail('empty URL', candidate);

  // Control characters and backslashes are how a URL is made to parse one way
  // here and another way in a different parser. Refused before parsing.
  for (const character of candidate) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return fail('URL contains a control character', candidate);
  }
  if (candidate.includes('\\')) return fail('URL contains a backslash', candidate);
  if (/\s/.test(candidate)) return fail('URL contains whitespace', candidate);

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail('URL is malformed', candidate);
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') {
    return fail(`scheme '${url.protocol}' is not http(s)`, candidate);
  }

  // https://trusted.example@evil.test/ is a request to evil.test that reads as
  // a request to trusted.example. There is no legitimate use for userinfo here.
  if (url.username !== '' || url.password !== '') {
    return fail('URL carries userinfo credentials', candidate);
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0) return fail('URL has no host', candidate);
  if (host.includes('%')) return fail('host contains percent-encoding', candidate);

  // URL() keeps IPv6 literals in brackets.
  const bracketed = host.startsWith('[') && host.endsWith(']');
  if (bracketed) {
    const address = host.slice(1, -1);
    if (isPrivateIpv6(address)) return fail('host is a non-global IPv6 address', candidate);
    return ok(url);
  }

  const octets = parseIpv4(host);
  if (octets !== null) {
    if (isPrivateIpv4(octets)) return fail('host is a non-global IPv4 address', candidate);
    return ok(url);
  }

  if (BLOCKED_HOSTS.has(host)) return fail(`host '${host}' is a local name`, candidate);
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) return fail(`host suffix '${suffix}' is private`, candidate);
  }

  // A single-label host is an intranet name, not a public site. Public names
  // always carry a dot.
  if (!host.includes('.')) return fail('host is a single-label intranet name', candidate);

  return ok(url);
}
