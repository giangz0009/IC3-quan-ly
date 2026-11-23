# Tính năng 08: Kết nối, Đồng bộ & Modal Loading Supabase

**Trạng thái:** Đã hoàn thành (hỗ trợ Modal toàn màn hình & theo dõi tác vụ tập trung)  
**Cập nhật lần cuối:** 2026-11-23

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend (Tab) | `src/components/SupabaseView.tsx` | Form URL/Anon Key, bật/tắt đồng bộ 2 chiều QB, các nút Kiểm tra / Đẩy lên / Kéo QB / Lấy Giáo viên / Đọc thử 8 dòng, khung SQL DDL + bảng trạng thái 15 bảng |
| Frontend (Global Modal) | `src/App.tsx` | Lắng nghe `subscribeSupabaseActivity`, quản lý `syncingStartupSupabase`, render Modal Loading toàn màn hình `z-[100]` (`[data-testid="supabase-loading-modal"]`) |
| Supabase Client | `src/utils/supabaseClient.ts` | Quản lý cấu hình `localStorage`, singleton `createBrowserSupabaseClient`, hệ thống `trackSupabaseCall` / `runTrackedSupabaseActivity` pub/sub, `uploadHotspotImageToSupabase` và toàn bộ hàm gọi Supabase |
| Logic thuần | `src/utils/ic3Rules.ts` | `formatSupabaseLoadingStatus()`, `buildQuestionBankSupabasePayload()`, `buildAdminTeachersSupabasePayload()`, `mergeRemoteTeachersWithLocal()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test định dạng thông báo nhiều tác vụ loading (`formatSupabaseLoadingStatus`), dựng payload đồng bộ QB & Giáo viên |
| SQL DDL | `src/data/seedData.ts` | Hằng số `SUPABASE_SCHEMA_SQL` (17 bảng + FK + Migration nâng cấp + RLS + Storage bucket `hotspot-images`) |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Cấu hình Kết nối (`localStorage`)
- Lưu trực tiếp trên trình duyệt người dùng qua 3 khóa:
  - `ic3_admin_supabase_url`: Project URL.
  - `ic3_admin_supabase_anon_key`: Anon / Public Key (hỗ trợ ẩn/hiện bằng icon mắt).
  - `ic3_admin_supabase_qb_live`: Cờ bật/tắt đồng bộ 2 chiều tự động cho Ngân hàng Câu hỏi (mặc định `true` khi đã cấu hình URL + Key).
- Có nút **Xóa** (`clearSupabaseSettings`) để gỡ sạch cấu hình và kết quả kiểm tra khỏi trình duyệt.

### 2.2. Các Tác vụ Kết nối & Đồng bộ tại `SupabaseView`
1. **Kiểm tra kết nối & Lược đồ (`testSupabaseConnection`):**
   - Đo độ trễ (ms) và thực hiện `SELECT ... { count: 'exact', head: true }` song song trên **15 bảng cốt lõi** (`schools`, `classes`, `students`, `admin_teachers`, `ic3_modules`, `knowledge_categories`, `knowledge_parts`, `questions`, `question_sets`, `class_task_configs`, `class_tasks`, `student_task_submissions`, `student_break_states`, `class_battle_configs`, `battle_rooms`).
   - Hiển thị bảng đối chiếu số dòng **Cục bộ** vs **Trên Supabase** và lỗi chi tiết (nếu thiếu bảng hoặc thiếu quyền RLS).
2. **Đồng bộ Dữ liệu lên Supabase (`syncLocalDatabaseToSupabase` + `api.syncTeachersToSupabase`):**
   - Upsert dữ liệu từ Local DB lên Supabase theo đúng thứ tự phụ thuộc khóa ngoại: `schools` → `classes` → `students` → `ic3_modules` → `knowledge_categories` → `knowledge_parts` → `questions` → `question_sets` → `class_task_configs` → `class_tasks` → `student_break_states` → `class_battle_configs`, đồng thời gọi server đồng bộ bảng `admin_teachers` (bao gồm `password_hash` an toàn).
3. **Lấy Ngân hàng Câu hỏi từ Supabase (`fetchQuestionBankFromSupabase` → `api.importQuestionBankFromRemote`):**
   - Kéo 5 bảng (`ic3_modules`, `knowledge_categories`, `knowledge_parts`, `questions`, `question_sets`) về Local DB.
   - Kiểm tra rõ ràng lỗi truy vấn (thiếu bảng/lỗi RLS) so với trường hợp bảng thực sự trống 0 dòng để thông báo chính xác nguyên nhân cho giáo viên.
4. **Lấy Giáo viên từ Supabase (`api.pullTeachersFromSupabase`):**
   - Kéo danh sách tài khoản giáo viên từ `public.admin_teachers` qua `server.ts` và hợp nhất an toàn vào Local DB mà không làm lộ `password_hash` xuống trình duyệt.
5. **Đọc thử 8 dòng (`fetchSupabaseSampleQuestions`):** Truy vấn trực tiếp 8 dòng từ `knowledge_parts` và 8 dòng từ `questions` để xem trước dữ liệu thực trên Supabase.
6. **Sao chép SQL DDL (`SUPABASE_SCHEMA_SQL`):** Hiển thị và cho phép sao chép toàn bộ kịch bản SQL chuẩn hóa 17 bảng (kèm FK 4 tầng, RLS policy cho `anon, authenticated`, và khởi tạo bucket Supabase Storage `hotspot-images`) để dán vào Supabase SQL Editor.

### 2.3. Hệ thống Modal Loading Toàn màn hình (`App.tsx` + `supabaseClient.ts`)
- Mọi lời gọi API Supabase trong `supabaseClient.ts` đều đi qua hàm bọc tập trung `trackSupabaseCall(label, fn)`:
  - Đẩy tác vụ `{ id, label }` vào `activeSupabaseTasks` trước khi gọi và gỡ bỏ trong khối `finally`, phát sự kiện tới `App.tsx` qua `subscribeSupabaseActivity`.
- **Giao diện Modal toàn màn hình (`[data-testid="supabase-loading-modal"]`):**
  - Tự động bật phủ lên **toàn bộ màn hình chính** (`fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-[2px]`) mỗi khi `activeSupabaseTasks.length > 0` hoặc `syncingStartupSupabase === true`.
  - Thuộc tính accessibility: `role="dialog"`, `aria-modal="true"`, `aria-busy="true"`.
  - Hiển thị spinner xoay, tiêu đề *"Đang chờ phản hồi từ Supabase"*, dòng trạng thái cụ thể của tác vụ hiện tại (hoặc kèm bộ đếm `(N tác vụ đang chờ Supabase...)` qua `formatSupabaseLoadingStatus()`), và lời nhắc không đóng/tải lại trang.
  - Ngăn chặn thao tác trùng lặp ở tầng giao diện (backdrop chặn click nền + trạng thái `disabled` & spinner riêng trên các nút ở `SupabaseView`, `QuestionBankView`, `QuestionEditorModal`).

---

## 3. Quy tắc & Ràng buộc Xử lý

1. **Client Caching:** `createBrowserSupabaseClient` cache instance theo cặp `url::anonKey` để tránh khởi tạo lại client nhiều lần không cần thiết.
2. **Tự bù dữ liệu phân cấp khi Pull:** Khi kéo dữ liệu từ Supabase về, nếu `ic3_modules` hoặc `knowledge_categories` hoặc `knowledge_parts` trên remote còn thiếu so với dữ liệu trong `questions`, `fetchQuestionBankFromSupabase` tự tổng hợp bổ sung các bản ghi cha bị thiếu để UI hiển thị đầy đủ 4 bước.
3. **Khởi động an toàn (`App.tsx`):** Khi bật đồng bộ 2 chiều, lúc mới mở ứng dụng sẽ hiện trạng thái đồng bộ khởi động và Modal loading; nếu Supabase tạm thời lỗi mạng, app tự fallback về dữ liệu cục bộ để không treo màn hình.
4. **Cảnh báo RLS & Anon Key:** Do app chạy trực tiếp `@supabase/supabase-js` từ trình duyệt bằng Anon Key, toàn bộ bảng liên quan phải được bật policy `for all to anon, authenticated using (true) with check (true)` trong SQL DDL.

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Khi nhấn `Xóa` trên Ngân hàng Câu hỏi và đẩy đồng bộ toàn bộ (`syncLocalDatabaseToSupabase`), thao tác `upsert` chỉ thêm/cập nhật chứ không tự xóa các dòng dư bên Supabase (muốn xóa bản ghi trên Supabase cần dùng thao tác xóa live từng câu/bộ đề/phần hoặc xóa hàng loạt).
- Các phân hệ ngoài Ngân hàng Câu hỏi (`schools`, `classes`, `students`, `class_tasks`, `submissions`, `battle_rooms`) chưa có cơ chế kéo từ Supabase về Local DB và chưa đồng bộ live từng thao tác CRUD.
- Nếu dự án triển khai cho nhiều giáo viên thực tế trên môi trường production, cần chuyển sang xác thực Supabase Auth + siết chặt RLS theo `auth.uid()` và bảng `admin_teachers.role` thay vì policy mở toàn quyền cho `anon`.
- Tab **Kết nối Supabase** trên giao diện Admin chỉ hiển thị đối với tài khoản **Giáo viên Master** (`permissions.canManageSupabase`).

---

## 5. Nhật ký thay đổi

- **2026-11-23 (Đồng bộ `admin_teachers`):** Bổ sung `admin_teachers` vào danh sách kiểm tra 15 bảng của `testSupabaseConnection`, đồng bộ `admin_teachers` qua `server.ts` khi bấm *"Đồng bộ Dữ liệu lên Supabase"*, thêm nút *"Lấy Giáo viên từ Supabase"* và xuất `runTrackedSupabaseActivity` để các thao tác đồng bộ giáo viên đi qua server vẫn hiển thị Modal Loading toàn màn hình.
- **2026-11-20 (Bổ sung Supabase Storage cho Hotspot):** Thêm bucket công khai `hotspot-images` cùng policy RLS trên `storage.objects` vào `SUPABASE_SCHEMA_SQL`; hàm `uploadHotspotImageToSupabase` (chỉ gọi khi giáo viên bấm **Lưu Câu hỏi** và form hợp lệ) và `deleteHotspotImagesFromSupabase` (tự động xóa ảnh cũ khỏi bucket khi đổi ảnh hoặc xóa câu hỏi) đều được bọc qua `trackSupabaseCall`.
- **2026-11-20:** Chuyển đổi cơ chế thông báo chờ Supabase sang **Modal toàn màn hình (`z-[100]`)** dùng chung toàn app qua `trackSupabaseCall`, kết hợp khóa nút cục bộ tránh bấm trùng.
- **Trước 2026-11-20:** Hoàn thiện kịch bản SQL 17 bảng kèm FK 4 tầng + RLS, bổ sung nút kiểm tra 14 bảng, đọc thử 8 dòng và phân biệt thông báo lỗi RLS với bảng rỗng.
