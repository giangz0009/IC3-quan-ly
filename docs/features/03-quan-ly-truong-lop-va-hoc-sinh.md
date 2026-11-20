# Tính năng 03: Quản lý Trường học, Lớp học, Học sinh & Phân quyền Giáo viên

**Trạng thái:** Đã hoàn thành  
**Cập nhật lần cuối:** 2026-11-20

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/SchoolsStudentsView.tsx` | Giao diện 12 cột (4 cột Trường/Lớp + 8 cột Học sinh), Modal Thêm Trường/Lớp/Học sinh/CSV, Panel Phân quyền GV |
| Logic thuần | `src/utils/ic3Rules.ts` | `normalizeVietnamesePassword()`, `parseStudentsCsv()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test chuẩn hóa mật khẩu tiếng Việt (`Đỗ Gia Huy` → `dogiahuy`) & phân tích CSV |
| API Client | `src/utils/api.ts` | `createSchool`, `deleteSchool`, `createClass`, `deleteClass`, `createStudent`, `batchImportStudents`, `updateStudent`, `deleteStudent`, `resetStudentPassword`, `resetClassPasswords`, `createTeacher`, `deleteTeacher` |
| Backend | `server.ts` | Các route `/api/schools*`, `/api/classes*`, `/api/students*`, `/api/teachers*` |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Quản lý Phân cấp Trường → Lớp (Cột trái 4/12)
- **Trường học:**
  - Lọc theo `currentTeacher.schoolId` nếu là `teacher`; hiển thị tất cả nếu là `super_admin`.
  - Chỉ `super_admin` có nút **Thêm Trường học** và nút xóa trường.
  - **Xóa trường (Cascade trên `server.ts`):** Tự động xóa toàn bộ lớp thuộc trường, học sinh thuộc các lớp đó, `classTaskConfigs`, `submissions`, `breakStates`, `battleConfigs`, `battleRooms` liên quan và gán `schoolId = null` cho các giáo viên từng thuộc trường đó.
- **Lớp học:**
  - Hiển thị các lớp của trường đang chọn kèm khối lớp và sĩ số.
  - Cho phép **Thêm Lớp học** (Tên lớp + Khối 6/7/8/9) và **Xóa lớp** (xóa kéo theo học sinh và các cấu hình của lớp).

### 2.2. Quản lý Học sinh (Cột phải 8/12)
- Thanh tìm kiếm tức thời theo họ tên hoặc mã học sinh.
- **Thêm 1 học sinh:** Nhập Họ tên, Mã HS (duy nhất trong lớp, tự viết hoa), tùy chọn cờ `alwaysBreakReady` (*tài khoản kiểm thử giải lao*), tự động xem trước mật khẩu mặc định sinh ra.
- **Nhập hàng loạt từ CSV (`Nhập CSV`):**
  - Dán danh sách từ Excel/CSV (hỗ trợ dấu `,`, `;`, hoặc tab `\t`), xem bảng xem trước (Mã HS, Họ tên, Mật khẩu mặc định) trước khi bấm nhập.
  - Server bỏ qua các mã học sinh đã tồn tại trong lớp và trả về `{ created, skipped }`.
- **Quản lý mật khẩu:**
  - Hiển thị rõ học sinh đang dùng mật khẩu mặc định hay `Đã tự đổi (...)`.
  - Hỗ trợ **Reset MK** cho từng học sinh hoặc **Reset mật khẩu cả lớp** (đặt `passwordHash = normalizeVietnamesePassword(fullName)` và `isCustomPassword = false`).
- **Cờ `alwaysBreakReady`:** Cho phép bật/tắt nhanh ngay trên từng dòng (`Luôn mở khóa` ↔ `Theo nhiệm vụ`) để phục vụ kiểm thử khu vực giải lao.

### 2.3. Panel Phân quyền Giáo viên (`super_admin`)
- Bật/tắt từ thanh công cụ (*"Phân quyền Giáo viên (N)"*).
- Cho phép cấp tài khoản mới với vai trò `Super Admin (Toàn bộ)` hoặc `Giáo viên · <Tên trường>`, và xóa tài khoản khác.

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

- Chưa có nút **Sửa thông tin Trường / Lớp / Học sinh** trên UI dù `server.ts` và `api.ts` đã có sẵn `PUT /api/schools/:id`, `PUT /api/classes/:id`, `PUT /api/students/:id` (mới dùng `updateStudent` cho cờ `alwaysBreakReady`).
- Các thao tác Thêm/Xóa Trường, Lớp, Học sinh hiện chỉ ghi vào Local DB (`server.ts`) và **chưa đồng bộ tự động ngay lên Supabase**; cần bấm nút *"Đồng bộ Dữ liệu lên Supabase"* ở tab **Kết nối Supabase** để đẩy lên.

---

## 5. Nhật ký thay đổi

- **2026-11-20:** Tài liệu hóa đầy đủ tính năng Quản lý Trường, Lớp, Học sinh, CSV và Phân quyền GV.
