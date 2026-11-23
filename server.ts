import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSeedDatabase } from './src/data/seedData';
import {
  buildAdminTeachersSupabasePayload,
  calculateIC3Score,
  canDeleteOrDemoteMaster,
  getDefaultInstructionForQuestionType,
  getNextTopicOrder,
  isSafeRemoteSupabaseUrl,
  isStudentBreakUnlocked,
  mergeRemoteTeachersWithLocal,
  normalizeAdminRole,
  normalizeTeacherStatus,
  normalizeVietnamesePassword,
  rankBattleParticipants,
} from './src/utils/ic3Rules';
import type {
  AdminDatabase,
  AdminRole,
  AdminTeacher,
  BattleDebuffType,
  BattleRoomState,
  ClassBattleConfig,
  ClassTaskConfig,
  IC3ModuleRecord,
  KnowledgeCategoryRecord,
  KnowledgePart,
  Question,
  QuestionSet,
  School,
  SchoolClass,
  StudentProfile,
  TeacherAccountStatus,
} from './src/types/ic3';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'ic3_admin_db.json');

const HASH_PREFIX = 'scrypt$';
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const revokedTokens = new Set<string>();

function hashTeacherPassword(password: string): string {
  if (password.startsWith(HASH_PREFIX)) return password;
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${HASH_PREFIX}${salt}$${derived}`;
}

function verifyTeacherPassword(password: string, stored: string): boolean {
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

function signSessionToken(userId: string): string {
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

function verifySessionToken(token: string): string | null {
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

function ensureDb(): AdminDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const seed = createSeedDatabase();
    seed.teachers = seed.teachers.map((t) => ({
      ...t,
      password: hashTeacherPassword(t.password),
    }));
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as AdminDatabase;
    const seed = createSeedDatabase();
    let changed = false;
    if (!Array.isArray(parsed.modules)) {
      parsed.modules = seed.modules;
      changed = true;
    }
    if (!Array.isArray(parsed.knowledgeCategories)) {
      parsed.knowledgeCategories = seed.knowledgeCategories;
      changed = true;
    }
    if (!Array.isArray(parsed.knowledgeParts)) {
      parsed.knowledgeParts = seed.knowledgeParts;
      changed = true;
    }
    if (!Array.isArray(parsed.teachers) || parsed.teachers.length === 0) {
      parsed.teachers = seed.teachers;
      changed = true;
    } else {
      const migratedTeachers: AdminTeacher[] = [];
      for (const rawT of parsed.teachers) {
        const legacy = rawT as AdminTeacher & { schoolId?: unknown };
        const nextRole = normalizeAdminRole(legacy.role);
        const nextEmail =
          legacy.userId === 'teacher_nd_01' &&
          legacy.email === 'ha.tran@nguyendu.edu.vn'
            ? 'giangday.lv1@ic3master.edu.vn'
            : legacy.email;
        const nextStatus = normalizeTeacherStatus(legacy.status);
        const nextPassword = hashTeacherPassword(legacy.password || '');
        if (
          legacy.role !== nextRole ||
          legacy.status !== nextStatus ||
          'schoolId' in legacy ||
          nextEmail !== legacy.email ||
          nextPassword !== legacy.password
        ) {
          changed = true;
        }
        migratedTeachers.push({
          userId: legacy.userId,
          fullName: legacy.fullName,
          email: nextEmail,
          password: nextPassword,
          role: nextRole,
          status: nextStatus,
          createdAt: legacy.createdAt,
        });
      }
      if (
        !migratedTeachers.some((t) => t.role === 'teacher_lv2') &&
        migratedTeachers.some((t) => t.userId === 'teacher_admin_01') &&
        migratedTeachers.some((t) => t.userId === 'teacher_nd_01')
      ) {
        const seedLv2 = seed.teachers.find((t) => t.role === 'teacher_lv2');
        if (seedLv2 && !migratedTeachers.some((t) => t.email === seedLv2.email)) {
          migratedTeachers.splice(1, 0, {
            ...seedLv2,
            password: hashTeacherPassword(seedLv2.password),
          });
          changed = true;
        }
      }
      parsed.teachers = migratedTeachers;
    }
    const seedQuestionMap = new Map(seed.questions.map((q) => [q.id, q]));
    for (const q of parsed.questions) {
      if (!q.contentCode || typeof q.topicOrder !== 'number') {
        const ref = seedQuestionMap.get(q.id);
        q.contentCode = q.contentCode || ref?.contentCode || `${q.category}1`;
        q.topicOrder = typeof q.topicOrder === 'number' ? q.topicOrder : ref?.topicOrder ?? 1;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
    }
    return parsed;
  } catch {
    const seed = createSeedDatabase();
    seed.teachers = seed.teachers.map((t) => ({
      ...t,
      password: hashTeacherPassword(t.password),
    }));
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
}

let db: AdminDatabase = ensureDb();

function saveDb(): void {
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

function sanitizeTeachers(teachers: AdminTeacher[]) {
  return teachers.map(({ password: _pw, ...rest }) => ({
    ...rest,
    role: normalizeAdminRole(rest.role),
    status: normalizeTeacherStatus(rest.status),
  }));
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

interface SupabaseSyncStatus {
  configured: boolean;
  ok: boolean;
  error?: string;
  count?: number;
}

function resolveSupabaseClient(input?: {
  supabaseUrl?: unknown;
  supabaseAnonKey?: unknown;
}): { client: SupabaseClient | null; invalidReason?: string } {
  const bodyUrl =
    typeof input?.supabaseUrl === 'string' ? input.supabaseUrl.trim() : '';
  const bodyKey =
    typeof input?.supabaseAnonKey === 'string'
      ? input.supabaseAnonKey.trim()
      : '';
  const envUrl = (process.env.SUPABASE_URL || '').trim();
  const envKey = (process.env.SUPABASE_ANON_KEY || '').trim();

  const url = bodyUrl || envUrl;
  const anonKey = bodyKey || envKey;

  if (!url || !anonKey) {
    return { client: null };
  }
  if (!isSafeRemoteSupabaseUrl(url)) {
    return {
      client: null,
      invalidReason:
        'Supabase Project URL không hợp lệ hoặc không thuộc máy chủ công khai được phép kết nối.',
    };
  }
  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { client };
  } catch {
    return {
      client: null,
      invalidReason: 'Không thể khởi tạo kết nối tới Supabase.',
    };
  }
}

async function syncTeachersToSupabaseServer(
  client: SupabaseClient,
  teachers: AdminTeacher[]
): Promise<SupabaseSyncStatus> {
  const payload = buildAdminTeachersSupabasePayload(teachers);
  if (payload.length === 0) {
    return { configured: true, ok: true, count: 0 };
  }
  try {
    const { data: existingRows, error: selectErr } = await client
      .from('admin_teachers')
      .select('user_id, email');
    if (selectErr) {
      return { configured: true, ok: false, error: selectErr.message };
    }

    const existingByUserId = new Map<string, string>();
    const existingByEmail = new Map<string, string>();
    for (const row of existingRows ?? []) {
      const uid = String(row.user_id ?? '').trim();
      const em = String(row.email ?? '').trim().toLowerCase();
      if (uid) existingByUserId.set(uid, em);
      if (em && uid) existingByEmail.set(em, uid);
    }

    const usedTargetIds = new Set<string>();
    const alignedPayload = payload.map((item) => {
      let targetUserId = item.user_id;
      const emailOwnerId = existingByEmail.get(item.email);
      if (
        emailOwnerId &&
        !existingByUserId.has(item.user_id) &&
        !usedTargetIds.has(emailOwnerId)
      ) {
        targetUserId = emailOwnerId;
      }
      usedTargetIds.add(targetUserId);
      return {
        ...item,
        user_id: targetUserId,
      };
    });

    const { error: upsertErr } = await client
      .from('admin_teachers')
      .upsert(alignedPayload, { onConflict: 'user_id' });
    if (upsertErr) {
      return { configured: true, ok: false, error: upsertErr.message };
    }
    return { configured: true, ok: true, count: alignedPayload.length };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : 'Lỗi đồng bộ giáo viên lên Supabase.',
    };
  }
}

async function upsertSingleTeacherOnSupabaseServer(
  client: SupabaseClient,
  teacher: AdminTeacher,
  previousEmail?: string
): Promise<SupabaseSyncStatus> {
  try {
    const { data: existingRows, error: selectErr } = await client
      .from('admin_teachers')
      .select('user_id, email');
    if (selectErr) {
      return { configured: true, ok: false, error: selectErr.message };
    }

    const cleanEmail = teacher.email.trim().toLowerCase();
    const prevCleanEmail = previousEmail?.trim().toLowerCase();

    const matchedById = (existingRows ?? []).find(
      (r) => String(r.user_id ?? '').trim() === teacher.userId
    );
    const matchedByPrevEmail = prevCleanEmail
      ? (existingRows ?? []).find(
          (r) => String(r.email ?? '').trim().toLowerCase() === prevCleanEmail
        )
      : undefined;
    const matchedByEmail = (existingRows ?? []).find(
      (r) => String(r.email ?? '').trim().toLowerCase() === cleanEmail
    );

    const targetUserId = String(
      matchedById?.user_id ??
        matchedByPrevEmail?.user_id ??
        matchedByEmail?.user_id ??
        teacher.userId
    ).trim();

    if (
      matchedByEmail &&
      String(matchedByEmail.user_id ?? '').trim() !== targetUserId
    ) {
      return {
        configured: true,
        ok: false,
        error: `Email ${cleanEmail} đã thuộc tài khoản khác trên Supabase.`,
      };
    }

    const row = buildAdminTeachersSupabasePayload([teacher])[0];
    if (!row) {
      return { configured: true, ok: false, error: 'Dữ liệu giáo viên không hợp lệ.' };
    }

    const { error: upsertErr } = await client
      .from('admin_teachers')
      .upsert({ ...row, user_id: targetUserId }, { onConflict: 'user_id' });
    if (upsertErr) {
      return { configured: true, ok: false, error: upsertErr.message };
    }
    return { configured: true, ok: true, count: 1 };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : 'Lỗi cập nhật giáo viên trên Supabase.',
    };
  }
}

async function deleteTeacherOnSupabaseServer(
  client: SupabaseClient,
  teacher: Pick<AdminTeacher, 'userId' | 'email'>
): Promise<SupabaseSyncStatus> {
  try {
    const { error: idErr } = await client
      .from('admin_teachers')
      .delete()
      .eq('user_id', teacher.userId);
    if (idErr) {
      return { configured: true, ok: false, error: idErr.message };
    }
    const cleanEmail = teacher.email.trim().toLowerCase();
    if (cleanEmail) {
      const { error: emailErr } = await client
        .from('admin_teachers')
        .delete()
        .eq('email', cleanEmail);
      if (emailErr) {
        return { configured: true, ok: false, error: emailErr.message };
      }
    }
    return { configured: true, ok: true, count: 1 };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : 'Lỗi xóa giáo viên trên Supabase.',
    };
  }
}

function upsertRemoteTeacherIntoLocalDb(
  remoteRow: Record<string, unknown>,
  verifiedPlainPassword?: string
): AdminTeacher | null {
  const email = String(remoteRow.email ?? '').trim().toLowerCase();
  const userId = String(remoteRow.user_id ?? '').trim();
  if (!email || !userId) return null;

  const remoteHash =
    typeof remoteRow.password_hash === 'string'
      ? remoteRow.password_hash.trim()
      : '';
  const idx = db.teachers.findIndex(
    (t) => t.userId === userId || t.email.trim().toLowerCase() === email
  );
  const existing = idx >= 0 ? db.teachers[idx] : undefined;
  const nextPassword = remoteHash
    ? hashTeacherPassword(remoteHash)
    : verifiedPlainPassword
      ? hashTeacherPassword(verifiedPlainPassword)
      : existing?.password || '';

  const nextTeacher: AdminTeacher = {
    userId: existing?.userId || userId,
    fullName:
      String(remoteRow.full_name ?? existing?.fullName ?? email).trim() || email,
    email,
    password: nextPassword,
    role: normalizeAdminRole(
      typeof remoteRow.role === 'string' ? remoteRow.role : existing?.role
    ),
    status: normalizeTeacherStatus(
      typeof remoteRow.status === 'string' ? remoteRow.status : existing?.status
    ),
    createdAt: String(
      remoteRow.created_at ?? existing?.createdAt ?? new Date().toISOString()
    ),
  };

  if (idx >= 0) {
    db.teachers[idx] = nextTeacher;
  } else {
    db.teachers.push(nextTeacher);
  }
  saveDb();
  return nextTeacher;
}

interface AuthedRequest extends express.Request {
  authTeacher?: Omit<AdminTeacher, 'password'>;
  authToken?: string;
}

function requireAuth(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization;
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
  const userId = verifySessionToken(token);
  if (!userId) {
    return res
      .status(401)
      .json({ error: 'Phiên đăng nhập hết hạn hoặc chưa xác thực. Vui lòng đăng nhập lại.' });
  }
  const found = db.teachers.find((t) => t.userId === userId);
  if (!found) {
    return res
      .status(401)
      .json({ error: 'Tài khoản giáo viên không còn tồn tại trong hệ thống.' });
  }
  if (normalizeTeacherStatus(found.status) === 'locked') {
    return res
      .status(401)
      .json({ error: 'Tài khoản giáo viên đã bị tạm khóa.' });
  }
  const { password: _pw, ...safeTeacher } = found;
  req.authTeacher = {
    ...safeTeacher,
    role: normalizeAdminRole(safeTeacher.role),
    status: normalizeTeacherStatus(safeTeacher.status),
  };
  req.authToken = token;
  return next();
}

function requireRoles(...allowedRoles: AdminRole[]) {
  return (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    requireAuth(req, res, () => {
      const role = req.authTeacher?.role;
      if (!role || !allowedRoles.includes(role)) {
        return res.status(403).json({
          error: 'Tài khoản của bạn không đủ quyền thực hiện thao tác này.',
        });
      }
      return next();
    });
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // --- Health ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // --- Auth & Teachers ---
  app.post('/api/auth/login', async (req, res) => {
    const { email, password, supabaseUrl, supabaseAnonKey } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ email và mật khẩu.' });
    }

    const { client: sbClient } = resolveSupabaseClient({
      supabaseUrl,
      supabaseAnonKey,
    });

    if (sbClient) {
      try {
        const escapedPattern = cleanEmail.replace(/[\\%_]/g, '\\$&');
        const { data: remoteRow, error: remoteErr } = await sbClient
          .from('admin_teachers')
          .select('user_id, full_name, email, password_hash, role, status, created_at')
          .ilike('email', escapedPattern)
          .maybeSingle();

        if (!remoteErr && remoteRow) {
          const remoteHash =
            typeof remoteRow.password_hash === 'string'
              ? remoteRow.password_hash.trim()
              : '';
          let verified = remoteHash
            ? verifyTeacherPassword(password, remoteHash)
            : false;

          if (!verified) {
            const { data: authData, error: authErr } =
              await sbClient.auth.signInWithPassword({
                email: cleanEmail,
                password,
              });
            if (!authErr && authData.user) {
              verified = true;
            }
          }

          if (!verified && !remoteHash) {
            const localMatch = db.teachers.find(
              (t) => t.email.trim().toLowerCase() === cleanEmail
            );
            if (localMatch && verifyTeacherPassword(password, localMatch.password)) {
              verified = true;
            }
          }

          if (!verified) {
            return res
              .status(401)
              .json({ error: 'Email hoặc mật khẩu giáo viên không chính xác.' });
          }

          const synced = upsertRemoteTeacherIntoLocalDb(
            remoteRow as Record<string, unknown>,
            password
          );
          if (!synced) {
            return res
              .status(500)
              .json({ error: 'Dữ liệu tài khoản giáo viên trên Supabase không hợp lệ.' });
          }

          const teacherStatus = normalizeTeacherStatus(synced.status);
          if (teacherStatus === 'locked') {
            return res.status(403).json({
              error: 'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ Giáo viên Master.',
            });
          }

          const token = signSessionToken(synced.userId);
          const { password: _pw, ...safeTeacher } = synced;
          return res.json({
            teacher: {
              ...safeTeacher,
              role: normalizeAdminRole(safeTeacher.role),
              status: teacherStatus,
            },
            token,
            authSource: 'supabase' as const,
          });
        }

        // If row was not found by email, check Supabase Auth directly
        const { data: authData, error: authErr } =
          await sbClient.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
        if (!authErr && authData.user) {
          const { data: byUidRow } = await sbClient
            .from('admin_teachers')
            .select('user_id, full_name, email, password_hash, role, status, created_at')
            .eq('user_id', authData.user.id)
            .maybeSingle();

          const localFallback = db.teachers.find(
            (t) => t.email.trim().toLowerCase() === cleanEmail
          );
          const mergedRow: Record<string, unknown> = byUidRow ?? {
            user_id: localFallback?.userId || authData.user.id,
            full_name:
              (authData.user.user_metadata?.full_name as string | undefined) ||
              localFallback?.fullName ||
              cleanEmail,
            email: authData.user.email || cleanEmail,
            password_hash: '',
            role: localFallback?.role || 'teacher_lv1',
            status: localFallback?.status || 'active',
            created_at: localFallback?.createdAt || new Date().toISOString(),
          };

          const synced = upsertRemoteTeacherIntoLocalDb(mergedRow, password);
          if (synced) {
            const teacherStatus = normalizeTeacherStatus(synced.status);
            if (teacherStatus === 'locked') {
              return res.status(403).json({
                error:
                  'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ Giáo viên Master.',
              });
            }
            const token = signSessionToken(synced.userId);
            const { password: _pw, ...safeTeacher } = synced;
            return res.json({
              teacher: {
                ...safeTeacher,
                role: normalizeAdminRole(safeTeacher.role),
                status: teacherStatus,
              },
              token,
              authSource: 'supabase' as const,
            });
          }
        }
      } catch {
        // Fallback smoothly to local DB if Supabase is temporarily unreachable
      }
    }

    const found = db.teachers.find(
      (t) =>
        t.email.toLowerCase() === cleanEmail &&
        verifyTeacherPassword(password, t.password)
    );
    if (!found) {
      return res
        .status(401)
        .json({ error: 'Email hoặc mật khẩu giáo viên không chính xác.' });
    }
    const teacherStatus = normalizeTeacherStatus(found.status);
    if (teacherStatus === 'locked') {
      return res.status(403).json({
        error: 'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ Giáo viên Master.',
      });
    }
    const token = signSessionToken(found.userId);
    const { password: _pw, ...safeTeacher } = found;
    return res.json({
      teacher: {
        ...safeTeacher,
        role: normalizeAdminRole(safeTeacher.role),
        status: teacherStatus,
      },
      token,
      authSource: 'local' as const,
    });
  });

  app.post('/api/auth/logout', (req: AuthedRequest, res) => {
    const authHeader = req.headers.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
    if (token) revokedTokens.add(token);
    return res.json({ ok: true });
  });

  app.get('/api/bootstrap', requireAuth, (req: AuthedRequest, res) => {
    const isMaster = req.authTeacher?.role === 'master';
    res.json({
      ...db,
      teachers: isMaster ? sanitizeTeachers(db.teachers) : [],
    });
  });

  app.post('/api/teachers/sync-supabase', requireRoles('master'), async (req, res) => {
    const { client, invalidReason } = resolveSupabaseClient(req.body ?? {});
    if (!client) {
      return res.status(400).json({
        error:
          invalidReason ||
          'Chưa cấu hình Supabase URL và Anon Key hợp lệ để đồng bộ giáo viên.',
      });
    }
    const syncRes = await syncTeachersToSupabaseServer(client, db.teachers);
    if (!syncRes.ok) {
      return res.status(502).json({
        error: `Không thể đẩy danh sách giáo viên lên Supabase: ${syncRes.error}`,
      });
    }
    return res.json({
      ok: true,
      count: syncRes.count ?? 0,
      message: `Đã đồng bộ ${syncRes.count ?? 0} tài khoản giáo viên lên bảng public.admin_teachers của Supabase.`,
    });
  });

  app.post('/api/teachers/pull-supabase', requireRoles('master'), async (req, res) => {
    const { client, invalidReason } = resolveSupabaseClient(req.body ?? {});
    if (!client) {
      return res.status(400).json({
        error:
          invalidReason ||
          'Chưa cấu hình Supabase URL và Anon Key hợp lệ để lấy danh sách giáo viên.',
      });
    }
    const { data, error } = await client
      .from('admin_teachers')
      .select('user_id, full_name, email, password_hash, role, status, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(502).json({
        error: `Không thể đọc bảng public.admin_teachers từ Supabase: ${error.message}`,
      });
    }
    const remoteRows = Array.isArray(data)
      ? (data as Array<Record<string, unknown>>)
      : [];
    if (remoteRows.length === 0) {
      return res.json({
        ok: true,
        addedCount: 0,
        updatedCount: 0,
        total: db.teachers.length,
        teachers: sanitizeTeachers(db.teachers),
        message:
          'Bảng public.admin_teachers trên Supabase hiện đang trống (0 dòng).',
      });
    }

    const { merged, addedCount, updatedCount } = mergeRemoteTeachersWithLocal(
      db.teachers,
      remoteRows
    );
    db.teachers = merged.map((t) => ({
      ...t,
      password: t.password ? hashTeacherPassword(t.password) : '',
    }));
    saveDb();

    return res.json({
      ok: true,
      addedCount,
      updatedCount,
      total: db.teachers.length,
      teachers: sanitizeTeachers(db.teachers),
      message: `Đã lấy danh sách giáo viên từ Supabase (thêm mới ${addedCount}, cập nhật ${updatedCount}).`,
    });
  });

  app.post('/api/teachers', requireRoles('master'), async (req, res) => {
    const { fullName, email, password, role, status, supabaseUrl, supabaseAnonKey } =
      req.body ?? {};
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Thiếu họ tên, email hoặc mật khẩu.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (db.teachers.some((t) => t.email.toLowerCase() === cleanEmail)) {
      return res.status(409).json({ error: 'Email giáo viên đã tồn tại.' });
    }
    const nextRole = normalizeAdminRole(typeof role === 'string' ? role : 'teacher_lv1');
    const nextStatus: TeacherAccountStatus = normalizeTeacherStatus(
      typeof status === 'string' ? status : 'active'
    );
    const teacher: AdminTeacher = {
      userId: makeId('teacher'),
      fullName: String(fullName).trim(),
      email: cleanEmail,
      password: hashTeacherPassword(String(password)),
      role: nextRole,
      status: nextStatus,
      createdAt: new Date().toISOString(),
    };
    db.teachers.push(teacher);
    saveDb();

    const { client: sbClient, invalidReason } = resolveSupabaseClient({
      supabaseUrl,
      supabaseAnonKey,
    });
    let supabaseSync: SupabaseSyncStatus = invalidReason
      ? { configured: true, ok: false, error: invalidReason }
      : { configured: false, ok: true };
    if (sbClient) {
      supabaseSync = await upsertSingleTeacherOnSupabaseServer(sbClient, teacher);
    }

    const { password: _pw, ...safe } = teacher;
    return res.status(201).json({ ...safe, supabaseSync });
  });

  app.put('/api/teachers/:userId', requireRoles('master'), async (req: AuthedRequest, res) => {
    const { userId } = req.params;
    const teacher = db.teachers.find((t) => t.userId === userId);
    if (!teacher) {
      return res.status(404).json({ error: 'Không tìm thấy giáo viên.' });
    }
    const { fullName, email, password, role, status, supabaseUrl, supabaseAnonKey } =
      req.body ?? {};
    const nextRole =
      typeof role === 'string' ? normalizeAdminRole(role) : teacher.role;
    const nextStatus: TeacherAccountStatus =
      typeof status === 'string'
        ? normalizeTeacherStatus(status)
        : normalizeTeacherStatus(teacher.status);

    const masterCheck = canDeleteOrDemoteMaster(
      db.teachers,
      userId,
      nextRole,
      nextStatus
    );
    if (!masterCheck.ok) {
      return res.status(400).json({ error: masterCheck.error });
    }
    if (
      req.authTeacher?.userId === userId &&
      nextRole !== 'master'
    ) {
      return res.status(400).json({
        error: 'Không thể tự hạ quyền Master của tài khoản đang đăng nhập.',
      });
    }
    if (
      req.authTeacher?.userId === userId &&
      nextStatus === 'locked'
    ) {
      return res.status(400).json({
        error: 'Không thể tự tạm khóa tài khoản đang đăng nhập.',
      });
    }

    const previousEmail = teacher.email;
    if (typeof email === 'string' && email.trim()) {
      const cleanEmail = email.trim().toLowerCase();
      if (
        cleanEmail !== teacher.email.toLowerCase() &&
        db.teachers.some((t) => t.userId !== userId && t.email.toLowerCase() === cleanEmail)
      ) {
        return res.status(409).json({ error: 'Email giáo viên đã được tài khoản khác sử dụng.' });
      }
      teacher.email = cleanEmail;
    }
    if (typeof fullName === 'string' && fullName.trim()) {
      teacher.fullName = fullName.trim();
    }
    if (typeof password === 'string' && password.trim()) {
      teacher.password = hashTeacherPassword(password);
    }
    teacher.role = nextRole;
    teacher.status = nextStatus;
    saveDb();

    const { client: sbClient, invalidReason } = resolveSupabaseClient({
      supabaseUrl,
      supabaseAnonKey,
    });
    let supabaseSync: SupabaseSyncStatus = invalidReason
      ? { configured: true, ok: false, error: invalidReason }
      : { configured: false, ok: true };
    if (sbClient) {
      supabaseSync = await upsertSingleTeacherOnSupabaseServer(
        sbClient,
        teacher,
        previousEmail
      );
    }

    const { password: _pw, ...safe } = teacher;
    return res.json({ ...safe, supabaseSync });
  });

  app.delete('/api/teachers/:userId', requireRoles('master'), async (req: AuthedRequest, res) => {
    const { userId } = req.params;
    if (req.authTeacher?.userId === userId) {
      return res.status(400).json({ error: 'Không thể tự xóa tài khoản đang đăng nhập.' });
    }
    const masterCheck = canDeleteOrDemoteMaster(db.teachers, userId);
    if (!masterCheck.ok) {
      return res.status(400).json({ error: masterCheck.error });
    }
    const idx = db.teachers.findIndex((t) => t.userId === userId);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy giáo viên.' });
    const removed = db.teachers[idx];
    db.teachers.splice(idx, 1);
    saveDb();

    const { supabaseUrl, supabaseAnonKey } = req.body ?? {};
    const { client: sbClient, invalidReason } = resolveSupabaseClient({
      supabaseUrl,
      supabaseAnonKey,
    });
    let supabaseSync: SupabaseSyncStatus = invalidReason
      ? { configured: true, ok: false, error: invalidReason }
      : { configured: false, ok: true };
    if (sbClient) {
      supabaseSync = await deleteTeacherOnSupabaseServer(sbClient, removed);
    }

    return res.json({ ok: true, supabaseSync });
  });

  // --- Schools (Master only) ---
  app.post('/api/schools', requireRoles('master'), (req, res) => {
    const { name, district } = req.body ?? {};
    if (!name || !district) {
      return res.status(400).json({ error: 'Thiếu tên trường hoặc quận/huyện.' });
    }
    const school: School = {
      id: makeId('school'),
      name: String(name).trim(),
      district: String(district).trim(),
      createdAt: new Date().toISOString(),
    };
    db.schools.push(school);
    saveDb();
    return res.status(201).json(school);
  });

  app.put('/api/schools/:id', requireRoles('master'), (req, res) => {
    const school = db.schools.find((s) => s.id === req.params.id);
    if (!school) return res.status(404).json({ error: 'Không tìm thấy trường.' });
    const { name, district } = req.body ?? {};
    if (name) school.name = String(name).trim();
    if (district) school.district = String(district).trim();
    saveDb();
    return res.json(school);
  });

  app.delete('/api/schools/:id', requireRoles('master'), (req, res) => {
    const schoolId = req.params.id;
    const classIds = new Set(
      db.classes.filter((c) => c.schoolId === schoolId).map((c) => c.id)
    );
    const studentIds = new Set(
      db.students.filter((st) => classIds.has(st.classId)).map((st) => st.id)
    );
    db.schools = db.schools.filter((s) => s.id !== schoolId);
    db.classes = db.classes.filter((c) => c.schoolId !== schoolId);
    db.students = db.students.filter((st) => !classIds.has(st.classId));
    db.classTaskConfigs = db.classTaskConfigs.filter((c) => !classIds.has(c.classId));
    db.battleConfigs = db.battleConfigs.filter((c) => !classIds.has(c.classId));
    db.battleRooms = db.battleRooms.filter((r) => !classIds.has(r.classId));
    db.submissions = db.submissions.filter((sub) => !studentIds.has(sub.studentId));
    db.breakStates = db.breakStates.filter((b) => !studentIds.has(b.studentId));
    saveDb();
    return res.json({ ok: true });
  });

  // --- Classes (All teacher roles across any school) ---
  app.post('/api/classes', requireAuth, (req, res) => {
    const { schoolId, name, grade } = req.body ?? {};
    if (!schoolId || !name || !grade) {
      return res.status(400).json({ error: 'Thiếu thông tin lớp học.' });
    }
    const schoolExists = db.schools.some((s) => s.id === schoolId);
    if (!schoolExists) {
      return res.status(404).json({ error: 'Trường học không tồn tại.' });
    }
    const newClass: SchoolClass = {
      id: makeId('class'),
      schoolId: String(schoolId),
      name: String(name).trim(),
      grade: String(grade).trim(),
      createdAt: new Date().toISOString(),
    };
    db.classes.push(newClass);
    saveDb();
    return res.status(201).json(newClass);
  });

  app.put('/api/classes/:id', requireAuth, (req, res) => {
    const cls = db.classes.find((c) => c.id === req.params.id);
    if (!cls) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
    const { name, grade } = req.body ?? {};
    if (name) cls.name = String(name).trim();
    if (grade) cls.grade = String(grade).trim();
    saveDb();
    return res.json(cls);
  });

  app.delete('/api/classes/:id', requireAuth, (req, res) => {
    const classId = req.params.id;
    const studentIds = new Set(
      db.students.filter((st) => st.classId === classId).map((st) => st.id)
    );
    db.classes = db.classes.filter((c) => c.id !== classId);
    db.students = db.students.filter((st) => st.classId !== classId);
    db.classTaskConfigs = db.classTaskConfigs.filter((c) => c.classId !== classId);
    db.battleConfigs = db.battleConfigs.filter((c) => c.classId !== classId);
    db.battleRooms = db.battleRooms.filter((r) => r.classId !== classId);
    db.submissions = db.submissions.filter((sub) => !studentIds.has(sub.studentId));
    db.breakStates = db.breakStates.filter((b) => !studentIds.has(b.studentId));
    saveDb();
    return res.json({ ok: true });
  });

  // --- Students (All teacher roles across any school) ---
  app.post('/api/students', requireAuth, (req, res) => {
    const { classId, fullName, studentCode, alwaysBreakReady } = req.body ?? {};
    if (!classId || !fullName || !studentCode) {
      return res.status(400).json({ error: 'Thiếu lớp, họ tên hoặc mã học sinh.' });
    }
    const cls = db.classes.find((c) => c.id === classId);
    if (!cls) return res.status(404).json({ error: 'Lớp học không tồn tại.' });
    const trimmedCode = String(studentCode).trim().toUpperCase();
    const duplicate = db.students.some(
      (s) => s.classId === classId && s.studentCode.toUpperCase() === trimmedCode
    );
    if (duplicate) {
      return res.status(409).json({ error: `Mã học sinh ${trimmedCode} đã tồn tại trong lớp.` });
    }
    const trimmedName = String(fullName).trim();
    const defaultPw = normalizeVietnamesePassword(trimmedName);
    const student: StudentProfile = {
      id: makeId('st'),
      classId: String(classId),
      fullName: trimmedName,
      studentCode: trimmedCode,
      passwordHash: defaultPw,
      isCustomPassword: false,
      alwaysBreakReady: Boolean(alwaysBreakReady),
      createdAt: new Date().toISOString(),
    };
    db.students.push(student);
    saveDb();
    return res.status(201).json(student);
  });

  app.post('/api/students/batch', requireAuth, (req, res) => {
    const { classId, rows } = req.body ?? {};
    if (!classId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Danh sách nhập học sinh không hợp lệ.' });
    }
    const cls = db.classes.find((c) => c.id === classId);
    if (!cls) return res.status(404).json({ error: 'Lớp học không tồn tại.' });

    const created: StudentProfile[] = [];
    const skipped: string[] = [];

    for (const row of rows) {
      const fullName = String(row.fullName ?? '').trim();
      const studentCode = String(row.studentCode ?? '').trim().toUpperCase();
      if (!fullName || !studentCode) continue;

      const exists = db.students.some(
        (s) => s.classId === classId && s.studentCode.toUpperCase() === studentCode
      );
      if (exists) {
        skipped.push(studentCode);
        continue;
      }

      const student: StudentProfile = {
        id: makeId('st'),
        classId,
        fullName,
        studentCode,
        passwordHash: normalizeVietnamesePassword(fullName),
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: new Date().toISOString(),
      };
      db.students.push(student);
      created.push(student);
    }

    saveDb();
    return res.status(201).json({ created, skipped });
  });

  app.put('/api/students/:id', requireAuth, (req, res) => {
    const student = db.students.find((s) => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
    const { fullName, studentCode, alwaysBreakReady } = req.body ?? {};
    if (fullName) {
      student.fullName = String(fullName).trim();
      if (!student.isCustomPassword) {
        student.passwordHash = normalizeVietnamesePassword(student.fullName);
      }
    }
    if (studentCode) {
      student.studentCode = String(studentCode).trim().toUpperCase();
    }
    if (typeof alwaysBreakReady === 'boolean') {
      student.alwaysBreakReady = alwaysBreakReady;
    }
    saveDb();
    return res.json(student);
  });

  app.delete('/api/students/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    db.students = db.students.filter((s) => s.id !== id);
    db.submissions = db.submissions.filter((sub) => sub.studentId !== id);
    db.breakStates = db.breakStates.filter((b) => b.studentId !== id);
    saveDb();
    return res.json({ ok: true });
  });

  app.post('/api/students/:id/reset-password', requireAuth, (req, res) => {
    const student = db.students.find((s) => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
    student.passwordHash = normalizeVietnamesePassword(student.fullName);
    student.isCustomPassword = false;
    saveDb();
    return res.json(student);
  });

  app.post('/api/classes/:id/reset-passwords', requireAuth, (req, res) => {
    const classId = req.params.id;
    let count = 0;
    for (const student of db.students) {
      if (student.classId === classId) {
        student.passwordHash = normalizeVietnamesePassword(student.fullName);
        student.isCustomPassword = false;
        count++;
      }
    }
    saveDb();
    return res.json({ ok: true, count });
  });

  // --- Modules (Levels — teacher_lv2 & master only) ---
  app.post('/api/modules', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const body = req.body as Partial<IC3ModuleRecord>;
    const level = String(body.level ?? '').trim().toUpperCase();
    const title = String(body.title ?? '').trim();
    const rawCode = String(body.code ?? level)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!level || !title || !rawCode) {
      return res.status(400).json({ error: 'Thiếu Level, mã hoặc tên Mô-đun.' });
    }
    if (
      db.modules.some(
        (m) =>
          m.code.toLowerCase() === rawCode ||
          m.level.toUpperCase() === level
      )
    ) {
      return res.status(409).json({
        error: `Mô-đun ${level} (${rawCode}) đã tồn tại trong CSDL.`,
      });
    }
    const created: IC3ModuleRecord = {
      id: makeId('mod'),
      code: rawCode,
      level,
      title,
      description: String(body.description ?? '').trim(),
      orderIndex: db.modules.length + 1,
    };
    db.modules.push(created);
    saveDb();
    return res.status(201).json(created);
  });

  app.put('/api/modules/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const mod = db.modules.find((m) => m.id === req.params.id);
    if (!mod) return res.status(404).json({ error: 'Không tìm thấy Mô-đun.' });
    const body = req.body as Partial<IC3ModuleRecord>;
    const nextLevel =
      body.level !== undefined ? String(body.level).trim().toUpperCase() : mod.level;
    const nextTitle =
      body.title !== undefined ? String(body.title).trim() : mod.title;
    if (!nextLevel || !nextTitle) {
      return res.status(400).json({ error: 'Level và tên Mô-đun không được để trống.' });
    }
    if (
      nextLevel !== mod.level &&
      db.modules.some((m) => m.id !== mod.id && m.level.toUpperCase() === nextLevel)
    ) {
      return res.status(409).json({ error: `Level ${nextLevel} đã tồn tại ở mô-đun khác.` });
    }
    const levelChanged = nextLevel !== mod.level;
    mod.level = nextLevel;
    mod.title = nextTitle;
    if (body.description !== undefined) {
      mod.description = String(body.description).trim();
    }
    if (levelChanged) {
      for (const p of db.knowledgeParts) {
        if (p.module === mod.code) p.level = nextLevel;
      }
      for (const q of db.questions) {
        if (q.module === mod.code) q.level = nextLevel;
      }
    }
    saveDb();
    return res.json(mod);
  });

  app.delete('/api/modules/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const mod = db.modules.find((m) => m.id === req.params.id);
    if (!mod) return res.status(404).json({ error: 'Không tìm thấy Mô-đun.' });
    const hasCategories = db.knowledgeCategories.some((c) => c.module === mod.code);
    const hasParts = db.knowledgeParts.some((p) => p.module === mod.code);
    const hasQuestions = db.questions.some((q) => q.module === mod.code);
    if (hasCategories || hasParts || hasQuestions) {
      return res.status(400).json({
        error:
          'Mô-đun vẫn còn nhóm kiến thức, phần kiến thức hoặc câu hỏi. Vui lòng xóa dữ liệu bên trong trước.',
      });
    }
    db.modules = db.modules.filter((m) => m.id !== mod.id);
    saveDb();
    return res.json({ ok: true });
  });

  // --- Knowledge Categories (teacher_lv2 & master only) ---
  app.post('/api/knowledge-categories', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const body = req.body as Partial<KnowledgeCategoryRecord>;
    const modCode = String(body.module ?? '').trim();
    const cleanCode = String(body.code ?? '').trim().toUpperCase();
    const title = String(body.title ?? '').trim();
    if (!modCode || !cleanCode || !title) {
      return res.status(400).json({ error: 'Thiếu thông tin Mô-đun, mã hoặc tên nhóm kiến thức.' });
    }
    const exists = db.knowledgeCategories.some(
      (c) => c.module === modCode && c.code.toUpperCase() === cleanCode
    );
    if (exists) {
      return res.status(409).json({ error: `Nhóm ${cleanCode} đã tồn tại trong mô-đun này.` });
    }
    const siblings = db.knowledgeCategories.filter((c) => c.module === modCode);
    const created: KnowledgeCategoryRecord = {
      id: makeId('cat'),
      module: modCode,
      code: cleanCode,
      title,
      description: String(body.description ?? '').trim(),
      orderIndex: siblings.length + 1,
    };
    db.knowledgeCategories.push(created);
    saveDb();
    return res.status(201).json(created);
  });

  app.put('/api/knowledge-categories/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const cat = db.knowledgeCategories.find((c) => c.id === req.params.id);
    if (!cat) return res.status(404).json({ error: 'Không tìm thấy nhóm kiến thức.' });
    const body = req.body as Partial<KnowledgeCategoryRecord>;
    const nextTitle =
      body.title !== undefined ? String(body.title).trim() : cat.title;
    if (!nextTitle) {
      return res.status(400).json({ error: 'Tên nhóm kiến thức không được để trống.' });
    }
    cat.title = nextTitle;
    if (body.description !== undefined) {
      cat.description = String(body.description).trim();
    }
    saveDb();
    return res.json(cat);
  });

  app.delete('/api/knowledge-categories/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const cat = db.knowledgeCategories.find((c) => c.id === req.params.id);
    if (!cat) return res.status(404).json({ error: 'Không tìm thấy nhóm kiến thức.' });
    const catCode = cat.code.toUpperCase();
    const hasParts = db.knowledgeParts.some(
      (p) => p.module === cat.module && p.category.toUpperCase() === catCode
    );
    const hasQuestions = db.questions.some(
      (q) => q.module === cat.module && q.category.toUpperCase() === catCode
    );
    if (hasParts || hasQuestions) {
      return res.status(400).json({
        error: 'Nhóm này vẫn còn phần kiến thức hoặc câu hỏi. Vui lòng xóa bên trong trước.',
      });
    }
    db.knowledgeCategories = db.knowledgeCategories.filter((c) => c.id !== cat.id);
    saveDb();
    return res.json({ ok: true });
  });

  // --- Knowledge Parts (teacher_lv2 & master only) ---
  app.post('/api/knowledge-parts', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const body = req.body as Partial<KnowledgePart>;
    if (!body.module || !body.level || !body.category || !body.code || !body.title) {
      return res.status(400).json({ error: 'Thiếu thông tin phần kiến thức.' });
    }
    const cleanCode = body.code.trim().toUpperCase();
    const exists = db.knowledgeParts.some(
      (p) =>
        p.module === body.module &&
        p.category === body.category &&
        p.code.toUpperCase() === cleanCode
    );
    if (exists) {
      return res.status(409).json({ error: `Phần ${cleanCode} đã tồn tại trong nhóm này.` });
    }
    const siblings = db.knowledgeParts.filter(
      (p) => p.module === body.module && p.category === body.category
    );
    const created: KnowledgePart = {
      id: makeId('part'),
      module: body.module,
      level: body.level,
      category: body.category,
      code: cleanCode,
      title: body.title.trim(),
      description: (body.description || '').trim(),
      orderIndex: siblings.length + 1,
    };
    db.knowledgeParts.push(created);
    saveDb();
    return res.status(201).json(created);
  });

  app.put('/api/knowledge-parts/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const part = db.knowledgeParts.find((p) => p.id === req.params.id);
    if (!part) return res.status(404).json({ error: 'Không tìm thấy phần kiến thức.' });
    const body = req.body as Partial<KnowledgePart>;
    const nextTitle =
      body.title !== undefined ? String(body.title).trim() : part.title;
    if (!nextTitle) {
      return res.status(400).json({ error: 'Tên phần kiến thức không được để trống.' });
    }
    part.title = nextTitle;
    if (body.description !== undefined) {
      part.description = String(body.description).trim();
    }
    saveDb();
    return res.json(part);
  });

  app.delete('/api/knowledge-parts/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const part = db.knowledgeParts.find((p) => p.id === req.params.id);
    if (!part) return res.status(404).json({ error: 'Không tìm thấy phần kiến thức.' });
    const hasQuestions = db.questions.some(
      (q) =>
        q.module === part.module &&
        q.category === part.category &&
        q.contentCode.toUpperCase() === part.code.toUpperCase()
    );
    if (hasQuestions) {
      return res.status(400).json({
        error: 'Phần này vẫn còn câu hỏi. Vui lòng xóa hoặc chuyển câu hỏi trước khi xóa phần.',
      });
    }
    db.knowledgeParts = db.knowledgeParts.filter((p) => p.id !== part.id);
    saveDb();
    return res.json({ ok: true });
  });

  // --- Questions ---
  function ensureQuestionParents(
    moduleCode: string,
    level: string,
    categoryCode: string,
    contentCode: string,
    topic: string
  ) {
    const cleanCat = categoryCode.trim().toUpperCase();
    const cleanPart = contentCode.trim().toUpperCase();
    if (!db.modules.some((m) => m.code === moduleCode)) {
      db.modules.push({
        id: makeId('mod'),
        code: moduleCode,
        level: level.trim().toUpperCase() || moduleCode.toUpperCase(),
        title: `Mô-đun ${level || moduleCode}`,
        description: '',
        orderIndex: db.modules.length + 1,
      });
    }
    if (
      !db.knowledgeCategories.some(
        (c) => c.module === moduleCode && c.code.toUpperCase() === cleanCat
      )
    ) {
      const siblings = db.knowledgeCategories.filter((c) => c.module === moduleCode);
      db.knowledgeCategories.push({
        id: makeId('cat'),
        module: moduleCode,
        code: cleanCat,
        title: `Nhóm ${cleanCat}`,
        description: '',
        orderIndex: siblings.length + 1,
      });
    }
    if (
      !db.knowledgeParts.some(
        (p) =>
          p.module === moduleCode &&
          p.category.toUpperCase() === cleanCat &&
          p.code.toUpperCase() === cleanPart
      )
    ) {
      const siblings = db.knowledgeParts.filter(
        (p) => p.module === moduleCode && p.category.toUpperCase() === cleanCat
      );
      db.knowledgeParts.push({
        id: makeId('part'),
        module: moduleCode,
        level: level.trim().toUpperCase() || moduleCode.toUpperCase(),
        category: cleanCat,
        code: cleanPart,
        title: topic.trim() || `Chuyên đề ${cleanPart}`,
        description: '',
        orderIndex: siblings.length + 1,
      });
    }
  }

  app.post('/api/questions', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const q = req.body as Partial<Question>;
    if (!q.prompt || !q.type || !q.module || !q.level || !q.category || !q.payload) {
      return res.status(400).json({ error: 'Thiếu dữ liệu câu hỏi bắt buộc.' });
    }
    const cleanCategory = q.category.trim().toUpperCase();
    const contentCode = (q.contentCode || `${cleanCategory}1`).trim().toUpperCase();
    const matchedPart = db.knowledgeParts.find(
      (p) =>
        p.module === q.module &&
        p.category.trim().toUpperCase() === cleanCategory &&
        p.code.trim().toUpperCase() === contentCode
    );
    const topicText = (q.topic || matchedPart?.title || 'Tổng hợp').trim();
    ensureQuestionParents(q.module, q.level, cleanCategory, contentCode, topicText);
    const topicOrder =
      typeof q.topicOrder === 'number' && q.topicOrder >= 1
        ? Math.round(q.topicOrder)
        : getNextTopicOrder(db.questions, q.module, cleanCategory, contentCode);
    const now = new Date().toISOString();
    const created: Question = {
      id: q.id || makeId('q'),
      module: q.module,
      level: q.level,
      category: cleanCategory,
      contentCode,
      topicOrder,
      topic: topicText,
      type: q.type,
      prompt: q.prompt.trim(),
      instruction: q.instruction?.trim() || getDefaultInstructionForQuestionType(q.type),
      payload: q.payload,
      explanation: (q.explanation || '').trim(),
      tips: q.tips?.trim(),
      createdAt: now,
      updatedAt: now,
    };
    db.questions.push(created);
    saveDb();
    return res.status(201).json(created);
  });

  app.post('/api/questions/reorder', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const { updates } = req.body as {
      updates?: Array<{ id: string; topicOrder: number }>;
    };
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Danh sách sắp xếp không hợp lệ.' });
    }
    const map = new Map(updates.map((u) => [u.id, u.topicOrder]));
    for (const q of db.questions) {
      const nextOrder = map.get(q.id);
      if (typeof nextOrder === 'number') {
        q.topicOrder = nextOrder;
        q.updatedAt = new Date().toISOString();
      }
    }
    saveDb();
    return res.json({ ok: true });
  });

  app.put('/api/questions/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const idx = db.questions.findIndex((q) => q.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
    const existing = db.questions[idx];
    const nextCategory = String(req.body.category || existing.category).trim().toUpperCase();
    const nextContentCode = String(req.body.contentCode || existing.contentCode)
      .trim()
      .toUpperCase();
    const nextModule = String(req.body.module || existing.module);
    const nextLevel = String(req.body.level || existing.level);
    const nextType = (req.body.type || existing.type) as Question['type'];
    const matchedPart = db.knowledgeParts.find(
      (p) =>
        p.module === nextModule &&
        p.category.trim().toUpperCase() === nextCategory &&
        p.code.trim().toUpperCase() === nextContentCode
    );
    const nextTopic =
      String(req.body.topic || matchedPart?.title || existing.topic).trim() || 'Tổng hợp';
    ensureQuestionParents(nextModule, nextLevel, nextCategory, nextContentCode, nextTopic);
    const { difficulty: _dropExistingDiff, ...cleanExisting } = existing as Question & {
      difficulty?: unknown;
    };
    const { difficulty: _dropBodyDiff, ...cleanBody } = (req.body ?? {}) as Record<string, unknown>;
    const updated: Question = {
      ...cleanExisting,
      ...cleanBody,
      id: existing.id,
      module: nextModule,
      level: nextLevel,
      category: nextCategory,
      contentCode: nextContentCode,
      topic: nextTopic,
      type: nextType,
      instruction:
        typeof req.body.instruction === 'string' && req.body.instruction.trim()
          ? req.body.instruction.trim()
          : getDefaultInstructionForQuestionType(nextType),
      topicOrder:
        typeof req.body.topicOrder === 'number' && req.body.topicOrder >= 1
          ? Math.round(req.body.topicOrder)
          : existing.topicOrder,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    db.questions[idx] = updated;
    saveDb();
    return res.json(updated);
  });

  app.delete('/api/questions/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const qId = req.params.id;
    db.questions = db.questions.filter((q) => q.id !== qId);
    const now = new Date().toISOString();
    for (const set of db.questionSets) {
      if (set.questionIds.includes(qId)) {
        set.questionIds = set.questionIds.filter((id) => id !== qId);
        set.updatedAt = now;
      }
    }
    for (const cfg of db.classTaskConfigs) {
      for (const task of cfg.tasks) {
        task.questionIds = task.questionIds.filter((id) => id !== qId);
      }
    }
    saveDb();
    return res.json({ ok: true });
  });

  app.post('/api/questions/batch-delete', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'Danh sách câu hỏi cần xóa không hợp lệ.' });
    }
    const idSet = new Set(
      ids.map((id) => String(id).trim()).filter(Boolean)
    );
    if (idSet.size === 0) {
      return res.status(400).json({ error: 'Chưa chọn câu hỏi nào để xóa.' });
    }
    const beforeCount = db.questions.length;
    db.questions = db.questions.filter((q) => !idSet.has(q.id));
    const deletedCount = beforeCount - db.questions.length;
    const now = new Date().toISOString();
    for (const set of db.questionSets) {
      const nextIds = set.questionIds.filter((id) => !idSet.has(id));
      if (nextIds.length !== set.questionIds.length) {
        set.questionIds = nextIds;
        set.updatedAt = now;
      }
    }
    for (const cfg of db.classTaskConfigs) {
      for (const task of cfg.tasks) {
        task.questionIds = task.questionIds.filter((id) => !idSet.has(id));
      }
    }
    saveDb();
    return res.json({ ok: true, deletedCount });
  });

  // --- Question Sets (teacher_lv2 & master only) ---
  app.post('/api/question-sets', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const body = req.body as Partial<QuestionSet>;
    if (!body.title) {
      return res.status(400).json({ error: 'Thiếu tiêu đề bộ đề.' });
    }
    const now = new Date().toISOString();
    const created: QuestionSet = {
      id: body.id || makeId('set'),
      title: body.title.trim(),
      description: (body.description || '').trim(),
      level: body.level,
      category: body.category,
      contentCode: body.contentCode?.trim(),
      questionIds: Array.isArray(body.questionIds) ? body.questionIds : [],
      createdAt: now,
      updatedAt: now,
    };
    db.questionSets.unshift(created);
    saveDb();
    return res.status(201).json(created);
  });

  app.put('/api/question-sets/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const idx = db.questionSets.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy bộ đề.' });
    const existing = db.questionSets[idx];
    const updated: QuestionSet = {
      ...existing,
      ...req.body,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    db.questionSets[idx] = updated;
    saveDb();
    return res.json(updated);
  });

  app.delete('/api/question-sets/:id', requireRoles('teacher_lv2', 'master'), (req, res) => {
    db.questionSets = db.questionSets.filter((s) => s.id !== req.params.id);
    saveDb();
    return res.json({ ok: true });
  });

  app.post('/api/question-bank/import-remote', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const {
      modules,
      knowledgeCategories,
      knowledgeParts,
      questions,
      questionSets,
    } = req.body as {
      modules?: IC3ModuleRecord[];
      knowledgeCategories?: KnowledgeCategoryRecord[];
      knowledgeParts?: KnowledgePart[];
      questions?: Question[];
      questionSets?: QuestionSet[];
    };
    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'Danh sách câu hỏi không hợp lệ.' });
    }
    if (Array.isArray(modules) && modules.length > 0) {
      db.modules = modules;
    }
    if (Array.isArray(knowledgeCategories) && knowledgeCategories.length > 0) {
      db.knowledgeCategories = knowledgeCategories;
    }
    if (Array.isArray(knowledgeParts)) {
      db.knowledgeParts = knowledgeParts;
    }
    db.questions = questions;
    if (Array.isArray(questionSets)) {
      db.questionSets = questionSets;
    }
    saveDb();
    return res.json({
      ok: true,
      counts: {
        modules: db.modules.length,
        knowledgeCategories: db.knowledgeCategories.length,
        knowledgeParts: db.knowledgeParts.length,
        questions: db.questions.length,
        questionSets: db.questionSets.length,
      },
    });
  });

  // --- Class Task Configs (All teacher roles) ---
  app.put('/api/class-tasks/:classId', requireAuth, (req, res) => {
    const { classId } = req.params;
    const cls = db.classes.find((c) => c.id === classId);
    if (!cls) return res.status(404).json({ error: 'Không tìm thấy lớp học.' });

    const body = req.body as Partial<ClassTaskConfig>;
    const normalizedTasks = (body.tasks ?? []).map((t, index) => ({
      ...t,
      id: t.id || makeId('task'),
      classId,
      orderIndex: index + 1,
      requiredAttempts: Math.max(1, Number(t.requiredAttempts ?? 1)),
      minScore: Math.min(1000, Math.max(0, Number(t.minScore ?? 0))),
      estimatedMinutes: Math.max(1, Number(t.estimatedMinutes ?? 10)),
      questionIds: Array.isArray(t.questionIds) ? t.questionIds : [],
    }));

    const config: ClassTaskConfig = {
      classId,
      assignmentTitle: (body.assignmentTitle || `Bài tập lớp ${cls.name}`).trim(),
      teacherName: (body.teacherName || 'Giáo viên bộ môn').trim(),
      breakRewardMinutes: Math.max(0, Number(body.breakRewardMinutes ?? 10)),
      updatedAt: new Date().toISOString(),
      tasks: normalizedTasks,
    };

    const idx = db.classTaskConfigs.findIndex((c) => c.classId === classId);
    if (idx === -1) {
      db.classTaskConfigs.push(config);
    } else {
      db.classTaskConfigs[idx] = config;
    }
    saveDb();
    return res.json(config);
  });

  // --- Submissions (including demo/test recording & break state update) ---
  app.post('/api/submissions', requireAuth, (req, res) => {
    const { studentId, taskId, correctCount, totalCount, durationSeconds } = req.body ?? {};
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
    const cls = db.classes.find((c) => c.id === student.classId);
    if (!cls) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
    const taskCfg = db.classTaskConfigs.find((c) => c.classId === cls.id);
    const task = taskCfg?.tasks.find((t) => t.id === taskId);
    if (!taskCfg || !task) {
      return res.status(404).json({ error: 'Không tìm thấy nhiệm vụ lớp.' });
    }

    const total = Math.max(1, Number(totalCount ?? task.questionIds.length ?? 5));
    const correct = Math.min(total, Math.max(0, Number(correctCount ?? 0)));
    const score = calculateIC3Score(correct, total);
    const prevAttempts = db.submissions.filter(
      (s) => s.studentId === student.id && s.taskId === task.id
    ).length;

    const record = {
      id: makeId('sub'),
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      schoolId: cls.schoolId,
      classId: cls.id,
      taskId: task.id,
      taskTitle: task.title,
      score,
      correctCount: correct,
      totalCount: total,
      durationSeconds: Math.max(1, Number(durationSeconds ?? 90)),
      completedAt: new Date().toISOString(),
      attemptNumber: prevAttempts + 1,
      requiredAttempts: task.requiredAttempts,
      minScore: task.minScore,
      metMinScore: score >= task.minScore,
    };

    db.submissions.unshift(record);

    if (isStudentBreakUnlocked(taskCfg.tasks, db.submissions, student.id)) {
      const grantedSeconds = taskCfg.breakRewardMinutes * 60;
      const existingBreak = db.breakStates.find((b) => b.studentId === student.id);
      const now = new Date().toISOString();
      if (existingBreak) {
        existingBreak.status = 'active';
        existingBreak.totalGrantedSeconds = grantedSeconds;
        existingBreak.remainingSeconds = grantedSeconds;
        existingBreak.unlockedAt = now;
        existingBreak.updatedAt = now;
      } else {
        db.breakStates.push({
          studentId: student.id,
          status: 'active',
          totalGrantedSeconds: grantedSeconds,
          remainingSeconds: grantedSeconds,
          unlockedAt: now,
          updatedAt: now,
        });
      }
    }

    saveDb();
    return res.status(201).json(record);
  });

  // --- Battle Configs & Control Room (teacher_lv2 & master only) ---
  app.put('/api/battle-configs/:classId', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const { classId } = req.params;
    const cls = db.classes.find((c) => c.id === classId);
    if (!cls) return res.status(404).json({ error: 'Không tìm thấy lớp học.' });

    const body = req.body as Partial<ClassBattleConfig>;
    const selectedSet = body.questionSetId
      ? db.questionSets.find((qs) => qs.id === body.questionSetId)
      : undefined;

    const config: ClassBattleConfig = {
      classId,
      isEnabled: Boolean(body.isEnabled),
      title: (body.title || `Đấu trường IC3 — Lớp ${cls.name}`).trim(),
      questionSetId: selectedSet?.id ?? body.questionSetId ?? null,
      questionSetName:
        selectedSet?.title || body.questionSetName || 'Bộ đề tổng hợp',
      teacherName: (body.teacherName || 'Giáo viên điều phối').trim(),
      moduleFilter: body.moduleFilter || 'all',
      questionIds:
        selectedSet?.questionIds ??
        (Array.isArray(body.questionIds) ? body.questionIds : []),
      fastComboWindowSeconds: Math.max(
        5,
        Number(body.fastComboWindowSeconds ?? 15)
      ),
      topRewardCount: Math.max(1, Number(body.topRewardCount ?? 3)),
      breakRewardMinutes: Math.max(0, Number(body.breakRewardMinutes ?? 10)),
      timeLimitSeconds: Math.max(30, Number(body.timeLimitSeconds ?? 300)),
      updatedAt: new Date().toISOString(),
    };

    const idx = db.battleConfigs.findIndex((c) => c.classId === classId);
    if (idx === -1) {
      db.battleConfigs.push(config);
    } else {
      db.battleConfigs[idx] = config;
    }

    // Also update any active lobby room snapshot for this class
    const lobby = db.battleRooms.find(
      (r) => r.classId === classId && r.status === 'lobby'
    );
    if (lobby) {
      lobby.configSnapshot = config;
      lobby.questionIds = config.questionIds;
    }

    saveDb();
    return res.json(config);
  });

  app.post('/api/battle-rooms', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const { classId } = req.body ?? {};
    const cfg = db.battleConfigs.find((c) => c.classId === classId);
    if (!cfg) {
      return res
        .status(400)
        .json({ error: 'Vui lòng lưu cấu hình Thi đấu cho lớp trước khi mở phòng.' });
    }
    const now = new Date().toISOString();
    const classStudents = db.students
      .filter((s) => s.classId === classId)
      .slice(0, 6);

    const roomId = makeId('room');
    const room: BattleRoomState = {
      id: roomId,
      classId,
      status: 'lobby',
      questionIds: cfg.questionIds,
      configSnapshot: cfg,
      participants: classStudents.slice(0, 3).map((st) => ({
        roomId,
        studentId: st.id,
        studentName: st.fullName,
        studentCode: st.studentCode,
        connected: true,
        answeredCount: 0,
        correctCount: 0,
        score: 0,
        durationSeconds: 0,
        finished: false,
        shieldCharges: 0,
        pendingCardChoices: 0,
        attacksUsed: 0,
        defensesUsed: 0,
        attacksBlocked: 0,
        activeDebuffs: [],
        currentPairCount: 0,
        currentPairElapsedSeconds: 0,
        joinedAt: now,
      })),
      events: classStudents.slice(0, 3).map((st) => ({
        id: makeId('ev'),
        roomId,
        type: 'join' as const,
        message: `${st.fullName} (${st.studentCode}) đã vào phòng chờ.`,
        actorStudentId: st.id,
        actorStudentName: st.fullName,
        createdAt: now,
      })),
      createdAt: now,
    };

    db.battleRooms.unshift(room);
    saveDb();
    return res.status(201).json(room);
  });

  app.post('/api/battle-rooms/:roomId/join', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const room = db.battleRooms.find((r) => r.id === req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    const { studentId } = req.body ?? {};
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
    if (room.participants.some((p) => p.studentId === student.id)) {
      return res.json(room);
    }
    const now = new Date().toISOString();
    room.participants.push({
      roomId: room.id,
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      connected: true,
      answeredCount: 0,
      correctCount: 0,
      score: 0,
      durationSeconds: 0,
      finished: false,
      shieldCharges: 0,
      pendingCardChoices: 0,
      attacksUsed: 0,
      defensesUsed: 0,
      attacksBlocked: 0,
      activeDebuffs: [],
      currentPairCount: 0,
      currentPairElapsedSeconds: 0,
      joinedAt: now,
    });
    room.events.unshift({
      id: makeId('ev'),
      roomId: room.id,
      type: 'join',
      message: `${student.fullName} (${student.studentCode}) vừa tham gia phòng chờ.`,
      actorStudentId: student.id,
      actorStudentName: student.fullName,
      createdAt: now,
    });
    saveDb();
    return res.json(room);
  });

  app.post('/api/battle-rooms/:roomId/start', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const room = db.battleRooms.find((r) => r.id === req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    if (room.participants.length === 0) {
      return res.status(400).json({ error: 'Cần ít nhất 1 học sinh trong phòng chờ để bắt đầu.' });
    }
    const now = new Date();
    const endsAt = new Date(
      now.getTime() + room.configSnapshot.timeLimitSeconds * 1000
    );
    room.status = 'playing';
    room.startedAt = now.toISOString();
    room.endsAt = endsAt.toISOString();
    room.events.unshift({
      id: makeId('ev'),
      roomId: room.id,
      type: 'start',
      message: `Giáo viên đã phát lệnh BẮT ĐẦU trận đấu (${room.questionIds.length} câu hỏi, ${room.configSnapshot.timeLimitSeconds}s).`,
      createdAt: now.toISOString(),
    });
    saveDb();
    return res.json(room);
  });

  app.post('/api/battle-rooms/:roomId/simulate-step', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const room = db.battleRooms.find((r) => r.id === req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    if (room.status !== 'playing') {
      return res.status(400).json({ error: 'Phòng đấu chưa ở trạng thái đang diễn ra.' });
    }

    const totalQuestions = Math.max(1, room.questionIds.length);
    const now = new Date();
    const debuffs: BattleDebuffType[] = ['blur', 'frost', 'reverse', 'shake'];

    for (const p of room.participants) {
      // Clear expired debuffs
      p.activeDebuffs = p.activeDebuffs.filter(
        (d) => new Date(d.expiresAt).getTime() > now.getTime()
      );
      if (p.finished) continue;

      const stepQuestions = Math.min(totalQuestions - p.answeredCount, 2);
      if (stepQuestions <= 0) {
        p.finished = true;
        p.finishedAt = now.toISOString();
        continue;
      }

      const elapsedDelta = Math.floor(Math.random() * 9) + 6; // 6..14s
      let gainedCorrect = 0;
      for (let i = 0; i < stepQuestions; i++) {
        if (Math.random() > 0.22) gainedCorrect++;
      }

      p.answeredCount += stepQuestions;
      p.correctCount += gainedCorrect;
      p.durationSeconds += elapsedDelta;
      p.score = calculateIC3Score(p.correctCount, totalQuestions);

      if (p.answeredCount >= totalQuestions) {
        p.finished = true;
        p.finishedAt = now.toISOString();
      }

      // Check fast 2-correct combo
      if (
        gainedCorrect === 2 &&
        elapsedDelta <= room.configSnapshot.fastComboWindowSeconds
      ) {
        const useDefense = p.shieldCharges === 0 && Math.random() < 0.45;
        if (useDefense || room.participants.length < 2) {
          p.shieldCharges += 2;
          p.defensesUsed += 1;
          room.events.unshift({
            id: makeId('ev'),
            roomId: room.id,
            type: 'defense',
            message: `${p.studentName} đạt Combo nhanh (${elapsedDelta}s) và kích hoạt Thẻ Phòng Thủ (+2 Khiên).`,
            actorStudentId: p.studentId,
            actorStudentName: p.studentName,
            createdAt: now.toISOString(),
          });
        } else {
          const opponents = room.participants.filter(
            (o) => o.studentId !== p.studentId && !o.finished
          );
          const target = opponents[Math.floor(Math.random() * opponents.length)];
          if (target) {
            const debuffType = debuffs[Math.floor(Math.random() * debuffs.length)];
            p.attacksUsed += 1;
            if (target.shieldCharges > 0) {
              target.shieldCharges -= 1;
              target.attacksBlocked += 1;
              room.events.unshift({
                id: makeId('ev'),
                roomId: room.id,
                type: 'blocked',
                message: `${p.studentName} tung thẻ [${debuffType}] vào ${target.studentName} nhưng bị Khiên chặn lại!`,
                actorStudentId: p.studentId,
                actorStudentName: p.studentName,
                targetStudentId: target.studentId,
                targetStudentName: target.studentName,
                debuffType,
                createdAt: now.toISOString(),
              });
            } else {
              target.activeDebuffs.push({
                id: makeId('debuff'),
                type: debuffType,
                fromStudentName: p.studentName,
                expiresAt: new Date(now.getTime() + 6000).toISOString(),
              });
              room.events.unshift({
                id: makeId('ev'),
                roomId: room.id,
                type: 'attack',
                message: `${p.studentName} tung thẻ [${debuffType}] gây nhiễu ${target.studentName} trong 6s!`,
                actorStudentId: p.studentId,
                actorStudentName: p.studentName,
                targetStudentId: target.studentId,
                targetStudentName: target.studentName,
                debuffType,
                createdAt: now.toISOString(),
              });
            }
          }
        }
      }
    }

    // Auto finish if everyone finished
    if (
      room.participants.length > 0 &&
      room.participants.every((p) => p.finished)
    ) {
      room.status = 'finished';
      room.finishedAt = now.toISOString();
      room.rankedResults = rankBattleParticipants(
        room.participants,
        totalQuestions,
        room.configSnapshot.topRewardCount,
        room.configSnapshot.breakRewardMinutes
      );
      room.events.unshift({
        id: makeId('ev'),
        roomId: room.id,
        type: 'finish',
        message: `Tất cả học sinh đã hoàn thành! Hạng 1: ${room.rankedResults[0]?.studentName} (${room.rankedResults[0]?.score} điểm).`,
        createdAt: now.toISOString(),
      });
    }

    room.events = room.events.slice(0, 40);
    saveDb();
    return res.json(room);
  });

  app.post('/api/battle-rooms/:roomId/finish', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const room = db.battleRooms.find((r) => r.id === req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    const now = new Date().toISOString();
    const totalQuestions = Math.max(1, room.questionIds.length);
    for (const p of room.participants) {
      p.finished = true;
      p.finishedAt = p.finishedAt || now;
      p.activeDebuffs = [];
    }
    room.status = 'finished';
    room.finishedAt = now;
    room.rankedResults = rankBattleParticipants(
      room.participants,
      totalQuestions,
      room.configSnapshot.topRewardCount,
      room.configSnapshot.breakRewardMinutes
    );

    // Grant break reward to Top X
    for (const r of room.rankedResults) {
      if (r.rewardedBreakMinutes > 0) {
        const extraSec = r.rewardedBreakMinutes * 60;
        const existing = db.breakStates.find((b) => b.studentId === r.studentId);
        if (existing) {
          existing.status = 'active';
          existing.totalGrantedSeconds += extraSec;
          existing.remainingSeconds += extraSec;
          existing.unlockedAt = existing.unlockedAt || now;
          existing.updatedAt = now;
        } else {
          db.breakStates.push({
            studentId: r.studentId,
            status: 'active',
            totalGrantedSeconds: extraSec,
            remainingSeconds: extraSec,
            unlockedAt: now,
            updatedAt: now,
          });
        }
      }
    }

    room.events.unshift({
      id: makeId('ev'),
      roomId: room.id,
      type: 'finish',
      message: `Giáo viên đã kết thúc trận đấu. Trao thưởng Top ${room.configSnapshot.topRewardCount} (+${room.configSnapshot.breakRewardMinutes} phút giải lao).`,
      createdAt: now,
    });
    saveDb();
    return res.json(room);
  });

  app.post('/api/battle-rooms/:roomId/reset', requireRoles('teacher_lv2', 'master'), (req, res) => {
    const room = db.battleRooms.find((r) => r.id === req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    const now = new Date().toISOString();
    room.status = 'lobby';
    room.startedAt = undefined;
    room.endsAt = undefined;
    room.finishedAt = undefined;
    room.rankedResults = undefined;
    for (const p of room.participants) {
      p.answeredCount = 0;
      p.correctCount = 0;
      p.score = 0;
      p.durationSeconds = 0;
      p.finished = false;
      p.finishedAt = undefined;
      p.shieldCharges = 0;
      p.pendingCardChoices = 0;
      p.attacksUsed = 0;
      p.defensesUsed = 0;
      p.attacksBlocked = 0;
      p.activeDebuffs = [];
    }
    room.events = [
      {
        id: makeId('ev'),
        roomId: room.id,
        type: 'join',
        message: 'Phòng thi đấu đã được giáo viên đặt lại về trạng thái Phòng chờ.',
        createdAt: now,
      },
    ];
    saveDb();
    return res.json(room);
  });

  // --- Vite / Static ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IC3 Master Admin server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
