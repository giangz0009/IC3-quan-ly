# Tính năng 01: Xác thực & Phân quyền Giáo viên (3 cấp liên trường)

**Trạng thái:** Đã hoàn thành (cục bộ + xác thực Bearer Token & `scrypt` trên server)  
**Cập nhật lần cuối:** 2026-11-21

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Kiểu dữ liệu | `src/types/ic3.ts` | `AdminRole = 'teacher_lv1' | 'teacher_lv2' | 'master'`, `TeacherAccountStatus = 'active' | 'locked'`, `AdminTeacher`, `SafeTeacher` |
| Logic thuần | `src/utils/ic3Rules.ts` | `ADMIN_ROLE_PERMISSIONS`, `ADMIN_ROLE_LIST`, `normalizeAdminRole()`, `normalizeTeacherStatus()`, `getTeacherPermissions()`, `getTeacherPermissionDetails()`, `canDeleteOrDemoteMaster()`, `filterTeachers()`, `summarizeTeachersByRole()`, `summarizeTeacherStatuses()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test ma trận quyền 3 cấp, bảng chi tiết 7 quyền, trạng thái tài khoản, lọc/đếm giáo viên & chặn xóa/hạ quyền/khóa Master hoạt động cuối cùng |
| Frontend | `src/components/AuthScreen.tsx` | Form đăng nhập, 3 nút truy cập nhanh theo từng cấp quyền, nút đổi giao diện Sáng/Tối |
| Frontend | `src/App.tsx` | Giữ phiên trong bộ nhớ JS (`memoryAuthToken`), ẩn tab theo quyền (`teachers`, `battle`, `supabase`), hỗ trợ `?autostart=1` |
| Frontend | `src/components/TeacherManagementView.tsx` | Tab *"Quản lý Giáo viên"* dành riêng cho `master`: cột trạng thái dạng icon gọn, nút **Chi tiết quyền** mở Modal mô tả 7 quyền cụ thể, Modal **Sửa** tài khoản, Confirm Modal **Xóa** và đổi vai trò trực tiếp trên bảng |
| API Client | `src/utils/api.ts` | `setAuthToken()`, gắn header `Authorization: Bearer <token>`, xử lý 401 tự đăng xuất, `login()`, `logout()`, `createTeacher()`, `updateTeacher()`, `deleteTeacher()` |
| Backend | `server.ts` | `hashTeacherPassword()`, `verifyTeacherPassword()`, `signSessionToken()`, `verifySessionToken()`, `requireAuth`, `requireRoles()`, `POST /api/auth/login`, `POST /api/auth/logout`, `/api/teachers*` |
| Dữ liệu | `src/data/seedData.ts` | 3 tài khoản giáo viên mẫu (`status: 'active'`, không gắn `schoolId`) + bảng `public.admin_teachers` trong SQL DDL |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Đăng nhập (`AuthScreen.tsx`) & Quản lý Phiên
- Phiên đăng nhập giữ an toàn bằng **Bearer Token ký HMAC-SHA256** trong bộ nhớ JS (`memoryAuthToken` tại `src/utils/api.ts`) — không lưu thông tin tài khoản vào `sessionStorage` hay `localStorage`.
- Hỗ trợ **3 nút Truy cập nhanh tài khoản mẫu** đại diện cho 3 cấp quyền liên trường:
  - **Giáo viên Master:** `admin@ic3master.edu.vn` / `admin123` (`role: 'master'`).
  - **GV Chuyên môn (LV2):** `chuyenmon.lv2@ic3master.edu.vn` / `teacher123` (`role: 'teacher_lv2'`).
  - **GV Giảng dạy (LV1):** `giangday.lv1@ic3master.edu.vn` / `teacher123` (`role: 'teacher_lv1'`).
- Hỗ trợ tham số URL `?autostart=1` (`App.tsx`) để tự động đăng nhập tài khoản Master khi kiểm thử tự động.
- Khi bấm **Đăng xuất**, gọi `POST /api/auth/logout` để thu hồi token trên server và xóa token khỏi bộ nhớ trình duyệt.

### 2.2. Mô hình 3 Nhóm Quyền Liên trường (Quản lý tất cả các trường trong hệ thống)

Mọi tài khoản giáo viên đều **không bị khóa vào một trường cố định** (`schoolId` đã được loại bỏ). Tất cả 3 cấp đều quản lý lớp học, học sinh, bài tập và báo cáo trên **toàn bộ các trường có trong dữ liệu hệ thống**, chỉ khác nhau về quyền can thiệp hệ thống:

| Nhóm quyền | Mã `role` | Phạm vi Trường/Lớp/HS | Ngân hàng Câu hỏi & Bộ đề | Giao Bài tập Lớp | Thi đấu Realtime | Trường học, Phân quyền GV & Supabase |
|---|---|---|---|---|---|---|
| **Giáo viên Giảng dạy (LV1)** | `teacher_lv1` | Toàn bộ các trường (xem trường, quản lý lớp/HS, nhập CSV, reset MK) | **Chỉ xem** (duyệt 4 tầng, xem câu hỏi, Hotspot & bộ đề; không thêm/sửa/xóa/đảo thứ tự/đồng bộ) | Có | **Không** (ẩn tab & chặn API `403`) | Không (ẩn thêm/xóa trường, ẩn Phân quyền GV & tab Supabase) |
| **Giáo viên Chuyên môn (LV2)** | `teacher_lv2` | Toàn bộ các trường | **Toàn quyền** (thêm/sửa/xóa/sắp xếp 4 tầng + Bộ đề + đồng bộ QB lên/từ Supabase) | Có | **Có** (cấu hình luật & điều phối phòng đấu) | Không (ẩn thêm/xóa trường, ẩn Phân quyền GV & tab Supabase) |
| **Giáo viên Master** | `master` | **Không giới hạn** | **Toàn quyền** | Có | **Có** | **Toàn quyền** (thêm/xóa trường, CRUD phân quyền GV, cấu hình/SQL Supabase) |

---

## 3. Quy tắc & Ràng buộc Xử lý (Frontend & Backend)

1. **Xác thực & Bảo mật Mật khẩu:**
   - Mật khẩu giáo viên lưu trong `data/ic3_admin_db.json` được băm bằng `crypto.scryptSync` ngẫu nhiên 16-byte salt (`scrypt$<salt>$<hash>`) và đối chiếu qua `crypto.timingSafeEqual`.
   - Khi khởi động (`ensureDb()`), `server.ts` tự động migrate dữ liệu cũ (`super_admin` → `master`, `teacher` → `teacher_lv1`), loại bỏ `schoolId`, băm toàn bộ mật khẩu plaintext còn sót, và bổ sung tài khoản mẫu LV2 nếu DB cũ chưa có.
2. **Kiểm tra quyền trên Backend (`requireAuth` + `requireRoles`):**
   - Tất cả endpoint `/api/*` (trừ `/api/health` và `/api/auth/login`) bắt buộc phải có `Authorization: Bearer <token>` hợp lệ (nếu sai/hết hạn/thu hồi trả `401`).
   - `GET /api/bootstrap`: chỉ trả danh sách `teachers` (đã lược bỏ `password`) cho `master`; trả `teachers: []` với LV1/LV2.
   - Nhóm `/api/modules*`, `/api/knowledge-categories*`, `/api/knowledge-parts*`, `/api/questions*`, `/api/question-sets*`, `/api/question-bank/import-remote`, `/api/battle-configs/*`, `/api/battle-rooms*`: chỉ cho phép `teacher_lv2` và `master` (`403 Forbidden` nếu là `teacher_lv1`).
   - Nhóm `/api/schools*` và `/api/teachers*`: chỉ cho phép `master` (`403 Forbidden` nếu là `teacher_lv1` hoặc `teacher_lv2`).
3. **Bảo vệ & Trạng thái Tài khoản (`active` / `locked`):**
   - Tài khoản có trạng thái `locked` bị chặn đăng nhập (`403`) và tự vô hiệu hóa phiên truy cập API (`401`).
   - Không cho phép xóa, hạ cấp hoặc tạm khóa tài khoản `master` đang hoạt động duy nhất còn lại (`canDeleteOrDemoteMaster()`).
   - Không cho phép tài khoản `master` tự xóa, tự hạ cấp hoặc tự tạm khóa chính mình khi đang đăng nhập.

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Bảng `public.admin_teachers` trên Supabase đã được cập nhật DDL (3 vai trò mới, bỏ `school_id`), nhưng xác thực hiện tại chạy qua Express API cục bộ (`server.ts`); chưa đồng bộ mật khẩu/session trực tiếp với Supabase Auth (`auth.users`).

---

## 5. Nhật ký thay đổi

- **2026-11-21 (cập nhật Modal & Icon trạng thái):** Nâng cấp `TeacherManagementView.tsx`: hiển thị cột *Trạng thái tài khoản* dạng icon gọn, bỏ cột văn bản *Quyền thao tác* thay bằng nút **Chi tiết quyền** mở Modal Box mô tả đầy đủ 7 quyền cụ thể của từng giáo viên, mở Modal Box riêng khi bấm **Sửa** và mở Confirm Modal Box xác nhận khi bấm **Xóa**.
- **2026-11-21 (cập nhật giao diện & trạng thái):** Cập nhật `TeacherManagementView.tsx` loại bỏ hoàn toàn phần hiển thị/điều phối trường học cũ, bổ sung chỉnh sửa vai trò trực tiếp trên từng dòng danh sách, thêm trạng thái tài khoản (`active` / `locked`), bộ lọc trạng thái và kiểm tra chặn đăng nhập/khóa tài khoản Master cuối cùng trên server.
- **2026-11-21 (bổ sung):** Tách màn hình quản lý & phân quyền giáo viên thành tab riêng `TeacherManagementView.tsx` (chỉ hiển thị với `master`), bổ sung tìm kiếm và bộ lọc theo 3 cấp quyền, giữ nguyên nguyên tắc mọi giáo viên tự do truy cập toàn bộ trường học mà không cần điều phối/gán trường.
- **2026-11-21:** Thiết kế lại hoàn toàn hệ thống phân quyền theo mô hình liên trường 3 cấp (**Giáo viên Giảng dạy - LV1**, **Giáo viên Chuyên môn - LV2**, **Giáo viên Master**); loại bỏ `schoolId` cố định của giáo viên; bổ sung băm mật khẩu `scrypt`, Bearer Token HMAC-SHA256 trong bộ nhớ JS, route guard trên toàn bộ REST API, API `PUT /api/teachers/:userId` sửa vai trò/mật khẩu, và chế độ Chỉ xem cho LV1 ở Ngân hàng Câu hỏi.
- **2026-11-20:** Rà soát và tài liệu hóa đầy đủ luồng đăng nhập, `?autostart=1` và phạm vi phân quyền cũ.
