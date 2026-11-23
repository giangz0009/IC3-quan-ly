# Tính năng 03: Quản lý Trường học, Lớp học, Học sinh & Phân quyền Giáo viên

**Trạng thái:** Đã hoàn thành  
**Cập nhật lần cuối:** 2026-11-23

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/SchoolsStudentsView.tsx` | Giao diện 12 cột (4 cột Trường/Lớp + 8 cột Học sinh), Modal Thêm/Sửa Trường/Lớp/Học sinh, nhập CSV, Reset MK và nút chuyển nhanh sang tab Quản lý Giáo viên (cho Master) |
| Frontend | `src/components/TeacherManagementView.tsx` | Tab Quản lý Giáo viên riêng cho `master` (tìm kiếm, lọc 3 cấp quyền, Modal Cấp/Sửa tài khoản, Confirm Modal Xóa, nút icon Chi tiết quyền, đồng bộ 2 chiều với Supabase `public.admin_teachers`) |
| Logic thuần | `src/utils/ic3Rules.ts` | `normalizeVietnamesePassword()`, `parseStudentsCsv()`, `getTeacherPermissions()`, `getTeacherPermissionDetails()`, `canDeleteOrDemoteMaster()`, `filterTeachers()`, `summarizeTeachersByRole()`, `summarizeTeacherStatuses()`, `buildAdminTeachersSupabasePayload()`, `mergeRemoteTeachersWithLocal()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test chuẩn hóa mật khẩu tiếng Việt (`Đỗ Gia Huy` → `dogiahuy`), phân tích CSV, phân quyền 3 cấp & đồng bộ `admin_teachers` |
| API Client | `src/utils/api.ts` | `createSchool`, `updateSchool`, `deleteSchool`, `createClass`, `updateClass`, `deleteClass`, `createStudent`, `batchImportStudents`, `updateStudent`, `deleteStudent`, `resetStudentPassword`, `resetClassPasswords`, `createTeacher`, `updateTeacher`, `deleteTeacher`, `syncTeachersToSupabase`, `pullTeachersFromSupabase` |
| Backend | `server.ts` | Các route `/api/schools*` (`master`), `/api/classes*`, `/api/students*` (mọi GV), `/api/teachers*` (`master`, kèm đồng bộ `public.admin_teachers`) |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Quản lý Phân cấp Trường → Lớp (Cột trái 4/12)
- **Trường học:**
  - **Mọi tài khoản giáo viên (LV1, LV2, Master)** đều nhìn thấy và chuyển đổi trực tiếp giữa **tất cả các trường** hiện có trong hệ thống để quản lý lớp học và học sinh.
  - Chỉ **Giáo viên Master** (`permissions.canManageSchools`) mới có nút **Thêm Trường học**, nút **Sửa** và nút xóa trường (thêm/sửa thực hiện qua Modal Box).
  - **Xóa trường (Cascade trên `server.ts`):** Tự động xóa toàn bộ lớp thuộc trường, học sinh thuộc các lớp đó, `classTaskConfigs`, `submissions`, `breakStates`, `battleConfigs`, `battleRooms` liên quan.
- **Lớp học:**
  - Hiển thị các lớp của trường đang chọn kèm khối lớp và sĩ số.
  - Cho phép cả 3 cấp giáo viên **Thêm / Sửa Lớp học** qua Modal Box (Tên lớp + Khối 6/7/8/9) và **Xóa lớp** (xóa kéo theo học sinh và các cấu hình của lớp).

### 2.2. Quản lý Học sinh (Cột phải 8/12)
- Thanh tìm kiếm tức thời theo họ tên hoặc mã học sinh.
- **Thêm / Sửa 1 học sinh (qua Modal Box):** Nhập hoặc cập nhật Họ tên, Mã HS (duy nhất trong lớp, tự viết hoa) và cờ `alwaysBreakReady` (*tài khoản kiểm thử giải lao*); khi thêm mới tự động xem trước mật khẩu mặc định sinh ra.
- **Nhập hàng loạt từ CSV (`Nhập CSV`):**
  - Dán danh sách từ Excel/CSV (hỗ trợ dấu `,`, `;`, hoặc tab `\t`), xem bảng xem trước (Mã HS, Họ tên, Mật khẩu mặc định) trước khi bấm nhập.
  - Server bỏ qua các mã học sinh đã tồn tại trong lớp và trả về `{ created, skipped }`.
- **Quản lý mật khẩu:**
  - Hiển thị rõ học sinh đang dùng mật khẩu mặc định hay `Đã tự đổi (...)`.
  - Hỗ trợ **Reset MK** cho từng học sinh hoặc **Reset mật khẩu cả lớp** (đặt `passwordHash = normalizeVietnamesePassword(fullName)` và `isCustomPassword = false`).
- **Cờ `alwaysBreakReady`:** Cho phép bật/tắt nhanh ngay trên từng dòng (`Luôn mở khóa` ↔ `Theo nhiệm vụ`) để phục vụ kiểm thử khu vực giải lao.

### 2.3. Tab Quản lý Giáo viên (`TeacherManagementView.tsx` — Chỉ dành cho `Giáo viên Master`)
- Truy cập trực tiếp từ mục **Quản lý Giáo viên** trên thanh điều hướng chính hoặc bấm nút *"Quản lý Giáo viên (N)"* trên thanh công cụ tab **Trường & Học sinh** khi đăng nhập bằng tài khoản `master`.
- Tập trung hoàn toàn vào quản trị tài khoản giáo viên (không còn giao diện điều phối trường học cũ):
  - **Khu vực Quản lý Tài khoản & Phân quyền Giáo viên (phía trên):** Hiển thị tổng hợp số lượng tài khoản theo trạng thái (*Tổng số*, *Hoạt động*, *Tạm khóa*) và lưới tóm tắt 3 nhóm quyền (*GV Giảng dạy LV1*, *GV Chuyên môn LV2*, *Giáo viên Master*). Cạnh tên mỗi nhóm quyền có nút **chỉ hiển thị icon (`Eye`)** (hiện tooltip *"Xem chi tiết quyền cụ thể"* khi hover) để mở Modal Box liệt kê đầy đủ 7 quyền cụ thể của nhóm quyền đó (*Được phép* / *Không được phép* kèm giải thích).
  - **Bảng Danh sách Giáo viên (phía dưới):**
    - Thanh tiêu đề bảng hiển thị sĩ số lọc hiện tại và nút **Cấp tài khoản** để mở Modal Box cấp tài khoản giáo viên mới.
    - **Tìm kiếm & lọc đa chiều:** Tìm tức thời theo họ tên/email, lọc theo nhóm quyền và lọc theo trạng thái tài khoản (`Tất cả trạng thái`, `Đang hoạt động`, `Tạm khóa`).
    - **Cột Vai trò (Quyền) chỉ đọc:** Không cho phép đổi vai trò trực tiếp trên bảng; mọi chỉnh sửa vai trò/quyền phải thực hiện thông qua nút **Sửa** → Modal Box *Chỉnh sửa Tài khoản Giáo viên*.
    - **Cột Trạng thái tài khoản dạng Icon:** Hiển thị biểu tượng trực quan tiết kiệm không gian (`CheckCircle2` xanh ngọc = *Đang hoạt động*, `Lock` đỏ = *Tạm khóa*), kèm thao tác **Khóa / Mở khóa** nhanh trên từng dòng.
    - **Sửa (Modal) / Xóa (Confirm Modal) & Đồng bộ Supabase:** Bấm **Sửa** mở Modal Box chỉnh sửa Họ tên, Email, Mật khẩu mới, Vai trò và Trạng thái; bấm **Xóa** mở Confirm Modal Box xác nhận trước khi xóa vĩnh viễn. Tự động bảo vệ tài khoản đang đăng nhập và tài khoản `master` đang hoạt động cuối cùng (*Được bảo vệ*). Khi đã kết nối Supabase, mọi thao tác thêm/sửa/khóa/xóa tự động đồng bộ lên `public.admin_teachers`, kèm nút **Đẩy lên Supabase** và **Kéo từ Supabase** ngay trên thanh tiêu đề bảng.

---

## 3. Quy tắc & Ràng buộc Xử lý

1. **Chuẩn hóa mật khẩu mặc định (`normalizeVietnamesePassword`):**
   - Chuyển `đ/Đ` → `d/D`, tách dấu Unicode (`NFD`) và xóa ký tự dấu, viết thường toàn bộ, loại bỏ mọi ký tự ngoài `[a-z0-9]` (kể cả khoảng trắng).
   - Ví dụ: `"Đỗ Gia Huy"` → `"dogiahuy"`.
2. **Phân tích CSV (`parseStudentsCsv`):**
   - Tự bỏ qua dòng tiêu đề nếu chứa `"họ"`, `"full_name"`, `"name"`, `"mã"`.
   - Hỗ trợ cả 2 thứ tự cột `"Mã HS, Họ tên"` và `"Họ tên, Mã HS"`. Nếu chỉ có 1 cột Họ tên, tự sinh mã `<TênLớp>001`, `<TênLớp>002`...
3. **Tính duy nhất Mã HS:** Server kiểm tra trùng `studentCode` (không phân biệt hoa/thường) trong phạm vi cùng lớp (`409 Conflict` khi thêm lẻ, đưa vào `skipped` khi nhập CSV).

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Các thao tác Thêm/Sửa/Xóa Trường, Lớp, Học sinh hiện chỉ ghi vào Local DB (`server.ts`) và **chưa đồng bộ tự động ngay lên Supabase**; cần bấm nút *"Đồng bộ Dữ liệu lên Supabase"* ở tab **Kết nối Supabase** để đẩy lên (riêng danh sách Giáo viên đã hỗ trợ đồng bộ 2 chiều và đồng bộ live).

---

## 5. Nhật ký thay đổi

- **2026-11-23 (Đồng bộ Supabase cho Quản lý Giáo viên):** Bổ sung đồng bộ live khi thêm/sửa/khóa/xóa giáo viên và hai nút **Kéo từ Supabase** / **Đẩy lên Supabase** trong `TeacherManagementView.tsx` (đi qua `server.ts` để bảo vệ `password_hash`).
- **2026-11-21 (Bố cục mới tab Quản lý Giáo viên):** Chuyển nút **Cấp tài khoản** xuống phần đầu bảng *Danh sách Giáo viên*; vô hiệu hóa thao tác đổi vai trò trực tiếp trên bảng (chỉ cho đổi vai trò trong Modal **Sửa**); chuyển nút icon **Chi tiết quyền (`Eye`)** lên phần *Quản lý Tài khoản & Phân quyền Giáo viên* phía trên gắn theo từng nhóm quyền.
- **2026-11-21 (Chuẩn hóa Modal Box & Nút Icon Chi tiết quyền):** Chuyển nút *Chi tiết quyền* tại bảng Giáo viên sang dạng chỉ hiển thị icon (`Eye`) kèm mô tả khi hover; chuyển form **Cấp Tài khoản Giáo viên mới** vào Modal Box; bổ sung Modal Box **Sửa Trường học / Sửa Lớp học / Sửa Học sinh** trong `SchoolsStudentsView.tsx`.
- **2026-11-21 (cập nhật Modal & Icon trạng thái):** Cập nhật cột *Trạng thái tài khoản* sang dạng icon, bỏ cột văn bản *Quyền thao tác* để thay bằng nút mở Modal Box chi tiết quyền, dùng Modal Box riêng khi bấm **Sửa** và Confirm Modal Box khi bấm **Xóa**.
- **2026-11-21 (cập nhật):** Loại bỏ cột và văn bản điều phối trường học khỏi `TeacherManagementView.tsx`, bổ sung đổi vai trò trực tiếp ngay trên bảng và hiển thị/bật tắt trạng thái tài khoản (`Đang hoạt động` / `Tạm khóa`).
- **2026-11-21 (bổ sung):** Chuyển phần quản lý giáo viên ra tab riêng `TeacherManagementView.tsx` cho Master với tìm kiếm và lọc theo 3 nhóm quyền, tiếp tục đảm bảo không có logic gán/điều phối trường cho từng giáo viên.
- **2026-11-21:** Bỏ ràng buộc giáo viên gắn cố định một trường; mở quyền xem & quản lý lớp/học sinh trên tất cả các trường cho mọi giáo viên; nâng cấp Panel Phân quyền Giáo viên thành 3 cấp liên trường hỗ trợ thêm/sửa vai trò & mật khẩu/xóa an toàn.
- **2026-11-20:** Tài liệu hóa đầy đủ tính năng Quản lý Trường, Lớp, Học sinh, CSV và Phân quyền GV.
