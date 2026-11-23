import express from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
} from '../src/types/ic3.js';
import {
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
} from '../src/utils/ic3Rules.js';
import {
  createHashedSeedDatabase,
  getLocalDb,
  sanitizeTeachers,
  saveLocalDb,
} from './localStore.js';
import {
  hashTeacherPassword,
  makeId,
  revokedTokens,
  signSessionToken,
  verifySessionPayload,
  verifySessionToken,
  verifyTeacherPassword,
} from './security.js';
import {
  SupabaseStoreError,
  type SupabaseSyncStatus,
  batchDeleteQuestionsOnSupabaseServer,
  batchCreateStudentsOnSupabase,
  createBattleRoomOnSupabase,
  createCategoryOnSupabase,
  createClassOnSupabase,
  createModuleOnSupabase,
  createPartOnSupabase,
  createQuestionOnSupabase,
  createQuestionSetOnSupabase,
  createSchoolOnSupabase,
  createStudentOnSupabase,
  createSubmissionOnSupabase,
  deleteCategoryOnSupabase,
  deleteClassOnSupabase,
  deleteModuleOnSupabase,
  deletePartOnSupabase,
  deleteQuestionOnSupabaseServer,
  deleteQuestionSetOnSupabaseServer,
  deleteSchoolOnSupabase,
  deleteStudentOnSupabase,
  deleteTeacherOnSupabaseServer,
  fetchAdminDatabaseFromSupabase,
  fetchSupabaseSampleQuestionsOnServer,
  findAdminTeacherInSupabaseByEmail,
  finishBattleRoomOnSupabase,
  getTeacherFromSupabaseById,
  importQuestionBankToSupabase,
  joinBattleRoomOnSupabase,
  listTeachersFromSupabase,
  reorderQuestionsOnSupabaseServer,
  resetBattleRoomOnSupabase,
  resetClassPasswordsOnSupabase,
  resetStudentPasswordOnSupabase,
  saveBattleConfigOnSupabase,
  saveClassTaskConfigOnSupabase,
  seedDatabaseToSupabase,
  simulateBattleStepOnSupabase,
  startBattleRoomOnSupabase,
  syncTeachersToSupabaseServer,
  testSupabaseConnectionOnServer,
  updateCategoryOnSupabase,
  updateClassOnSupabase,
  updateModuleOnSupabase,
  updatePartOnSupabase,
  updateQuestionOnSupabase,
  updateQuestionSetOnSupabase,
  updateSchoolOnSupabase,
  updateStudentOnSupabase,
  uploadHotspotImageOnSupabaseServer,
  upsertSingleTeacherOnSupabaseServer,
} from './supabaseStore.js';

interface AuthedRequest extends express.Request {
  authTeacher?: Omit<AdminTeacher, 'password'>;
  authToken?: string;
}

function readHeaderValue(
  req: express.Request,
  name: string
): string {
  const raw = req.headers[name];
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim();
  return '';
}

function resolveSupabaseFromRequest(req?: express.Request): {
  client: SupabaseClient | null;
  invalidReason?: string;
  envConfigured: boolean;
} {
  const envUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim();
  const envKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const envConfigured = Boolean(envUrl && envKey);

  const body = (req?.body ?? {}) as Record<string, unknown>;
  const bodyUrl = typeof body.supabaseUrl === 'string' ? body.supabaseUrl.trim() : '';
  const bodyKey =
    typeof body.supabaseAnonKey === 'string' ? body.supabaseAnonKey.trim() : '';
  const headerUrl = req ? readHeaderValue(req, 'x-supabase-url') : '';
  const headerKey = req ? readHeaderValue(req, 'x-supabase-anon-key') : '';

  const url = bodyUrl || headerUrl || envUrl;
  const anonKey = bodyKey || headerKey || envKey;

  if (!url || !anonKey) {
    return { client: null, envConfigured };
  }
  if (!isSafeRemoteSupabaseUrl(url)) {
    return {
      client: null,
      envConfigured,
      invalidReason:
        'Supabase Project URL không hợp lệ hoặc không thuộc máy chủ công khai được phép kết nối.',
    };
  }
  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { client, envConfigured };
  } catch {
    return {
      client: null,
      envConfigured,
      invalidReason: 'Không thể khởi tạo kết nối tới Supabase.',
    };
  }
}

function isMissingSchemaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    msg.includes('42p01') ||
    msg.includes('pgrst205')
  );
}

function asyncHandler(
  fn: (
    req: AuthedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => Promise<unknown>
) {
  return (
    req: AuthedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err instanceof SupabaseStoreError) {
        return res.status(err.status).json({ error: err.message });
      }
      const message =
        err instanceof Error ? err.message : 'Lỗi máy chủ không xác định.';
      return res.status(500).json({ error: message });
    });
  };
}

function upsertRemoteTeacherIntoLocalDb(
  remoteRow: Record<string, unknown>,
  verifiedPlainPassword?: string
): AdminTeacher | null {
  const db = getLocalDb();
  const email = String(remoteRow.email ?? '').trim().toLowerCase();
  const userId = String(remoteRow.user_id ?? remoteRow.id ?? email).trim();
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
    userId: userId || existing?.userId || email,
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
  saveLocalDb();
  return nextTeacher;
}

async function resolveAuthenticatedTeacher(
  req: AuthedRequest,
  userId: string,
  emailHint?: string
): Promise<AdminTeacher | null> {
  const findLocal = () => {
    const teachers = getLocalDb().teachers;
    return (
      teachers.find((t) => t.userId === userId) ??
      (emailHint
        ? teachers.find(
            (t) =>
              t.email.trim().toLowerCase() === emailHint.trim().toLowerCase()
          )
        : undefined) ??
      null
    );
  };

  const { client: sbClient } = resolveSupabaseFromRequest(req);
  if (sbClient) {
    try {
      const { teacher, tableHasRows } = await getTeacherFromSupabaseById(
        sbClient,
        userId,
        emailHint
      );
      if (teacher) return teacher;
      if (tableHasRows) return null;
      // If admin_teachers table is still empty (0 rows), fall back to seed teachers
      return findLocal();
    } catch {
      return findLocal();
    }
  }
  return findLocal();
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
  const session = verifySessionPayload(token);
  if (!session) {
    return res.status(401).json({
      error:
        'Phiên đăng nhập hết hạn hoặc chưa xác thực. Vui lòng đăng nhập lại.',
    });
  }

  void resolveAuthenticatedTeacher(req, session.userId, session.email)
    .then((found) => {
      if (!found) {
        return res.status(401).json({
          error: 'Tài khoản giáo viên không còn tồn tại trong hệ thống.',
        });
      }
      if (normalizeTeacherStatus(found.status) === 'locked') {
        return res.status(401).json({
          error: 'Tài khoản giáo viên đã bị tạm khóa.',
        });
      }
      const { password: _pw, ...safeTeacher } = found;
      req.authTeacher = {
        ...safeTeacher,
        role: normalizeAdminRole(safeTeacher.role),
        status: normalizeTeacherStatus(safeTeacher.status),
      };
      req.authToken = token;
      return next();
    })
    .catch((err) => next(err));
}

function requireRoles(...allowedRoles: AdminRole[]) {
  return (
    req: AuthedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
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

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Support rewritten serverless paths (?__path=...) and stripped /api prefixes
  app.use((req, _res, next) => {
    if (req.url) {
      try {
        const parsed = new URL(req.url, 'http://localhost');
        const pathParam = parsed.searchParams.get('__path');
        if (pathParam !== null) {
          parsed.searchParams.delete('__path');
          const cleanSub = pathParam.replace(/^\/+/, '');
          const qs = parsed.searchParams.toString();
          req.url = `/api/${cleanSub}${qs ? `?${qs}` : ''}`;
        } else if (
          !req.url.startsWith('/api') &&
          (req.url.startsWith('/health') || req.url.startsWith('/auth/'))
        ) {
          req.url = `/api${req.url}`;
        }
      } catch {
        // Ignore malformed URLs and pass through
      }
    }
    next();
  });

  // --- Health ---
  app.get('/api/health', (req, res) => {
    const { client, envConfigured } = resolveSupabaseFromRequest(req);
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      persistence: client ? 'supabase' : 'local',
      supabaseConfigured: Boolean(client),
      envConfigured,
    });
  });

  // --- Auth & Teachers ---
  app.post(
    '/api/auth/login',
    asyncHandler(async (req, res) => {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu.' });
      }
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !password) {
        return res
          .status(400)
          .json({ error: 'Vui lòng nhập đầy đủ email và mật khẩu.' });
      }

      const { client: sbClient } = resolveSupabaseFromRequest(req);
      const localDb = getLocalDb();
      let supabaseTableHasRows = false;

      if (sbClient) {
        try {
          let remoteRow: Record<string, unknown> | null = null;
          try {
            const foundRemote = await findAdminTeacherInSupabaseByEmail(
              sbClient,
              cleanEmail
            );
            remoteRow = foundRemote.row;
            supabaseTableHasRows = foundRemote.tableHasRows;
          } catch {
            // Table may not exist yet; allow auth/local fallback below
          }

          if (remoteRow) {
            const remoteHash =
              typeof remoteRow.password_hash === 'string'
                ? remoteRow.password_hash.trim()
                : '';
            let verified = remoteHash
              ? verifyTeacherPassword(password, remoteHash)
              : false;

            if (!verified) {
              try {
                const { data: authData, error: authErr } =
                  await sbClient.auth.signInWithPassword({
                    email: cleanEmail,
                    password,
                  });
                if (!authErr && authData.user) {
                  verified = true;
                }
              } catch {
                // Ignore Supabase Auth errors here
              }
            }

            if (!verified && !remoteHash) {
              const localMatch = localDb.teachers.find(
                (t) => t.email.trim().toLowerCase() === cleanEmail
              );
              if (
                localMatch &&
                verifyTeacherPassword(password, localMatch.password)
              ) {
                verified = true;
              }
            }

            if (!verified) {
              return res.status(401).json({
                error: 'Email hoặc mật khẩu giáo viên không chính xác.',
              });
            }

            const synced = upsertRemoteTeacherIntoLocalDb(remoteRow, password);
            if (!synced) {
              return res.status(500).json({
                error: 'Dữ liệu tài khoản giáo viên trên Supabase không hợp lệ.',
              });
            }

            const teacherStatus = normalizeTeacherStatus(synced.status);
            if (teacherStatus === 'locked') {
              return res.status(403).json({
                error:
                  'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ Giáo viên Master.',
              });
            }

            const token = signSessionToken(synced.userId, synced.email);
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

          // Try Supabase Auth directly if not matched in admin_teachers by email
          const { data: authData, error: authErr } =
            await sbClient.auth.signInWithPassword({
              email: cleanEmail,
              password,
            });
          if (!authErr && authData.user) {
            const byUidLookup = await getTeacherFromSupabaseById(
              sbClient,
              authData.user.id,
              cleanEmail
            ).catch(() => ({ teacher: null, tableHasRows: supabaseTableHasRows }));

            const existingRemote = byUidLookup.teacher;
            const localFallback = localDb.teachers.find(
              (t) => t.email.trim().toLowerCase() === cleanEmail
            );
            const mergedRow: Record<string, unknown> = existingRemote
              ? {
                  user_id: existingRemote.userId,
                  full_name: existingRemote.fullName,
                  email: existingRemote.email,
                  password_hash: existingRemote.password,
                  role: existingRemote.role,
                  status: existingRemote.status,
                  created_at: existingRemote.createdAt,
                }
              : {
                  user_id: authData.user.id,
                  full_name:
                    (authData.user.user_metadata?.full_name as
                      | string
                      | undefined) ||
                    localFallback?.fullName ||
                    cleanEmail,
                  email: authData.user.email || cleanEmail,
                  password_hash: hashTeacherPassword(password),
                  role: localFallback?.role || 'teacher_lv1',
                  status: localFallback?.status || 'active',
                  created_at:
                    localFallback?.createdAt || new Date().toISOString(),
                };

            const synced = upsertRemoteTeacherIntoLocalDb(mergedRow, password);
            if (synced) {
              if (!existingRemote) {
                // Best-effort persist into admin_teachers so follow-up /api/bootstrap succeeds across serverless instances
                await upsertSingleTeacherOnSupabaseServer(sbClient, synced).catch(
                  () => null
                );
              }
              const teacherStatus = normalizeTeacherStatus(synced.status);
              if (teacherStatus === 'locked') {
                return res.status(403).json({
                  error:
                    'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ Giáo viên Master.',
                });
              }
              const token = signSessionToken(synced.userId, synced.email);
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

          if (supabaseTableHasRows) {
            return res.status(401).json({
              error: 'Email hoặc mật khẩu giáo viên không chính xác.',
            });
          }
        } catch {
          // Allow fallback to local seed when Supabase table isn't created yet or unreachable
        }
      }

      const found = localDb.teachers.find(
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
          error:
            'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ Giáo viên Master.',
        });
      }
      const token = signSessionToken(found.userId, found.email);
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
    })
  );

  app.post('/api/auth/logout', (req: AuthedRequest, res) => {
    const authHeader = req.headers.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
    if (token) revokedTokens.add(token);
    return res.json({ ok: true });
  });

  app.get(
    '/api/bootstrap',
    requireAuth,
    asyncHandler(async (req, res) => {
      const isMaster = req.authTeacher?.role === 'master';
      const { client: sbClient } = resolveSupabaseFromRequest(req);
      const localDb = getLocalDb();

      if (sbClient) {
        try {
          const remoteDb = await fetchAdminDatabaseFromSupabase(sbClient, {
            includeTeachers: isMaster,
            seedFallbackTeachers: localDb.teachers,
          });
          return res.json({
            ...remoteDb,
            teachers: isMaster ? sanitizeTeachers(remoteDb.teachers) : [],
          });
        } catch (err) {
          if (isMissingSchemaError(err)) {
            return res.json({
              ...localDb,
              teachers: isMaster ? sanitizeTeachers(localDb.teachers) : [],
            });
          }
          throw err;
        }
      }

      return res.json({
        ...localDb,
        teachers: isMaster ? sanitizeTeachers(localDb.teachers) : [],
      });
    })
  );

  // --- Supabase Diagnostics, Seed & Storage ---
  app.post(
    '/api/supabase/test',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { client, invalidReason } = resolveSupabaseFromRequest(req);
      if (!client) {
        return res.status(400).json({
          error:
            invalidReason ||
            'Chưa cấu hình Supabase URL và Anon Key (trên trình duyệt hoặc biến môi trường máy chủ).',
        });
      }
      const report = await testSupabaseConnectionOnServer(client, getLocalDb());
      return res.json(report);
    })
  );

  app.post(
    '/api/supabase/sample',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { client, invalidReason } = resolveSupabaseFromRequest(req);
      if (!client) {
        return res.status(400).json({
          error:
            invalidReason ||
            'Chưa cấu hình Supabase URL và Anon Key (trên trình duyệt hoặc biến môi trường máy chủ).',
        });
      }
      const sample = await fetchSupabaseSampleQuestionsOnServer(client);
      return res.json(sample);
    })
  );

  app.post(
    '/api/supabase/seed',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { client, invalidReason } = resolveSupabaseFromRequest(req);
      if (!client) {
        return res.status(400).json({
          error:
            invalidReason ||
            'Chưa cấu hình Supabase URL và Anon Key hợp lệ để đồng bộ dữ liệu.',
        });
      }
      const useSample = Boolean(req.body?.useSeedSample);
      const sourceDb: AdminDatabase = useSample
        ? createHashedSeedDatabase()
        : getLocalDb();
      const result = await seedDatabaseToSupabase(client, sourceDb);
      const report = await testSupabaseConnectionOnServer(client, sourceDb);
      return res.json({ ...result, report });
    })
  );

  app.post(
    '/api/storage/hotspot-upload',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client, invalidReason } = resolveSupabaseFromRequest(req);
      if (!client) {
        return res.status(400).json({
          error:
            invalidReason ||
            'Chưa cấu hình Supabase để tải ảnh Hotspot lên Storage.',
        });
      }
      const { base64DataUrl, fileName, mimeType } = (req.body ?? {}) as {
        base64DataUrl?: string;
        fileName?: string;
        mimeType?: string;
      };
      if (!base64DataUrl) {
        return res.status(400).json({ error: 'Thiếu dữ liệu ảnh tải lên.' });
      }
      const uploaded = await uploadHotspotImageOnSupabaseServer(client, {
        base64DataUrl,
        fileName,
        mimeType,
      });
      return res.json(uploaded);
    })
  );

  // --- Teachers (Master only) ---
  app.post(
    '/api/teachers/sync-supabase',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { client, invalidReason } = resolveSupabaseFromRequest(req);
      if (!client) {
        return res.status(400).json({
          error:
            invalidReason ||
            'Chưa cấu hình Supabase URL và Anon Key hợp lệ để đồng bộ giáo viên.',
        });
      }
      const db = getLocalDb();
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
    })
  );

  app.post(
    '/api/teachers/pull-supabase',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { client, invalidReason } = resolveSupabaseFromRequest(req);
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
      const db = getLocalDb();
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
      saveLocalDb();

      return res.json({
        ok: true,
        addedCount,
        updatedCount,
        total: db.teachers.length,
        teachers: sanitizeTeachers(db.teachers),
        message: `Đã lấy danh sách giáo viên từ Supabase (thêm mới ${addedCount}, cập nhật ${updatedCount}).`,
      });
    })
  );

  app.post(
    '/api/teachers',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { fullName, email, password, role, status } = req.body ?? {};
      if (!fullName || !email || !password) {
        return res
          .status(400)
          .json({ error: 'Thiếu họ tên, email hoặc mật khẩu.' });
      }
      const cleanEmail = String(email).trim().toLowerCase();
      const nextRole = normalizeAdminRole(
        typeof role === 'string' ? role : 'teacher_lv1'
      );
      const nextStatus: TeacherAccountStatus = normalizeTeacherStatus(
        typeof status === 'string' ? status : 'active'
      );
      const { client: sbClient, invalidReason } = resolveSupabaseFromRequest(req);

      if (sbClient) {
        const remoteTeachers = await listTeachersFromSupabase(sbClient);
        if (
          remoteTeachers.some((t) => t.email.toLowerCase() === cleanEmail)
        ) {
          return res.status(409).json({ error: 'Email giáo viên đã tồn tại.' });
        }
        const teacher: AdminTeacher = {
          userId: makeId('teacher'),
          fullName: String(fullName).trim(),
          email: cleanEmail,
          password: hashTeacherPassword(String(password)),
          role: nextRole,
          status: nextStatus,
          createdAt: new Date().toISOString(),
        };
        const supabaseSync = await upsertSingleTeacherOnSupabaseServer(
          sbClient,
          teacher
        );
        if (!supabaseSync.ok) {
          return res.status(502).json({
            error:
              supabaseSync.error || 'Không thể lưu tài khoản giáo viên lên Supabase.',
          });
        }
        const localDb = getLocalDb();
        if (!localDb.teachers.some((t) => t.userId === teacher.userId)) {
          localDb.teachers.push(teacher);
          saveLocalDb();
        }
        const { password: _pw, ...safe } = teacher;
        return res.status(201).json({ ...safe, supabaseSync });
      }

      const db = getLocalDb();
      if (db.teachers.some((t) => t.email.toLowerCase() === cleanEmail)) {
        return res.status(409).json({ error: 'Email giáo viên đã tồn tại.' });
      }
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
      saveLocalDb();
      const supabaseSync: SupabaseSyncStatus = invalidReason
        ? { configured: true, ok: false, error: invalidReason }
        : { configured: false, ok: true };
      const { password: _pw, ...safe } = teacher;
      return res.status(201).json({ ...safe, supabaseSync });
    })
  );

  app.put(
    '/api/teachers/:userId',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { userId } = req.params;
      const { fullName, email, password, role, status } = req.body ?? {};
      const { client: sbClient, invalidReason } = resolveSupabaseFromRequest(req);

      if (sbClient) {
        const remoteTeachers = await listTeachersFromSupabase(sbClient);
        const teacher = remoteTeachers.find((t) => t.userId === userId);
        if (!teacher) {
          return res.status(404).json({ error: 'Không tìm thấy giáo viên.' });
        }
        const nextRole =
          typeof role === 'string' ? normalizeAdminRole(role) : teacher.role;
        const nextStatus: TeacherAccountStatus =
          typeof status === 'string'
            ? normalizeTeacherStatus(status)
            : normalizeTeacherStatus(teacher.status);

        const masterCheck = canDeleteOrDemoteMaster(
          remoteTeachers,
          userId,
          nextRole,
          nextStatus
        );
        if (!masterCheck.ok) {
          return res.status(400).json({ error: masterCheck.error });
        }
        if (req.authTeacher?.userId === userId && nextRole !== 'master') {
          return res.status(400).json({
            error: 'Không thể tự hạ quyền Master của tài khoản đang đăng nhập.',
          });
        }
        if (req.authTeacher?.userId === userId && nextStatus === 'locked') {
          return res.status(400).json({
            error: 'Không thể tự tạm khóa tài khoản đang đăng nhập.',
          });
        }

        const previousEmail = teacher.email;
        if (typeof email === 'string' && email.trim()) {
          const cleanEmail = email.trim().toLowerCase();
          if (
            cleanEmail !== teacher.email.toLowerCase() &&
            remoteTeachers.some(
              (t) =>
                t.userId !== userId && t.email.toLowerCase() === cleanEmail
            )
          ) {
            return res.status(409).json({
              error: 'Email giáo viên đã được tài khoản khác sử dụng.',
            });
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

        const supabaseSync = await upsertSingleTeacherOnSupabaseServer(
          sbClient,
          teacher,
          previousEmail
        );
        if (!supabaseSync.ok) {
          return res.status(502).json({
            error:
              supabaseSync.error || 'Không thể cập nhật giáo viên trên Supabase.',
          });
        }

        const localDb = getLocalDb();
        const localIdx = localDb.teachers.findIndex((t) => t.userId === userId);
        if (localIdx >= 0) {
          localDb.teachers[localIdx] = teacher;
          saveLocalDb();
        }

        const { password: _pw, ...safe } = teacher;
        return res.json({ ...safe, supabaseSync });
      }

      const db = getLocalDb();
      const teacher = db.teachers.find((t) => t.userId === userId);
      if (!teacher) {
        return res.status(404).json({ error: 'Không tìm thấy giáo viên.' });
      }
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
      if (req.authTeacher?.userId === userId && nextRole !== 'master') {
        return res.status(400).json({
          error: 'Không thể tự hạ quyền Master của tài khoản đang đăng nhập.',
        });
      }
      if (req.authTeacher?.userId === userId && nextStatus === 'locked') {
        return res.status(400).json({
          error: 'Không thể tự tạm khóa tài khoản đang đăng nhập.',
        });
      }

      if (typeof email === 'string' && email.trim()) {
        const cleanEmail = email.trim().toLowerCase();
        if (
          cleanEmail !== teacher.email.toLowerCase() &&
          db.teachers.some(
            (t) => t.userId !== userId && t.email.toLowerCase() === cleanEmail
          )
        ) {
          return res.status(409).json({
            error: 'Email giáo viên đã được tài khoản khác sử dụng.',
          });
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
      saveLocalDb();

      const supabaseSync: SupabaseSyncStatus = invalidReason
        ? { configured: true, ok: false, error: invalidReason }
        : { configured: false, ok: true };
      const { password: _pw, ...safe } = teacher;
      return res.json({ ...safe, supabaseSync });
    })
  );

  app.delete(
    '/api/teachers/:userId',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { userId } = req.params;
      if (req.authTeacher?.userId === userId) {
        return res
          .status(400)
          .json({ error: 'Không thể tự xóa tài khoản đang đăng nhập.' });
      }

      const { client: sbClient, invalidReason } = resolveSupabaseFromRequest(req);
      if (sbClient) {
        const remoteTeachers = await listTeachersFromSupabase(sbClient);
        const masterCheck = canDeleteOrDemoteMaster(remoteTeachers, userId);
        if (!masterCheck.ok) {
          return res.status(400).json({ error: masterCheck.error });
        }
        const removed = remoteTeachers.find((t) => t.userId === userId);
        if (!removed) {
          return res.status(404).json({ error: 'Không tìm thấy giáo viên.' });
        }
        const supabaseSync = await deleteTeacherOnSupabaseServer(
          sbClient,
          removed
        );
        if (!supabaseSync.ok) {
          return res.status(502).json({
            error:
              supabaseSync.error || 'Không thể xóa giáo viên trên Supabase.',
          });
        }
        const localDb = getLocalDb();
        localDb.teachers = localDb.teachers.filter((t) => t.userId !== userId);
        saveLocalDb();
        return res.json({ ok: true, supabaseSync });
      }

      const db = getLocalDb();
      const masterCheck = canDeleteOrDemoteMaster(db.teachers, userId);
      if (!masterCheck.ok) {
        return res.status(400).json({ error: masterCheck.error });
      }
      const idx = db.teachers.findIndex((t) => t.userId === userId);
      if (idx === -1) {
        return res.status(404).json({ error: 'Không tìm thấy giáo viên.' });
      }
      db.teachers.splice(idx, 1);
      saveLocalDb();
      const supabaseSync: SupabaseSyncStatus = invalidReason
        ? { configured: true, ok: false, error: invalidReason }
        : { configured: false, ok: true };
      return res.json({ ok: true, supabaseSync });
    })
  );

  // --- Schools (Master only) ---
  app.post(
    '/api/schools',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { name, district } = req.body ?? {};
      if (!name || !district) {
        return res
          .status(400)
          .json({ error: 'Thiếu tên trường hoặc quận/huyện.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const school = await createSchoolOnSupabase(client, {
          name: String(name),
          district: String(district),
        });
        return res.status(201).json(school);
      }
      const db = getLocalDb();
      const school: School = {
        id: makeId('school'),
        name: String(name).trim(),
        district: String(district).trim(),
        createdAt: new Date().toISOString(),
      };
      db.schools.push(school);
      saveLocalDb();
      return res.status(201).json(school);
    })
  );

  app.put(
    '/api/schools/:id',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { name, district } = req.body ?? {};
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const school = await updateSchoolOnSupabase(client, req.params.id, {
          name: typeof name === 'string' ? name : undefined,
          district: typeof district === 'string' ? district : undefined,
        });
        return res.json(school);
      }
      const db = getLocalDb();
      const school = db.schools.find((s) => s.id === req.params.id);
      if (!school) return res.status(404).json({ error: 'Không tìm thấy trường.' });
      if (name) school.name = String(name).trim();
      if (district) school.district = String(district).trim();
      saveLocalDb();
      return res.json(school);
    })
  );

  app.delete(
    '/api/schools/:id',
    requireRoles('master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await deleteSchoolOnSupabase(client, req.params.id);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
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
      db.classTaskConfigs = db.classTaskConfigs.filter(
        (c) => !classIds.has(c.classId)
      );
      db.battleConfigs = db.battleConfigs.filter((c) => !classIds.has(c.classId));
      db.battleRooms = db.battleRooms.filter((r) => !classIds.has(r.classId));
      db.submissions = db.submissions.filter(
        (sub) => !studentIds.has(sub.studentId)
      );
      db.breakStates = db.breakStates.filter((b) => !studentIds.has(b.studentId));
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  // --- Classes ---
  app.post(
    '/api/classes',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { schoolId, name, grade } = req.body ?? {};
      if (!schoolId || !name || !grade) {
        return res.status(400).json({ error: 'Thiếu thông tin lớp học.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const cls = await createClassOnSupabase(client, {
          schoolId: String(schoolId),
          name: String(name),
          grade: String(grade),
        });
        return res.status(201).json(cls);
      }
      const db = getLocalDb();
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
      saveLocalDb();
      return res.status(201).json(newClass);
    })
  );

  app.put(
    '/api/classes/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { name, grade } = req.body ?? {};
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const cls = await updateClassOnSupabase(client, req.params.id, {
          name: typeof name === 'string' ? name : undefined,
          grade: typeof grade === 'string' ? grade : undefined,
        });
        return res.json(cls);
      }
      const db = getLocalDb();
      const cls = db.classes.find((c) => c.id === req.params.id);
      if (!cls) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
      if (name) cls.name = String(name).trim();
      if (grade) cls.grade = String(grade).trim();
      saveLocalDb();
      return res.json(cls);
    })
  );

  app.delete(
    '/api/classes/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await deleteClassOnSupabase(client, req.params.id);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
      const classId = req.params.id;
      const studentIds = new Set(
        db.students.filter((st) => st.classId === classId).map((st) => st.id)
      );
      db.classes = db.classes.filter((c) => c.id !== classId);
      db.students = db.students.filter((st) => st.classId !== classId);
      db.classTaskConfigs = db.classTaskConfigs.filter(
        (c) => c.classId !== classId
      );
      db.battleConfigs = db.battleConfigs.filter((c) => c.classId !== classId);
      db.battleRooms = db.battleRooms.filter((r) => r.classId !== classId);
      db.submissions = db.submissions.filter(
        (sub) => !studentIds.has(sub.studentId)
      );
      db.breakStates = db.breakStates.filter((b) => !studentIds.has(b.studentId));
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  // --- Students ---
  app.post(
    '/api/students',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { classId, fullName, studentCode, alwaysBreakReady } =
        req.body ?? {};
      if (!classId || !fullName || !studentCode) {
        return res
          .status(400)
          .json({ error: 'Thiếu lớp, họ tên hoặc mã học sinh.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const student = await createStudentOnSupabase(client, {
          classId: String(classId),
          fullName: String(fullName),
          studentCode: String(studentCode),
          alwaysBreakReady: Boolean(alwaysBreakReady),
        });
        return res.status(201).json(student);
      }
      const db = getLocalDb();
      const cls = db.classes.find((c) => c.id === classId);
      if (!cls) return res.status(404).json({ error: 'Lớp học không tồn tại.' });
      const trimmedCode = String(studentCode).trim().toUpperCase();
      const duplicate = db.students.some(
        (s) =>
          s.classId === classId && s.studentCode.toUpperCase() === trimmedCode
      );
      if (duplicate) {
        return res
          .status(409)
          .json({ error: `Mã học sinh ${trimmedCode} đã tồn tại trong lớp.` });
      }
      const trimmedName = String(fullName).trim();
      const student: StudentProfile = {
        id: makeId('st'),
        classId: String(classId),
        fullName: trimmedName,
        studentCode: trimmedCode,
        passwordHash: normalizeVietnamesePassword(trimmedName),
        isCustomPassword: false,
        alwaysBreakReady: Boolean(alwaysBreakReady),
        createdAt: new Date().toISOString(),
      };
      db.students.push(student);
      saveLocalDb();
      return res.status(201).json(student);
    })
  );

  app.post(
    '/api/students/batch',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { classId, rows } = req.body ?? {};
      if (!classId || !Array.isArray(rows) || rows.length === 0) {
        return res
          .status(400)
          .json({ error: 'Danh sách nhập học sinh không hợp lệ.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const result = await batchCreateStudentsOnSupabase(
          client,
          String(classId),
          rows
        );
        return res.status(201).json(result);
      }
      const db = getLocalDb();
      const cls = db.classes.find((c) => c.id === classId);
      if (!cls) return res.status(404).json({ error: 'Lớp học không tồn tại.' });

      const created: StudentProfile[] = [];
      const skipped: string[] = [];

      for (const row of rows) {
        const fullName = String(row.fullName ?? '').trim();
        const studentCode = String(row.studentCode ?? '').trim().toUpperCase();
        if (!fullName || !studentCode) continue;

        const exists = db.students.some(
          (s) =>
            s.classId === classId && s.studentCode.toUpperCase() === studentCode
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

      saveLocalDb();
      return res.status(201).json({ created, skipped });
    })
  );

  app.put(
    '/api/students/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { fullName, studentCode, alwaysBreakReady } = req.body ?? {};
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const updated = await updateStudentOnSupabase(client, req.params.id, {
          fullName: typeof fullName === 'string' ? fullName : undefined,
          studentCode: typeof studentCode === 'string' ? studentCode : undefined,
          alwaysBreakReady:
            typeof alwaysBreakReady === 'boolean' ? alwaysBreakReady : undefined,
        });
        return res.json(updated);
      }
      const db = getLocalDb();
      const student = db.students.find((s) => s.id === req.params.id);
      if (!student)
        return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
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
      saveLocalDb();
      return res.json(student);
    })
  );

  app.delete(
    '/api/students/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await deleteStudentOnSupabase(client, req.params.id);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
      const id = req.params.id;
      db.students = db.students.filter((s) => s.id !== id);
      db.submissions = db.submissions.filter((sub) => sub.studentId !== id);
      db.breakStates = db.breakStates.filter((b) => b.studentId !== id);
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  app.post(
    '/api/students/:id/reset-password',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const updated = await resetStudentPasswordOnSupabase(
          client,
          req.params.id
        );
        return res.json(updated);
      }
      const db = getLocalDb();
      const student = db.students.find((s) => s.id === req.params.id);
      if (!student)
        return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
      student.passwordHash = normalizeVietnamesePassword(student.fullName);
      student.isCustomPassword = false;
      saveLocalDb();
      return res.json(student);
    })
  );

  app.post(
    '/api/classes/:id/reset-passwords',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const count = await resetClassPasswordsOnSupabase(client, req.params.id);
        return res.json({ ok: true, count });
      }
      const db = getLocalDb();
      const classId = req.params.id;
      let count = 0;
      for (const student of db.students) {
        if (student.classId === classId) {
          student.passwordHash = normalizeVietnamesePassword(student.fullName);
          student.isCustomPassword = false;
          count++;
        }
      }
      saveLocalDb();
      return res.json({ ok: true, count });
    })
  );

  // --- Modules ---
  app.post(
    '/api/modules',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<IC3ModuleRecord>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const created = await createModuleOnSupabase(client, body);
        return res.status(201).json(created);
      }
      const db = getLocalDb();
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
            m.code.toLowerCase() === rawCode || m.level.toUpperCase() === level
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
      saveLocalDb();
      return res.status(201).json(created);
    })
  );

  app.put(
    '/api/modules/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<IC3ModuleRecord>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const updated = await updateModuleOnSupabase(
          client,
          req.params.id,
          body
        );
        return res.json(updated);
      }
      const db = getLocalDb();
      const mod = db.modules.find((m) => m.id === req.params.id);
      if (!mod) return res.status(404).json({ error: 'Không tìm thấy Mô-đun.' });
      const nextLevel =
        body.level !== undefined
          ? String(body.level).trim().toUpperCase()
          : mod.level;
      const nextTitle =
        body.title !== undefined ? String(body.title).trim() : mod.title;
      if (!nextLevel || !nextTitle) {
        return res
          .status(400)
          .json({ error: 'Level và tên Mô-đun không được để trống.' });
      }
      if (
        nextLevel !== mod.level &&
        db.modules.some(
          (m) => m.id !== mod.id && m.level.toUpperCase() === nextLevel
        )
      ) {
        return res
          .status(409)
          .json({ error: `Level ${nextLevel} đã tồn tại ở mô-đun khác.` });
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
      saveLocalDb();
      return res.json(mod);
    })
  );

  app.delete(
    '/api/modules/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await deleteModuleOnSupabase(client, req.params.id);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
      const mod = db.modules.find((m) => m.id === req.params.id);
      if (!mod) return res.status(404).json({ error: 'Không tìm thấy Mô-đun.' });
      const hasCategories = db.knowledgeCategories.some(
        (c) => c.module === mod.code
      );
      const hasParts = db.knowledgeParts.some((p) => p.module === mod.code);
      const hasQuestions = db.questions.some((q) => q.module === mod.code);
      if (hasCategories || hasParts || hasQuestions) {
        return res.status(400).json({
          error:
            'Mô-đun vẫn còn nhóm kiến thức, phần kiến thức hoặc câu hỏi. Vui lòng xóa dữ liệu bên trong trước.',
        });
      }
      db.modules = db.modules.filter((m) => m.id !== mod.id);
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  // --- Knowledge Categories ---
  app.post(
    '/api/knowledge-categories',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<KnowledgeCategoryRecord>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const created = await createCategoryOnSupabase(client, body);
        return res.status(201).json(created);
      }
      const db = getLocalDb();
      const modCode = String(body.module ?? '').trim();
      const cleanCode = String(body.code ?? '').trim().toUpperCase();
      const title = String(body.title ?? '').trim();
      if (!modCode || !cleanCode || !title) {
        return res.status(400).json({
          error: 'Thiếu thông tin Mô-đun, mã hoặc tên nhóm kiến thức.',
        });
      }
      const exists = db.knowledgeCategories.some(
        (c) => c.module === modCode && c.code.toUpperCase() === cleanCode
      );
      if (exists) {
        return res
          .status(409)
          .json({ error: `Nhóm ${cleanCode} đã tồn tại trong mô-đun này.` });
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
      saveLocalDb();
      return res.status(201).json(created);
    })
  );

  app.put(
    '/api/knowledge-categories/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<KnowledgeCategoryRecord>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const updated = await updateCategoryOnSupabase(
          client,
          req.params.id,
          body
        );
        return res.json(updated);
      }
      const db = getLocalDb();
      const cat = db.knowledgeCategories.find((c) => c.id === req.params.id);
      if (!cat)
        return res.status(404).json({ error: 'Không tìm thấy nhóm kiến thức.' });
      const nextTitle =
        body.title !== undefined ? String(body.title).trim() : cat.title;
      if (!nextTitle) {
        return res
          .status(400)
          .json({ error: 'Tên nhóm kiến thức không được để trống.' });
      }
      cat.title = nextTitle;
      if (body.description !== undefined) {
        cat.description = String(body.description).trim();
      }
      saveLocalDb();
      return res.json(cat);
    })
  );

  app.delete(
    '/api/knowledge-categories/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await deleteCategoryOnSupabase(client, req.params.id);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
      const cat = db.knowledgeCategories.find((c) => c.id === req.params.id);
      if (!cat)
        return res.status(404).json({ error: 'Không tìm thấy nhóm kiến thức.' });
      const catCode = cat.code.toUpperCase();
      const hasParts = db.knowledgeParts.some(
        (p) => p.module === cat.module && p.category.toUpperCase() === catCode
      );
      const hasQuestions = db.questions.some(
        (q) => q.module === cat.module && q.category.toUpperCase() === catCode
      );
      if (hasParts || hasQuestions) {
        return res.status(400).json({
          error:
            'Nhóm này vẫn còn phần kiến thức hoặc câu hỏi. Vui lòng xóa bên trong trước.',
        });
      }
      db.knowledgeCategories = db.knowledgeCategories.filter(
        (c) => c.id !== cat.id
      );
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  // --- Knowledge Parts ---
  app.post(
    '/api/knowledge-parts',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<KnowledgePart>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const created = await createPartOnSupabase(client, body);
        return res.status(201).json(created);
      }
      const db = getLocalDb();
      if (
        !body.module ||
        !body.level ||
        !body.category ||
        !body.code ||
        !body.title
      ) {
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
        return res
          .status(409)
          .json({ error: `Phần ${cleanCode} đã tồn tại trong nhóm này.` });
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
      saveLocalDb();
      return res.status(201).json(created);
    })
  );

  app.put(
    '/api/knowledge-parts/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<KnowledgePart>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const updated = await updatePartOnSupabase(
          client,
          req.params.id,
          body
        );
        return res.json(updated);
      }
      const db = getLocalDb();
      const part = db.knowledgeParts.find((p) => p.id === req.params.id);
      if (!part)
        return res.status(404).json({ error: 'Không tìm thấy phần kiến thức.' });
      const nextTitle =
        body.title !== undefined ? String(body.title).trim() : part.title;
      if (!nextTitle) {
        return res
          .status(400)
          .json({ error: 'Tên phần kiến thức không được để trống.' });
      }
      part.title = nextTitle;
      if (body.description !== undefined) {
        part.description = String(body.description).trim();
      }
      saveLocalDb();
      return res.json(part);
    })
  );

  app.delete(
    '/api/knowledge-parts/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await deletePartOnSupabase(client, req.params.id);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
      const part = db.knowledgeParts.find((p) => p.id === req.params.id);
      if (!part)
        return res.status(404).json({ error: 'Không tìm thấy phần kiến thức.' });
      const hasQuestions = db.questions.some(
        (q) =>
          q.module === part.module &&
          q.category === part.category &&
          q.contentCode.toUpperCase() === part.code.toUpperCase()
      );
      if (hasQuestions) {
        return res.status(400).json({
          error:
            'Phần này vẫn còn câu hỏi. Vui lòng xóa hoặc chuyển câu hỏi trước khi xóa phần.',
        });
      }
      db.knowledgeParts = db.knowledgeParts.filter((p) => p.id !== part.id);
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  // --- Questions ---
  function ensureLocalQuestionParents(
    db: AdminDatabase,
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
      const siblings = db.knowledgeCategories.filter(
        (c) => c.module === moduleCode
      );
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
        (p) =>
          p.module === moduleCode && p.category.toUpperCase() === cleanCat
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

  app.post(
    '/api/questions',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const q = req.body as Partial<Question>;
      if (
        !q.prompt ||
        !q.type ||
        !q.module ||
        !q.level ||
        !q.category ||
        !q.payload
      ) {
        return res.status(400).json({ error: 'Thiếu dữ liệu câu hỏi bắt buộc.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const created = await createQuestionOnSupabase(client, q);
        return res.status(201).json(created);
      }
      const db = getLocalDb();
      const cleanCategory = q.category.trim().toUpperCase();
      const contentCode = (q.contentCode || `${cleanCategory}1`)
        .trim()
        .toUpperCase();
      const matchedPart = db.knowledgeParts.find(
        (p) =>
          p.module === q.module &&
          p.category.trim().toUpperCase() === cleanCategory &&
          p.code.trim().toUpperCase() === contentCode
      );
      const topicText = (q.topic || matchedPart?.title || 'Tổng hợp').trim();
      ensureLocalQuestionParents(
        db,
        q.module,
        q.level,
        cleanCategory,
        contentCode,
        topicText
      );
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
        instruction:
          q.instruction?.trim() || getDefaultInstructionForQuestionType(q.type),
        payload: q.payload,
        explanation: (q.explanation || '').trim(),
        tips: q.tips?.trim(),
        createdAt: now,
        updatedAt: now,
      };
      db.questions.push(created);
      saveLocalDb();
      return res.status(201).json(created);
    })
  );

  app.post(
    '/api/questions/reorder',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { updates } = req.body as {
        updates?: Array<{ id: string; topicOrder: number }>;
      };
      if (!Array.isArray(updates)) {
        return res.status(400).json({ error: 'Danh sách sắp xếp không hợp lệ.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await reorderQuestionsOnSupabaseServer(client, updates);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
      const map = new Map(updates.map((u) => [u.id, u.topicOrder]));
      for (const q of db.questions) {
        const nextOrder = map.get(q.id);
        if (typeof nextOrder === 'number') {
          q.topicOrder = nextOrder;
          q.updatedAt = new Date().toISOString();
        }
      }
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  app.put(
    '/api/questions/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const updated = await updateQuestionOnSupabase(
          client,
          req.params.id,
          (req.body ?? {}) as Record<string, unknown>
        );
        return res.json(updated);
      }
      const db = getLocalDb();
      const idx = db.questions.findIndex((q) => q.id === req.params.id);
      if (idx === -1)
        return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
      const existing = db.questions[idx];
      const nextCategory = String(req.body.category || existing.category)
        .trim()
        .toUpperCase();
      const nextContentCode = String(
        req.body.contentCode || existing.contentCode
      )
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
        String(req.body.topic || matchedPart?.title || existing.topic).trim() ||
        'Tổng hợp';
      ensureLocalQuestionParents(
        db,
        nextModule,
        nextLevel,
        nextCategory,
        nextContentCode,
        nextTopic
      );
      const { difficulty: _dropExistingDiff, ...cleanExisting } =
        existing as Question & { difficulty?: unknown };
      const { difficulty: _dropBodyDiff, ...cleanBody } = (req.body ??
        {}) as Record<string, unknown>;
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
      saveLocalDb();
      return res.json(updated);
    })
  );

  app.delete(
    '/api/questions/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await deleteQuestionOnSupabaseServer(client, req.params.id);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
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
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  app.post(
    '/api/questions/batch-delete',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { ids } = (req.body ?? {}) as { ids?: unknown };
      if (!Array.isArray(ids)) {
        return res
          .status(400)
          .json({ error: 'Danh sách câu hỏi cần xóa không hợp lệ.' });
      }
      const idSet = new Set(ids.map((id) => String(id).trim()).filter(Boolean));
      if (idSet.size === 0) {
        return res.status(400).json({ error: 'Chưa chọn câu hỏi nào để xóa.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const deletedCount = await batchDeleteQuestionsOnSupabaseServer(
          client,
          Array.from(idSet)
        );
        return res.json({ ok: true, deletedCount });
      }
      const db = getLocalDb();
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
      saveLocalDb();
      return res.json({ ok: true, deletedCount });
    })
  );

  // --- Question Sets ---
  app.post(
    '/api/question-sets',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<QuestionSet>;
      if (!body.title) {
        return res.status(400).json({ error: 'Thiếu tiêu đề bộ đề.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const created = await createQuestionSetOnSupabase(client, body);
        return res.status(201).json(created);
      }
      const db = getLocalDb();
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
      saveLocalDb();
      return res.status(201).json(created);
    })
  );

  app.put(
    '/api/question-sets/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<QuestionSet>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const updated = await updateQuestionSetOnSupabase(
          client,
          req.params.id,
          body
        );
        return res.json(updated);
      }
      const db = getLocalDb();
      const idx = db.questionSets.findIndex((s) => s.id === req.params.id);
      if (idx === -1)
        return res.status(404).json({ error: 'Không tìm thấy bộ đề.' });
      const existing = db.questionSets[idx];
      const updated: QuestionSet = {
        ...existing,
        ...body,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      db.questionSets[idx] = updated;
      saveLocalDb();
      return res.json(updated);
    })
  );

  app.delete(
    '/api/question-sets/:id',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        await deleteQuestionSetOnSupabaseServer(client, req.params.id);
        return res.json({ ok: true });
      }
      const db = getLocalDb();
      db.questionSets = db.questionSets.filter((s) => s.id !== req.params.id);
      saveLocalDb();
      return res.json({ ok: true });
    })
  );

  app.post(
    '/api/question-bank/import-remote',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
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
        return res
          .status(400)
          .json({ error: 'Danh sách câu hỏi không hợp lệ.' });
      }
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const counts = await importQuestionBankToSupabase(client, {
          modules,
          knowledgeCategories,
          knowledgeParts,
          questions,
          questionSets,
        });
        return res.json({ ok: true, counts });
      }
      const db = getLocalDb();
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
      saveLocalDb();
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
    })
  );

  // --- Class Task Configs ---
  app.put(
    '/api/class-tasks/:classId',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { classId } = req.params;
      const body = req.body as Partial<ClassTaskConfig>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const config = await saveClassTaskConfigOnSupabase(
          client,
          classId,
          body
        );
        return res.json(config);
      }
      const db = getLocalDb();
      const cls = db.classes.find((c) => c.id === classId);
      if (!cls)
        return res.status(404).json({ error: 'Không tìm thấy lớp học.' });

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
        assignmentTitle: (
          body.assignmentTitle || `Bài tập lớp ${cls.name}`
        ).trim(),
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
      saveLocalDb();
      return res.json(config);
    })
  );

  // --- Submissions ---
  app.post(
    '/api/submissions',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { studentId, taskId, correctCount, totalCount, durationSeconds } =
        req.body ?? {};
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const record = await createSubmissionOnSupabase(client, {
          studentId,
          taskId,
          correctCount,
          totalCount,
          durationSeconds,
        });
        return res.status(201).json(record);
      }
      const db = getLocalDb();
      const student = db.students.find((s) => s.id === studentId);
      if (!student)
        return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
      const cls = db.classes.find((c) => c.id === student.classId);
      if (!cls) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
      const taskCfg = db.classTaskConfigs.find((c) => c.classId === cls.id);
      const task = taskCfg?.tasks.find((t) => t.id === taskId);
      if (!taskCfg || !task) {
        return res.status(404).json({ error: 'Không tìm thấy nhiệm vụ lớp.' });
      }

      const total = Math.max(
        1,
        Number(totalCount ?? task.questionIds.length ?? 5)
      );
      const correct = Math.min(
        total,
        Math.max(0, Number(correctCount ?? 0))
      );
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
        const existingBreak = db.breakStates.find(
          (b) => b.studentId === student.id
        );
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

      saveLocalDb();
      return res.status(201).json(record);
    })
  );

  // --- Battle Configs & Rooms ---
  app.put(
    '/api/battle-configs/:classId',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { classId } = req.params;
      const body = req.body as Partial<ClassBattleConfig>;
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const config = await saveBattleConfigOnSupabase(client, classId, body);
        return res.json(config);
      }
      const db = getLocalDb();
      const cls = db.classes.find((c) => c.id === classId);
      if (!cls)
        return res.status(404).json({ error: 'Không tìm thấy lớp học.' });

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

      const lobby = db.battleRooms.find(
        (r) => r.classId === classId && r.status === 'lobby'
      );
      if (lobby) {
        lobby.configSnapshot = config;
        lobby.questionIds = config.questionIds;
      }

      saveLocalDb();
      return res.json(config);
    })
  );

  app.post(
    '/api/battle-rooms',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { classId } = req.body ?? {};
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const room = await createBattleRoomOnSupabase(client, String(classId));
        return res.status(201).json(room);
      }
      const db = getLocalDb();
      const cfg = db.battleConfigs.find((c) => c.classId === classId);
      if (!cfg) {
        return res.status(400).json({
          error:
            'Vui lòng lưu cấu hình Thi đấu cho lớp trước khi mở phòng.',
        });
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
      saveLocalDb();
      return res.status(201).json(room);
    })
  );

  app.post(
    '/api/battle-rooms/:roomId/join',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { studentId } = req.body ?? {};
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const room = await joinBattleRoomOnSupabase(
          client,
          req.params.roomId,
          String(studentId ?? '')
        );
        return res.json(room);
      }
      const db = getLocalDb();
      const room = db.battleRooms.find((r) => r.id === req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
      const student = db.students.find((s) => s.id === studentId);
      if (!student)
        return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
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
      saveLocalDb();
      return res.json(room);
    })
  );

  app.post(
    '/api/battle-rooms/:roomId/start',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const room = await startBattleRoomOnSupabase(client, req.params.roomId);
        return res.json(room);
      }
      const db = getLocalDb();
      const room = db.battleRooms.find((r) => r.id === req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
      if (room.participants.length === 0) {
        return res.status(400).json({
          error: 'Cần ít nhất 1 học sinh trong phòng chờ để bắt đầu.',
        });
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
      saveLocalDb();
      return res.json(room);
    })
  );

  app.post(
    '/api/battle-rooms/:roomId/simulate-step',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const room = await simulateBattleStepOnSupabase(
          client,
          req.params.roomId
        );
        return res.json(room);
      }
      const db = getLocalDb();
      const room = db.battleRooms.find((r) => r.id === req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
      if (room.status !== 'playing') {
        return res
          .status(400)
          .json({ error: 'Phòng đấu chưa ở trạng thái đang diễn ra.' });
      }

      const totalQuestions = Math.max(1, room.questionIds.length);
      const now = new Date();
      const debuffs: BattleDebuffType[] = ['blur', 'frost', 'reverse', 'shake'];

      for (const p of room.participants) {
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

        const elapsedDelta = Math.floor(Math.random() * 9) + 6;
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
              const debuffType =
                debuffs[Math.floor(Math.random() * debuffs.length)];
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
      saveLocalDb();
      return res.json(room);
    })
  );

  app.post(
    '/api/battle-rooms/:roomId/finish',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const room = await finishBattleRoomOnSupabase(client, req.params.roomId);
        return res.json(room);
      }
      const db = getLocalDb();
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

      for (const r of room.rankedResults) {
        if (r.rewardedBreakMinutes > 0) {
          const extraSec = r.rewardedBreakMinutes * 60;
          const existing = db.breakStates.find(
            (b) => b.studentId === r.studentId
          );
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
      saveLocalDb();
      return res.json(room);
    })
  );

  app.post(
    '/api/battle-rooms/:roomId/reset',
    requireRoles('teacher_lv2', 'master'),
    asyncHandler(async (req, res) => {
      const { client } = resolveSupabaseFromRequest(req);
      if (client) {
        const room = await resetBattleRoomOnSupabase(client, req.params.roomId);
        return res.json(room);
      }
      const db = getLocalDb();
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
      saveLocalDb();
      return res.json(room);
    })
  );

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (res.headersSent) return;
      if (err instanceof SupabaseStoreError) {
        return res.status(err.status).json({ error: err.message });
      }
      const status =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : typeof (err as { statusCode?: unknown })?.statusCode === 'number'
            ? (err as { statusCode: number }).statusCode
            : 500;
      const isSyntaxErr =
        err instanceof SyntaxError ||
        (err as { type?: unknown })?.type === 'entity.parse.failed';
      const message = isSyntaxErr
        ? 'Dữ liệu gửi lên không đúng định dạng JSON.'
        : err instanceof Error && err.message
          ? err.message
          : 'Lỗi máy chủ không xác định.';
      return res
        .status(status >= 400 && status < 600 ? status : 500)
        .json({ error: message });
    }
  );

  return app;
}
