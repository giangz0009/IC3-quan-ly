# Kiến trúc Hệ thống, Mô hình Dữ liệu & API

**Cập nhật lần cuối:** 2026-11-28  
**File nguồn liên quan:** `api/index.ts`, `vercel.json`, `.env.example`, `server.ts`, `server/app.ts`, `server/supabaseStore.ts`, `server/localStore.ts`, `server/security.ts`, `src/utils/supabaseMappers.ts`, `src/utils/ic3Rules.ts`, `src/utils/ic3Excel.ts`, `src/types/ic3.ts`, `src/data/seedData.ts`, `src/utils/api.ts`, `src/utils/supabaseClient.ts`, `src/components/TableSkeleton.tsx`  
**Bản lưu chi tiết tương ứng:** [App.md](./App.md) · [server-app.md](./server-app.md) · [types-ic3.md](./types-ic3.md)

---

## 1. Kiến trúc Vercel Serverless & Lưu trữ Trực tiếp 17 bảng Supabase

Ứng dụng sử dụng chung 1 Express app factory (`createApp()` trong `server/app.ts`) cho cả **Vercel Serverless Function** (`api/index.ts` + `vercel.json`) và **máy chủ Express + Vite cục bộ** (`server.ts`):

1. **Chế độ Đám mây Trực tiếp (Khuyến nghị & mặc định trên Vercel)**:
   - Backend tự nhận cấu hình Supabase theo thứ tự ưu tiên: request body → header `X-Supabase-Url` / `X-Supabase-Anon-Key` → biến môi trường server `SUPABASE_URL` + `SUPABASE_ANON_KEY` (hoặc `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
   - Toàn bộ **17 bảng vận hành** (`schools`, `classes`, `students`, `admin_teachers`, `ic3_modules`, `knowledge_categories`, `knowledge_parts`, `questions`, `question_sets`, `class_task_configs`, `class_tasks`, `student_task_submissions`, `student_break_states`, `class_battle_configs`, `battle_rooms`, `battle_participants`, `battle_events`) và bucket ảnh `hotspot-images` trên **Supabase Storage** được đọc/ghi **trực tiếp** thông qua `server/supabaseStore.ts` + bộ chuyển đổi chuẩn UUID RFC4122 (`src/utils/supabaseMappers.ts`).
   - Xác thực stateless bằng token **HMAC-SHA256** ký qua `SESSION_SECRET` (`server/security.ts`, payload chứa `userId`, `email`, `exp`) nên tương thích 100% với môi trường Serverless nhiều instance trên Vercel mà không cần session lưu RAM.
   - `findAdminTeacherInSupabaseByEmail()` và `getTeacherFromSupabaseById()` hỗ trợ fallback truy vấn `select('*')` khi DB Supabase cũ chưa kịp chạy migration thêm cột (`42703` / `PGRST204`), tránh lỗi `500` khi đăng nhập.
   - Nếu Supabase mới tạo chưa chạy `SUPABASE_SCHEMA_SQL` (`42P01` / `PGRST205`), `/api/bootstrap` tự fallback về cấu trúc rỗng/seed an toàn để Master vào ngay mục **Kết nối Supabase** sao chép SQL và nạp dữ liệu mẫu.

2. **Định tuyến Vercel (`vercel.json` + `api/index.ts`)**:
   - `vercel.json` cấu hình build `npm run build` → `dist`, giới hạn thời gian chạy Serverless function `api/index.ts` là `30s`, và rewrite:
     - `/api` → `/api/index`
     - `/api/(.*)` → `/api/index?__path=$1`
     - `/((?!api/).*)` → `/index.html` (SPA fallback)
   - Hàm `normalizeApiUrl()` trong `api/index.ts` khôi phục chính xác đường dẫn `/api/<subpath>` từ query `__path` (đồng thời giữ nguyên các query params khác) trước khi chuyển tiếp cho Express app, giải quyết triệt để lỗi `404` trên Vercel.

3. **Lớp Dự phòng Cục bộ (`server/localStore.ts` + `data/ic3_admin_db.json`)**:
   - Chỉ kích hoạt khi chưa cấu hình Supabase trên cả biến môi trường server lẫn trình duyệt (chạy thử offline trên máy cá nhân).
   - Khi chạy trong môi trường Serverless (`VERCEL` / `AWS_LAMBDA_FUNCTION_NAME`), fallback an toàn sang `os.tmpdir()` tránh lỗi hệ thống tệp chỉ đọc (`EROFS`).

```text
[React SPA (dist/)] ──/api/*──▶ [vercel.json → api/index.ts (normalizeApiUrl)] (Vercel)
                          └────▶ [Express + Vite server.ts] (Local Dev/Node)
                                        │
                                        ▼
                                 [server/app.ts]
                           ┌────────────┴────────────┐
               (Có Supabase config)          (Chưa cấu hình)
                           ▼                         ▼
             [server/supabaseStore.ts]     [server/localStore.ts]
             (17 bảng PostgreSQL +         (data/ic3_admin_db.json
              Storage hotspot-images)       hoặc os.tmpdir())
```

---

## 2. Biến môi trường (`.env.example`)

| Biến | Nơi cấu hình | Bắt buộc | Mô tả |
|---|---|---|---|
| `SUPABASE_URL` | Server / Vercel Env | Có (nếu dùng DB đám mây mặc định) | Project URL của dự án Supabase |
| `SUPABASE_ANON_KEY` | Server / Vercel Env | Có (nếu dùng DB đám mây mặc định) | Anon Key của dự án Supabase |
| `SESSION_SECRET` | Server / Vercel Env | **Bắt buộc ở Production** | Chuỗi bí mật dài ngẫu nhiên để ký token phiên HMAC-SHA256 stateless |
| `GEMINI_API_KEY` | Runtime AI Studio | Tùy chọn | Key mặc định môi trường (nếu app sử dụng Gemini) |
| `APP_URL` | Runtime AI Studio | Tùy chọn | URL công khai của ứng dụng |

---

## 3. Mô hình Dữ liệu TypeScript (`src/types/ic3.ts`)

### 3.1. Tổ chức & Tài khoản
- **`School`**: `{ id, name, district, createdAt }`
- **`SchoolClass`**: `{ id, schoolId, name, grade, createdAt }`
- **`StudentProfile`**: `{ id, classId, fullName, studentCode, passwordHash, isCustomPassword, alwaysBreakReady, createdAt }`
- **`AdminTeacher`**: `{ userId, fullName, email, password, role: 'teacher_lv1' | 'teacher_lv2' | 'master', status: 'active' | 'locked', createdAt }` *(giáo viên không gắn cố định với một trường mà quản lý liên trường; `password` được băm `scrypt$<salt>$<hash>` ở server; kiểu `SafeTeacher` ở frontend lược bỏ `password`)*.

### 3.2. Ngân hàng Câu hỏi 4 tầng & Bộ đề
- **`IC3ModuleRecord`**: `{ id, code, level, title, description, orderIndex }` *(mặc định có `computing_fundamentals` [LV1], `key_applications` [LV2], `living_online` [LV3]; cho phép thêm tùy biến)*.
- **`KnowledgeCategoryRecord`**: `{ id, module, code, title, description, orderIndex, isEnabled }` *(mặc định `GM`, `OT` theo từng mô-đun; `isEnabled: boolean` mặc định `true` đánh dấu nhóm kiến thức đã sẵn sàng mở cho học sinh làm bài hay đang tạm tắt; cho phép thêm tùy biến)*.
- **`KnowledgePart`**: `{ id, module, level, category, code, title, description, orderIndex, isEnabled }` *(VD: `GM1`, `GM2`, `OT1`, `OT2`, `OT3`...; `isEnabled: boolean` mặc định `true` đánh dấu phần kiến thức đã sẵn sàng mở cho học sinh làm bài hay đang tạm tắt)*.
- **`Question`**: `{ id, module, level, category, contentCode, topicOrder, topic, type, prompt, instruction?, payload, explanation, tips?, createdAt, updatedAt }`
  - `type`: `'single' | 'multiple' | 'true_false' | 'matching' | 'hotspot' | 'matrix_choice'`
  - `topic`: tự động lấy theo `title` của `KnowledgePart` tương ứng (`module`, `category`, `contentCode`) trong CSDL.
  - `instruction`: tự động gán mặc định theo `type` qua `getDefaultInstructionForQuestionType(type)`.
  - `payload`: Union type theo 6 dạng câu hỏi (`options/correctOptionId`, `options/correctOptionIds`, `statements`, `matchingLeft/matchingRight/correctPairs`, `{ templateText, options, slots }` cho `matrix_choice`, hoặc `{ imageUrl?, hotspotType?, hotspotTarget, imageAlt }` cho `hotspot`). Cả 5 dạng không phải Hotspot đều hỗ trợ thêm trường tùy chọn `imageUrl?: string` và `imageAlt?: string` ngay trong `payload` JSONB.
- **`QuestionSet`**: `{ id, title, description, level?, category?, contentCode?, questionIds: string[], createdAt, updatedAt }`

### 3.3. Giao bài tập, Giải lao & Báo cáo
- **`ClassTaskConfig`**: `{ classId, assignmentTitle, teacherName, breakRewardMinutes, updatedAt, tasks: ClassTaskItem[] }`
- **`ClassTaskItem`**: `{ id, classId, orderIndex, title, description, level, category, contentCode, moduleFilter, quizMode: 'practice' | 'exam', questionIds, estimatedMinutes, requiredAttempts, minScore }`
- **`AdminTaskStatRecord`**: `{ id, studentId, studentName, studentCode, schoolId, classId, taskId, taskTitle, score, correctCount, totalCount, durationSeconds, completedAt, attemptNumber, requiredAttempts, minScore, metMinScore }`
- **`StudentBreakState`**: `{ studentId, status: 'locked' | 'active' | 'expired', totalGrantedSeconds, remainingSeconds, unlockedAt?, expiredAt?, updatedAt }`

### 3.4. Thi đấu Realtime
- **`ClassBattleConfig`**: `{ classId, isEnabled, title, questionSetId, questionSetName, teacherName, moduleFilter, questionIds, fastComboWindowSeconds, topRewardCount, breakRewardMinutes, timeLimitSeconds, updatedAt }`
- **`BattleRoomState`**: `{ id, classId, status: 'lobby' | 'playing' | 'finished', questionIds, configSnapshot, startedAt?, endsAt?, finishedAt?, rankedResults?, participants: BattleParticipant[], events: BattleEvent[], createdAt }`
- **`BattleDebuffType`**: `'blur' | 'frost' | 'reverse' | 'shake'`

---

## 4. Danh mục REST API (`server/app.ts` ↔ `api/index.ts` ↔ `src/utils/api.ts`)

> Toàn bộ các route nghiệp vụ bên dưới yêu cầu header `Authorization: Bearer <token>` (trừ `GET /api/health` và `POST /api/auth/login`) và kiểm tra phân quyền trên server qua middleware `requireAuth` / `requireRoles`. Khi triển khai Vercel, `vercel.json` định tuyến mọi `/api/*` vào hàm Serverless `api/index.ts`.

| Nhóm | Method & Route | Quyền tối thiểu | Chức năng |
|---|---|---|---|
| Hệ thống & Chẩn đoán | `GET /api/health`, `POST /api/supabase/test`, `POST /api/supabase/sample`, `POST /api/supabase/seed` | Công khai / `Master` | Kiểm tra biến môi trường (`envConfigured`, `persistence`), kiểm tra lược đồ 17 bảng, đọc thử 8 câu hỏi mẫu, và đồng bộ/nạp dữ liệu mẫu 17 bảng lên Supabase |
| Hệ thống | `GET /api/bootstrap` | `LV1 / LV2 / Master` | Đọc `AdminDatabase` trực tiếp từ 17 bảng Supabase (hoặc fallback Local DB), lọc `teachers` chỉ trả cho `master` và ẩn `password` |
| Xác thực | `POST /api/auth/login`, `POST /api/auth/logout` | Công khai / Đã đăng nhập | Đăng nhập qua `public.admin_teachers` / `auth.signInWithPassword` trên Supabase (fallback Local DB `scrypt`), chặn `locked` (`403`), cấp Bearer token HMAC-SHA256 |
| Phân quyền GV | `POST /api/teachers`, `PUT /api/teachers/:userId`, `DELETE /api/teachers/:userId`, `POST /api/teachers/sync-supabase`, `POST /api/teachers/pull-supabase` | `Master` | CRUD trực tiếp trên `public.admin_teachers` + đồng bộ 2 chiều, chặn tự hạ quyền/tự khóa & bảo vệ Master hoạt động cuối cùng |
| Trường học | `POST /api/schools`, `PUT /api/schools/:id`, `DELETE /api/schools/:id` | `Master` | CRUD trực tiếp trên `schools` (xóa kéo theo lớp, học sinh, bài tập, thi đấu qua FK cascade) |
| Lớp học | `POST /api/classes`, `POST /api/classes/batch`, `PUT /api/classes/:id`, `DELETE /api/classes/:id` | `LV1 / LV2 / Master` | CRUD & nhập hàng loạt lớp học (Excel/CSV, chuẩn hóa khối & bỏ qua trùng tên) trực tiếp trên `classes` liên trường |
| Học sinh & Mật khẩu | `POST /api/students`, `POST /api/students/batch`, `PUT /api/students/:id`, `DELETE /api/students/:id`, `POST /api/students/:id/reset-password`, `POST /api/classes/:id/reset-passwords` | `LV1 / LV2 / Master` | CRUD & nhập Excel/CSV trực tiếp trên `students` (nhập hàng loạt tự đánh `Mã HS` nối tiếp `<TênLớp>-NN` và mặc định `alwaysBreakReady = false`) + reset mật khẩu không dấu 1 HS / cả lớp |
| Ngân hàng 4 tầng & Ảnh | `POST/PUT/DELETE` cho `/api/modules`, `/api/knowledge-categories`, `/api/knowledge-parts` (kèm `POST /api/knowledge-parts/batch-readiness`), `/api/questions`, `/api/questions/reorder`, `/api/questions/batch-delete`, `/api/question-sets`, `/api/storage/hotspot-upload`, `/api/question-bank/import-remote` | `LV2 / Master` | CRUD trực tiếp trên 5 bảng Ngân hàng Câu hỏi + bật/tắt hàng loạt trạng thái sẵn sàng các phần theo nhóm + upload/dọn ảnh `hotspot-images` + nhập hàng loạt (`mode: 'merge' | 'replace'`) *(UI nhập/xuất tạm ẩn qua cờ frontend)* |
| Bài tập & Nộp bài | `PUT /api/class-tasks/:classId`, `POST /api/submissions` | `LV1 / LV2 / Master` | Lưu `class_task_configs` + `class_tasks`; ghi nhận `student_task_submissions` & tự mở khóa `student_break_states` khi đủ 100% |
| Thi đấu | `PUT /api/battle-configs/:classId`, `POST /api/battle-rooms`, `join`, `start`, `simulate-step`, `finish`, `reset` | `LV2 / Master` | Lưu `class_battle_configs` & điều phối `battle_rooms`, `battle_participants`, `battle_events` trực tiếp trên Supabase |

---

## 5. Lược đồ Supabase PostgreSQL (`SUPABASE_SCHEMA_SQL` — 17 bảng)

Kịch bản SQL tại `src/data/seedData.ts` định nghĩa **17 bảng** trong schema `public`:

1. **Tổ chức & Tài khoản (4 bảng):**
   - `schools` → `classes` (`school_id` FK `ON DELETE CASCADE`) → `students` (`class_id` FK `ON DELETE CASCADE`, `UNIQUE(class_id, student_code)`)
   - `admin_teachers` (`user_id text primary key`, `email unique`, `password_hash text`, `role in ('teacher_lv1', 'teacher_lv2', 'master')`, `status in ('active', 'locked')`, không gắn `school_id` cố định)
2. **Ngân hàng Câu hỏi & Bộ đề (5 bảng — Khóa ngoại 4 tầng):**
   - `ic3_modules` (`code UNIQUE`)
   - `knowledge_categories` (`UNIQUE(module, code)`, `is_enabled boolean not null default true`, FK `module` → `ic3_modules(code)` `ON UPDATE CASCADE ON DELETE RESTRICT`)
   - `knowledge_parts` (`UNIQUE(module, category, code)`, `is_enabled boolean not null default true`, composite FK `(module, category)` → `knowledge_categories(module, code)` `ON UPDATE CASCADE ON DELETE RESTRICT`)
   - `questions` (index `idx_questions_part_order(module, category, content_code, topic_order)`, composite FK `(module, category, content_code)` → `knowledge_parts(module, category, code)` `ON UPDATE CASCADE ON DELETE RESTRICT`)
   - `question_sets` (`question_ids text[]`)
3. **Bài tập, Nộp bài & Giải lao (4 bảng):**
   - `class_task_configs` (`class_id PK` → `classes(id) ON DELETE CASCADE`) → `class_tasks` (`class_id` → `class_task_configs(class_id) ON DELETE CASCADE`)
   - `student_task_submissions` (FK tới `schools`, `classes`, `students`, `class_tasks` đều `ON DELETE CASCADE`)
   - `student_break_states` (`student_id PK` → `students(id) ON DELETE CASCADE`)
4. **Thi đấu Realtime (4 bảng):**
   - `class_battle_configs` (`class_id PK` → `classes(id) ON DELETE CASCADE`, `question_set_id` → `question_sets(id) ON DELETE SET NULL`)
   - `battle_rooms` (`class_id` → `classes(id) ON DELETE CASCADE`) → `battle_participants` (`PK(room_id, student_id)`) & `battle_events` (`room_id` FK)
5. **Lưu trữ ảnh Hotspot (Supabase Storage):**
   - Bucket công khai `hotspot-images` trên `storage.buckets` cùng 4 policy RLS trên `storage.objects` (`select`, `insert`, `update`, `delete` cho `anon, authenticated`). Đường dẫn ảnh (`imageUrl`) và tọa độ vùng/điểm đúng (`hotspotTarget`) được lưu trực tiếp trong cột `questions.payload` (`jsonb`).

> **Lưu ý khi nâng cấp DB cũ trên Supabase:** `SUPABASE_SCHEMA_SQL` có sẵn đoạn nâng cấp bảng `admin_teachers` (gỡ FK `admin_teachers_user_id_fkey` để chuyển `user_id` sang `text`, bổ sung `password_hash`, ánh xạ `super_admin` → `master`, `teacher` → `teacher_lv1`, cập nhật `CHECK` constraint sang 3 vai trò mới, `DROP COLUMN IF EXISTS school_id` và bật RLS trên `admin_teachers`), gỡ bỏ các ràng buộc `CHECK` cứng cũ trên `module/level/category`, tự động `DROP COLUMN IF EXISTS difficulty` trên bảng `questions`, **cập nhật ràng buộc `questions_type_check` bổ sung `'matrix_choice'`** (trong khi ảnh minh họa tùy chọn lưu ngay trong `payload` `jsonb` nên không cần thêm cột), **bổ sung cột `is_enabled boolean not null default true` trên cả 2 bảng `knowledge_categories` và `knowledge_parts`**, khởi tạo bucket `hotspot-images` trên Storage, và tự động `INSERT ... ON CONFLICT DO NOTHING` để tạo dữ liệu cha còn thiếu từ `questions`/`knowledge_parts` trước khi gắn 3 ràng buộc khóa ngoại `fk_knowledge_categories_module`, `fk_knowledge_parts_category`, `fk_questions_part`.
