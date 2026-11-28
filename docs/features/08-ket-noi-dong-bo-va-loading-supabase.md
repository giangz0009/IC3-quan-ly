# Tính năng 08: Kết nối, Chẩn đoán, Nạp mẫu & Modal Loading Supabase

**Trạng thái:** Đã hoàn thành (Serverless 17-bảng trực tiếp + Modal Loading toàn màn hình, chỉ Master)  
**Cập nhật lần cuối:** 2026-11-24

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend (Tab) | `src/components/SupabaseView.tsx` | Form cấu hình URL/Anon Key (tùy chọn bổ sung ngoài biến môi trường Vercel), hiển thị trạng thái kết nối backend (`/api/health`), bảng kiểm tra lược đồ 15/17 bảng (`TableSkeletonRows` khi `testing`/`loading`) & đọc thử 8 dòng (`ListSkeleton` khi `sampling`), SQL DDL |
| Frontend (Global Modal) | `src/App.tsx` | Lắng nghe `subscribeSupabaseActivity`, quản lý `syncingStartupSupabase`, render Modal Loading toàn màn hình `z-[100]` (`[data-testid="supabase-loading-modal"]`) |
| Backend Store | `server/supabaseStore.ts` & `src/utils/supabaseMappers.ts` | Đọc/ghi trực tiếp toàn bộ 17 bảng Supabase, kiểm tra lược đồ, đọc thử 8 câu, nạp toàn bộ database lên Supabase theo thứ tự khóa ngoại chuẩn UUID |
| Supabase Client | `src/utils/supabaseClient.ts` | Quản lý cấu hình `localStorage` (header `X-Supabase-*`), pub/sub `trackSupabaseCall` / `runTrackedSupabaseActivity`, và hàm pull dự phòng khi server chạy Local DB |
| Logic thuần | `src/utils/ic3Rules.ts` | `formatSupabaseLoadingStatus()`, `buildQuestionBankSupabasePayload()`, `buildAdminTeachersSupabasePayload()`, `mergeRemoteTeachersWithLocal()` |
| SQL DDL | `src/data/seedData.ts` | Hằng số `SUPABASE_SCHEMA_SQL` (17 bảng + FK + Migration nâng cấp + RLS + Storage bucket `hotspot-images`) |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Cơ chế Kết nối 2 lớp (Vercel Env + Trình duyệt)
- **Mặc định ở Production / Vercel:** Backend đọc trực tiếp biến môi trường `SUPABASE_URL` và `SUPABASE_ANON_KEY`; toàn bộ mọi tab trong ứng dụng đều đọc/ghi trực tiếp lên Supabase ngay cả khi trình duyệt chưa nhập gì ở `SupabaseView`.
- **Cấu hình bổ sung trên trình duyệt (`localStorage`):** `SupabaseView` vẫn cho phép Giáo viên Master lưu/xóa `ic3_admin_supabase_url` & `ic3_admin_supabase_anon_key` để truyền qua header `X-Supabase-Url` / `X-Supabase-Anon-Key` khi kiểm thử dự án Supabase khác.
- *Lưu ý:* Các component đồng bộ Supabase thủ công bên trong **Ngân hàng Câu hỏi** đã được gỡ bỏ vì đồng bộ Supabase là hành vi mặc định ở tầng server.

### 2.2. Các Tác vụ Quản trị & Chẩn đoán tại `SupabaseView` (Chỉ dành cho Master)
1. **Kiểm tra kết nối & Lược đồ (`POST /api/supabase/test`):**
   - Đo độ trễ (ms) và kiểm tra song song 15 bảng cốt lõi (`schools`, `classes`, `students`, `admin_teachers`, `ic3_modules`, `knowledge_categories`, `knowledge_parts`, `questions`, `question_sets`, `class_task_configs`, `class_tasks`, `student_task_submissions`, `student_break_states`, `class_battle_configs`, `battle_rooms`), đối chiếu số dòng thực tế giữa hệ thống và Supabase.
2. **Đồng bộ / Nạp dữ liệu mẫu 17 bảng lên Supabase (`POST /api/supabase/seed`):**
   - Chạy qua `seedDatabaseToSupabase()` trong `server/supabaseStore.ts`, upsert theo đúng thứ tự phụ thuộc khóa ngoại và dùng UUID chuẩn RFC4122 cho toàn bộ 17 bảng (hỗ trợ cả chế độ đẩy dữ liệu hiện tại hoặc nạp lại bộ dữ liệu mẫu chuẩn `useSeedSample: true`).
3. **Làm mới Ngân hàng Câu hỏi / Lấy Giáo viên từ Supabase:**
   - Khi server đang bật env Supabase, bấm làm mới sẽ gọi trực tiếp `GET /api/bootstrap` để lấy dữ liệu mới nhất từ PostgreSQL; hoặc dùng `POST /api/teachers/pull-supabase` để đối chiếu danh sách `public.admin_teachers`.
4. **Đọc thử 8 dòng (`POST /api/supabase/sample`):** Truy vấn trực tiếp 8 dòng từ `knowledge_parts` và 8 dòng từ `questions` để xem trước dữ liệu thực trên Supabase.
5. **Sao chép SQL DDL (`SUPABASE_SCHEMA_SQL`):** Hiển thị và cho phép sao chép toàn bộ kịch bản SQL chuẩn hóa 17 bảng (kèm FK 4 tầng, migration nâng cấp `admin_teachers`, RLS policy cho `anon, authenticated`, và khởi tạo bucket Storage `hotspot-images`).

### 2.3. Hệ thống Modal Loading Toàn màn hình (`App.tsx` + `supabaseClient.ts`)
- Mọi lời gọi đồng bộ/chẩn đoán bọc qua `trackSupabaseCall` hoặc `runTrackedSupabaseActivity` đều đẩy tác vụ vào hàng đợi `activeSupabaseTasks` và phát sự kiện tới `App.tsx`.
- Khi `activeSupabaseTasks.length > 0` hoặc `syncingStartupSupabase === true`, hiển thị Modal toàn màn hình (`[data-testid="supabase-loading-modal"]`, `fixed inset-0 z-[100]`, `role="dialog"`, `aria-modal="true"`, `aria-busy="true"`) để tránh thao tác trùng lặp.

---

## 3. Quy tắc & Ràng buộc Xử lý

1. **Giới hạn quyền truy cập:** Tab **Kết nối Supabase** chỉ hiển thị đối với **Giáo viên Master** (`permissions.canManageSupabase`), và toàn bộ route `/api/supabase/*` trên server khóa bởi `requireRoles('master')`.
2. **Khởi động an toàn (`App.tsx`):** Chỉ khi server chạy ở chế độ Local DB (`!health.supabaseConfigured`) và trình duyệt có bật cấu hình Supabase cục bộ, ứng dụng mới thực hiện pull dự phòng lúc khởi động; khi server đã cấu hình env Supabase, `/api/bootstrap` tải thẳng dữ liệu từ 17 bảng PostgreSQL.
3. **Cảnh báo bảo mật Production:** Chính sách RLS mặc định trong `SUPABASE_SCHEMA_SQL` mở cho `anon, authenticated` để tiện kết nối nhanh bằng Anon Key; trong môi trường production thực tế nên kết hợp `SUPABASE_SERVICE_ROLE_KEY` ở server (không đưa xuống client) hoặc siết policy RLS theo `auth.uid()`.

---

## 4. Nhật ký thay đổi

- **2026-11-24 (Skeleton loading):** Bổ sung `TableSkeletonRows` (5 cột) khi `testing` / `loading` ở bảng kiểm tra lược đồ và `ListSkeleton` khi `sampling` ở khung đọc thử dữ liệu trực tiếp từ Supabase.
- **2026-11-24 (Đồng bộ mặc định ở Server & Gỡ UI đồng bộ ở Ngân hàng Câu hỏi):** Toàn bộ 17 bảng đã đọc/ghi trực tiếp qua `server/supabaseStore.ts`; bỏ các component đồng bộ thủ công trong `QuestionBankView.tsx`, giữ `SupabaseView.tsx` làm trung tâm cấu hình, chẩn đoán lược đồ và nạp mẫu dành cho Master.
- **2026-11-23 (Chuyển chẩn đoán & Seed 17 bảng lên Backend):** Chuyển `testSupabase`, `sample` và `seed` sang `/api/supabase/*` trên `server/app.ts` + `server/supabaseStore.ts` để hoạt động trực tiếp với biến môi trường Vercel.
- **2026-11-23 (Đồng bộ `admin_teachers`):** Bổ sung kiểm tra & đồng bộ an toàn bảng `admin_teachers` có `password_hash`.
- **2026-11-20:** Thêm bucket `hotspot-images` vào SQL DDL và nâng cấp thông báo chờ sang Modal toàn màn hình `z-[100]`.
