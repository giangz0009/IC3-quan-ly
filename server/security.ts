import crypto from 'node:crypto';

const HASH_PREFIX = 'scrypt$';
const FALLBACK_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''
).trim();
const SESSION_SECRET =
  process.env.SESSION_SECRET?.trim() ||
  (FALLBACK_KEY
    ? crypto
        .createHmac('sha256', 'ic3-master-admin-session-v1')
        .update(FALLBACK_KEY)
        .digest('hex')
    : crypto.randomBytes(32).toString('hex'));
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const revokedTokens = new Set<string>();

export function hashTeacherPassword(password: string): string {
  if (password.startsWith(HASH_PREFIX)) return password;
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${HASH_PREFIX}${salt}$${derived}`;
}

export function verifyTeacherPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  if (!stored.startsWith(HASH_PREFIX)) {
    const a = Buffer.from(password, 'utf8');
    const b = Buffer.from(stored, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const [, salt, hexHash] = parts;
  if (!salt || !hexHash || hexHash.length % 2 !== 0) return false;
  try {
    const expected = Buffer.from(hexHash, 'hex');
    if (expected.length < 16) return false;
    const actual = crypto.scryptSync(password, salt, expected.length);
    return (
      expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export function signSessionToken(userId: string, email?: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      ...(email ? { email: email.trim().toLowerCase() } : {}),
      jti: crypto.randomBytes(8).toString('hex'),
      exp: Date.now() + SESSION_TTL_MS,
    }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionPayload(
  token: string
): { userId: string; email?: string } | null {
  if (!token || revokedTokens.has(token)) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as { userId?: string; email?: string; exp?: number };
    if (!decoded.userId || !decoded.exp || Date.now() > decoded.exp) {
      return null;
    }
    return {
      userId: decoded.userId,
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
    };
  } catch {
    return null;
  }
}

export function verifySessionToken(token: string): string | null {
  return verifySessionPayload(token)?.userId ?? null;
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

export function makeUuid(): string {
  return crypto.randomUUID();
}
