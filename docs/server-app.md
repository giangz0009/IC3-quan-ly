# Lưu trữ Kiến trúc Backend API: `server/app.ts`

**Nguồn gốc:** `server/app.ts` (3.031 dòng)  
**Cập nhật bản lưu:** 2026-11-28

---

## 1. Tổng quan Kiến trúc Express Factory (`createApp`)
`server/app.ts` xuất hàm `createApp(): express.Express` dùng chung cho hai môi trường:
1. **Vercel Serverless Function (`api/index.ts` + `vercel.json`)** — chạy stateless không cần session lưu RAM.
2. **Node.js / Vite Dev Server (`server.ts`)** — chạy cổng `3000` kèm phục vụ SPA.

Mọi thao tác dữ liệu đều **ưu tiên đọc/ghi trực tiếp 17 bảng Supabase PostgreSQL** (qua `server/supabaseStore.ts`) nếu có cấu hình Supabase từ request body, header `X-Supabase-*`, hoặc biến môi trường `SUPABASE_URL`/`SUPABASE_ANON_KEY`; chỉ fallback về `server/localStore.ts` (`data/ic3_admin_db.json` hoặc `os.tmpdir()`) khi chưa cấu hình Supabase.

---

## 2. Cơ chế Phân giải Supabase & Bảo mật Stateless

### 2.1. Phân giải Supabase Client (`resolveSupabaseFromRequest`)
```ts
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
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, envConfigured };
}
```

### 2.2. Middleware Xác thực & Phân quyền (`requireAuth`, `requireRoles`)
```ts
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
```

### 2.3. Chuẩn hóa URL Serverless trên Vercel
```ts
app.use(express.json({ limit: '15mb' }));

// Support rewritten serverless paths (?__path=...) and stripped /api prefixes
app.use((req, _res, next) => {
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const pathParam = parsed.searchParams.get('__path');
      if (pathParam !== null) {
        parsed.searchParams.delete('__path');
        const qs = parsed.searchParams.toString();
        const targetPathname =
          parsed.pathname === '/api/index' || parsed.pathname === '/api'
            ? (() => {
                const cleanSub = pathParam.replace(/^\/+/, '');
                return cleanSub ? `/api/${cleanSub}` : '/api';
              })()
            : parsed.pathname;
        req.url = `${targetPathname}${qs ? `?${qs}` : ''}`;
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
```

---

## 3. Luồng Đăng nhập Đa lớp (`POST /api/auth/login`) & Khởi tạo (`GET /api/bootstrap`)

```ts
// Thứ tự xác thực khi có Supabase:
// 1. Tìm dòng theo email trong public.admin_teachers (findAdminTeacherInSupabaseByEmail).
// 2. Đối chiếu password_hash (scrypt/plaintext legacy) → fallback supabase.auth.signInWithPassword().
// 3. Nếu chưa có dòng trong admin_teachers → thử Auth trực tiếp → upsert dòng giáo viên mới nếu Auth thành công.
// 4. Kiểm tra status === 'locked' (trả 403), ký HMAC-SHA256 stateless token với (userId, email).
// 5. Fallback sang server/localStore.ts khi bảng admin_teachers trống (0 dòng) hoặc chưa cấu hình Supabase.
```

- `GET /api/bootstrap` (`requireAuth`): gọi `fetchAdminDatabaseFromSupabase(sbClient, { includeTeachers: isMaster, seedFallbackTeachers })`. Nếu Supabase chưa khởi tạo bảng (`42P01` / `PGRST205`), trả về fallback an toàn để Master cấu hình SQL; luôn ẩn danh sách `teachers` nếu không phải `master` và xóa bỏ trường `password` qua `sanitizeTeachers()`.

---

## 4. Bảng Toàn bộ Endpoint & Quyền truy cập trong `server/app.ts`

### 4.1. Hệ thống, Chẩn đoán Supabase & Storage
- `GET /api/health` *(Public)* — trả `{ ok, timestamp, persistence: 'supabase' | 'local', supabaseConfigured, envConfigured }`
- `POST /api/supabase/test` *(Master)* — kiểm tra kết nối & đếm số dòng 15 bảng cốt lõi trên Supabase
- `POST /api/supabase/sample` *(Master)* — đọc thử 8 câu hỏi & phần kiến thức từ Supabase
- `POST /api/supabase/seed` *(Master)* — đồng bộ toàn bộ CSDL (hoặc seed chuẩn `useSeedSample: true`) lên 17 bảng Supabase
- `POST /api/storage/hotspot-upload` *(`teacher_lv2`, `master`)* — tải ảnh base64 lên Supabase Storage bucket `hotspot-images`

### 4.2. Xác thực & Quản lý Giáo viên
- `POST /api/auth/login` *(Public)* & `POST /api/auth/logout` *(Public/Token)*
- `POST /api/teachers/sync-supabase` *(Master)* — đẩy danh sách giáo viên lên `public.admin_teachers`
- `POST /api/teachers/pull-supabase` *(Master)* — kéo & gộp danh sách giáo viên từ `public.admin_teachers`
- `POST /api/teachers` *(Master)*, `PUT /api/teachers/:userId` *(Master)*, `DELETE /api/teachers/:userId` *(Master)* — kiểm tra trùng email, bảo vệ tài khoản Master cuối cùng (`canDeleteOrDemoteMaster`) và chặn tự hạ quyền/khóa/xóa chính mình.

### 4.3. Phân cấp Trường học, Lớp học & Học sinh
- `POST /api/schools` *(Master)*, `PUT /api/schools/:id` *(Master)*, `DELETE /api/schools/:id` *(Master)* — xóa cascade lớp, học sinh, bài tập, bài nộp, giải lao, thi đấu.
- `POST /api/classes` *(Auth)*, `POST /api/classes/batch` *(Auth)*, `PUT /api/classes/:id` *(Auth)*, `DELETE /api/classes/:id` *(Auth)* — nhập hàng loạt lớp (chuẩn hóa khối & bỏ qua trùng tên trong trường) và xóa cascade học sinh & cấu hình lớp.
- `POST /api/students` *(Auth)*, `POST /api/students/batch` *(Auth)*, `PUT /api/students/:id` *(Auth)*, `DELETE /api/students/:id` *(Auth)* — kiểm tra trùng `studentCode` trong lớp (`409`), tự sinh mật khẩu mặc định bằng `normalizeVietnamesePassword(fullName)`; riêng `POST /api/students/batch` tự động đánh mã HS nối tiếp theo lớp (`generateNextStudentCode`, VD: `6A1-06`, `6A1-07`) khi không truyền mã và luôn đặt `alwaysBreakReady = false` (giải lao demo về mặc định).
- `POST /api/students/:id/reset-password` *(Auth)*, `POST /api/classes/:id/reset-passwords` *(Auth)*.

### 4.4. Ngân hàng Câu hỏi 4 tầng, Bộ đề & Nhập hàng loạt
- **Mô-đun:** `POST /api/modules`, `PUT /api/modules/:id`, `DELETE /api/modules/:id` *(`teacher_lv2`, `master`)*
- **Nhóm kiến thức:** `POST /api/knowledge-categories`, `PUT /api/knowledge-categories/:id`, `DELETE /api/knowledge-categories/:id` *(`teacher_lv2`, `master`)* — hỗ trợ cập nhật trực tiếp cờ `isEnabled` (bật/tắt trạng thái sẵn sàng cho học sinh làm bài) mà không cần gửi lại toàn bộ `title`.
- **Phần kiến thức:** `POST /api/knowledge-parts`, `POST /api/knowledge-parts/batch-readiness`, `PUT /api/knowledge-parts/:id`, `DELETE /api/knowledge-parts/:id` *(`teacher_lv2`, `master`)* — hỗ trợ tạo kèm `isEnabled`, cập nhật trực tiếp cờ `isEnabled` từng phần (không cần gửi lại `title`), và bật/tắt hàng loạt tất cả các phần trong cùng một nhóm (`Bật tất cả` / `Tắt tất cả`).
- **Câu hỏi:** `POST /api/questions`, `POST /api/questions/reorder`, `PUT /api/questions/:id`, `DELETE /api/questions/:id`, `POST /api/questions/batch-delete` *(`teacher_lv2`, `master`)* — tự đảm bảo bản ghi cha (`ensureLocalQuestionParents` / `server/supabaseStore.ts`), tự gỡ ID khỏi `questionSets` & `classTaskConfigs`, tự dọn ảnh Hotspot cũ trên Storage.
- **Bộ đề & Nhập dữ liệu:** `POST /api/question-sets`, `PUT /api/question-sets/:id`, `DELETE /api/question-sets/:id`, `POST /api/question-bank/import-remote` *(`teacher_lv2`, `master`)* — hỗ trợ `mode: 'merge' | 'replace'`.

### 4.5. Giao bài tập, Nộp bài & Thi đấu Realtime
- **Bài tập & Nộp bài:** `PUT /api/class-tasks/:classId` *(Auth)*, `POST /api/submissions` *(Auth)* — tự tính điểm thang `1000` (`calculateIC3Score`), đánh giá `metMinScore`, tự mở khóa `student_break_states` khi `isStudentBreakUnlocked(...)` đạt `true`.
- **Thi đấu Realtime:** `PUT /api/battle-configs/:classId`, `POST /api/battle-rooms`, `POST /api/battle-rooms/:roomId/join`, `start`, `simulate-step`, `finish`, `reset` *(`teacher_lv2`, `master`)* — tính combo, khiên (`+2`), 4 debuff (`blur`, `frost`, `reverse`, `shake`), xếp hạng `rankBattleParticipants()` và cộng phút giải lao cho Top X khi kết thúc.

---

## 5. Xử lý 404 & Lỗi Toàn cục (`app.ts` cuối file)

```ts
app.all('/api/*', (req, res) => {
  return res.status(404).json({
    error: `Không tìm thấy API endpoint: ${req.method} ${req.path}`,
  });
});

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
```
