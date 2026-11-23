import crypto from 'node:crypto';

const HASH_PREFIX = 'scrypt$';
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
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
  const expected = Buffer.from(hexHash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function signSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
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

export function verifySessionToken(token: string): string | null {
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
    ) as { userId?: string; exp?: number };
    if (!decoded.userId || !decoded.exp || Date.now() > decoded.exp) {
      return null;
    }
    return decoded.userId;
  } catch {
    return null;
  }
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

export function makeUuid(): string {
  return crypto.randomUUID();
}
