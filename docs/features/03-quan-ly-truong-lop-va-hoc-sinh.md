# Tính năng 03: Quản lý Trường học, Lớp học, Học sinh & Phân quyền Giáo viên

**Trạng thái:** Đã hoàn thành  
**Cập nhật lần cuối:** 2026-11-24

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/SchoolsStudentsView.tsx` | Giao diện phân cấp 3 bước (Trường học → Lớp học → Học sinh) kèm Breadcrumb + Quay lại, skeleton loading (`CardGridSkeleton` / `TableSkeletonRows`), Modal Thêm/Sửa Trường/Lớp/Học sinh, Modal Nhập/Xuất Excel & CSV Lớp học (Bước 2) và Học sinh (Bước 3), Confirm Modal Xóa & Reset mật khẩu cả lớp |
| Frontend | `src/components/TeacherManagementView.tsx` | Tab Quản lý Giáo viên riêng cho `master` (tìm kiếm, lọc 3 cấp quyền, skeleton loading bảng giáo viên, Modal Cấp/Sửa tài khoản, Confirm Modal Xóa, nút icon Chi tiết quyền, đồng bộ 2 chiều với Supabase `public.admin_teachers`) |
| Logic thuần | `src/utils/ic3Rules.ts` & `src/utils/ic3Excel.ts` | `normalizeVietnamesePassword()`, `generateNextStudentCode()`, `normalizeSchoolClassGrade()`, `parseClassesCsv()`, `parseClassesTabularRows()`, `formatClassesToCsv()`, `parseStudentsCsv()`, `parseStudentsTabularRows()`, `formatStudentsToCsv()`, `readTabularExcelWorkbookBuffer()`, `buildClassesExcelBuffer()`, `buildClassesSampleExcelBuffer()`, `parseClassesExcelSheet()`, `buildStudentsExcelBuffer()`, `buildStudentsSampleExcelBuffer()`, `parseStudentsExcelSheet()`, cùng các hàm lọc/tổng hợp phân cấp & phân quyền |
| Kiểm thử | `src/utils/ic3Rules.test.ts`, `src/utils/ic3Excel.test.ts`, `server/app.test.ts` | Unit test chuẩn hóa mật khẩu & khối lớp, parse/export CSV & Excel `.xlsx` Lớp học & Học sinh, test tích hợp `POST /api/classes/batch` & `POST /api/students/batch` |
| API Client | `src/utils/api.ts` | `createSchool`, `updateSchool`, `deleteSchool`, `createClass`, `batchImportClasses`, `updateClass`, `deleteClass`, `createStudent`, `batchImportStudents`, `updateStudent`, `deleteStudent`, `resetStudentPassword`, `resetClassPasswords`, `createTeacher`, `updateTeacher`, `deleteTeacher`, `syncTeachersToSupabase`, `pullTeachersFromSupabase` |
| Backend | `server/app.ts` & `server/supabaseStore.ts` | Các route `/api/schools*` (`master`), `/api/classes*` (bao gồm `POST /api/classes/batch`), `/api/students*` (mọi GV), `/api/teachers*` (`master`) ghi trực tiếp xuống bảng `schools`, `classes`, `students`, `admin_teachers` trên Supabase (fallback Local DB nếu chưa cấu hình Supabase) |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Quản lý Phân cấp 3 bước: Trường học → Lớp học → Học sinh
Tổ chức theo mô hình đi sâu từ tổng quát đến chi tiết (tương đồng với **Ngân hàng Câu hỏi**), kết hợp thanh đường dẫn Breadcrumb (`Tất cả Trường học > [Trường] > Lớp [Tên lớp]`) và nút **Quay lại**:
- **Bước 1 — Danh sách Trường học (Tổng quát nhất):**
  - Hiển thị lưới thẻ các trường kèm quận/huyện, tổng số lớp, tổng sĩ số học sinh và danh sách tên các lớp trực thuộc; hỗ trợ tìm kiếm trường theo tên/quận huyện.
  - **Mọi tài khoản giáo viên (LV1, LV2, Master)** đều xem và mở bất kỳ trường nào để quản lý lớp học và học sinh.
  - Chỉ **Giáo viên Master** (`permissions.canManageSchools`) mới có nút **Thêm Trường học**, nút **Sửa** (Modal Box) và nút **Xóa** (Confirm Modal Box cảnh báo xóa kéo theo lớp và học sinh).
  - **Xóa trường (Cascade trên `server.ts`):** Tự động xóa toàn bộ lớp thuộc trường, học sinh thuộc các lớp đó, `classTaskConfigs`, `submissions`, `breakStates`, `battleConfigs`, `battleRooms` liên quan.
- **Bước 2 — Danh sách Lớp học của Trường đang chọn (Cấp trung gian):**
  - Khi bấm vào một thẻ Trường ở Bước 1, hệ thống chuyển sang lưới thẻ các lớp của trường đó kèm khối lớp, sĩ số học sinh, số học sinh đã tự đổi mật khẩu và số tài khoản bật giải lao demo.
  - Hỗ trợ tìm kiếm theo tên lớp và thanh lọc theo **Khối lớp** (`Tất cả`, `Khối 6`, `Khối 7`, `Khối 8`, `Khối 9`).
  - Cho phép cả 3 cấp giáo viên **Thêm / Sửa Lớp học** qua Modal Box (Tên lớp + Khối 6/7/8/9) và **Xóa lớp** qua Confirm Modal Box (xóa kéo theo học sinh và các cấu hình của lớp).
  - **Nhập & Xuất danh sách Lớp học (`Nhập DS lớp` / `Xuất DS lớp`):**
    - **Nhập DS lớp (Modal Box):** Hỗ trợ tải tệp `.xlsx`/`.xls`/`.csv` (kéo thả hoặc chọn tệp), chọn sheet nếu workbook nhiều sheet, tải file Excel mẫu (`mau-nhap-danh-sach-lop.xlsx` gồm sheet `DanhSachLop` + `HuongDan`), hoặc dán trực tiếp CSV/Excel; tự chuẩn hóa khối lớp (`6` → `Khối 6`, suy luận từ tên lớp như `7A3` → `Khối 7`), hiển thị bảng xem trước gắn trạng thái `Hợp lệ` / `Đã tồn tại (bỏ qua)` và lưu hàng loạt qua `POST /api/classes/batch`.
    - **Xuất DS lớp (Modal Box):** Cho phép chọn phạm vi (*Toàn bộ lớp của trường* hoặc *Theo bộ lọc hiện tại*) và định dạng **Excel (`.xlsx`)** (kèm sheet `HuongDan` + thống kê sĩ số, tự đổi MK, giải lao demo) hoặc **CSV (`.csv` UTF-8 BOM)**.

### 2.2. Quản lý Học sinh trong Lớp (Bước 3 — Chi tiết nhất)
- Mở toàn chiều rộng bảng học sinh khi chọn một thẻ Lớp ở Bước 2, gồm thẻ tóm tắt lớp (nút **Reset mật khẩu cả lớp** kèm Confirm Modal xác nhận), thanh tìm kiếm theo họ tên/mã HS và bộ lọc trạng thái (*Tất cả học sinh*, *Dùng mật khẩu mặc định*, *Đã tự đổi mật khẩu*, *Đang bật giải lao demo*).
- **Thêm / Sửa 1 học sinh (qua Modal Box):** Nhập hoặc cập nhật Họ tên, Mã HS (duy nhất trong lớp, tự viết hoa) và cờ `alwaysBreakReady` (*tài khoản kiểm thử giải lao*); khi thêm mới tự động xem trước mật khẩu mặc định sinh ra.
- **Nhập hàng loạt từ Excel / CSV (`Nhập DS học sinh`):**
  - Hỗ trợ 2 chế độ: **Tải tệp `.xlsx`/`.xls`/`.csv`** (kéo thả hoặc chọn file, hỗ trợ chọn sheet) và **Dán văn bản CSV** (mỗi học sinh một dòng), kèm nút **Tải file Excel mẫu** (`mau-nhap-hoc-sinh-lop-*.xlsx`).
  - File mẫu và luồng nhập chỉ yêu cầu duy nhất cột **`Họ và tên`** (nếu có cột `STT` hoặc cột `Mã HS` / `Giải lao demo` cũ đều được tự động bỏ qua).
  - **Tự động đánh Mã HS & mặc định Giải lao demo:** Hệ thống tự động sinh **Mã HS** nối tiếp theo tên lớp (`generateNextStudentCode`, VD: lớp `6A1` đang có tới `6A1-05` thì các học sinh mới tự nhận `6A1-06`, `6A1-07`...), tự sinh mật khẩu mặc định không dấu, và luôn đặt `alwaysBreakReady = false` (chế độ mặc định *Theo nhiệm vụ*). Bảng xem trước hiển thị cột `Mã HS (Tự sinh)`, `Họ và tên`, `Mật khẩu mặc định`, `Ghi chú` (*Sẵn sàng* hoặc cảnh báo nhẹ *Trùng tên (vẫn nhập)*).
  - Server (`POST /api/students/batch`) tự động đánh mã nối tiếp khi nhận danh sách `{ fullName }`, ép `alwaysBreakReady = false` và trả về `{ created, skipped }`.
- **Xuất danh sách Học sinh (`Xuất DS học sinh`):**
  - Cho phép xuất *Toàn bộ học sinh của lớp* hoặc *Theo bộ lọc hiện tại* ra **Excel (`.xlsx`)** hoặc **CSV (`.csv` UTF-8 BOM)** đầy đủ cột: `Mã HS`, `Họ và tên`, `Mật khẩu hiện hành`, `Trạng thái mật khẩu`, `Giải lao demo`, `Lớp`, `Trường học`.
- **Quản lý mật khẩu & Xóa an toàn:**
  - Hiển thị rõ học sinh đang dùng mật khẩu mặc định hay `Đã tự đổi (...)`.
  - Hỗ trợ **Reset MK** cho từng học sinh hoặc **Reset mật khẩu cả lớp** (đặt `passwordHash = normalizeVietnamesePassword(fullName)` và `isCustomPassword = false`), và **Xóa** học sinh qua Confirm Modal Box.
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
2. **Phân tích nhập học sinh (`parseStudentsTabularRows` / `parseStudentsCsv`):**
   - Giáo viên chỉ cần cung cấp cột **Họ và tên** (1 cột duy nhất hoặc `STT | Họ và tên`; nếu file có cột `Mã HS` / `Giải lao demo` cũ sẽ bị bỏ qua).
   - **Mã HS** luôn được hệ thống tự động đánh nối tiếp (`<TênLớp>-01`, `<TênLớp>-02`... kế tiếp mã lớn nhất hiện có trong lớp via `generateNextStudentCode()`).
   - **Giải lao demo (`alwaysBreakReady`)** không có trong luồng nhập danh sách và luôn mặc định là `false` (*Theo nhiệm vụ*); giáo viên vẫn có thể bật/tắt nhanh từng học sinh ngay trên bảng danh sách hoặc khi Sửa 1 học sinh.
3. **Tính duy nhất Mã HS:** Server kiểm tra trùng `studentCode` (không phân biệt hoa/thường) trong phạm vi cùng lớp (`409 Conflict` khi thêm/sửa lẻ, tự sinh mã nối tiếp không trùng khi nhập hàng loạt).

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Toàn bộ luồng Nhập/Xuất Excel (`.xlsx`/`.xls`) & CSV cho cả **Danh sách Lớp học** lẫn **Danh sách Học sinh** đã hoàn thiện đầu-cuối (có file mẫu, chọn sheet, xem trước trùng lặp, xuất theo bộ lọc).
- Thao tác Thêm/Sửa/Xóa/Nhập hàng loạt Trường, Lớp, Học sinh và Giáo viên đã đọc/ghi **trực tiếp** lên 4 bảng `schools`, `classes`, `students`, `admin_teachers` trên Supabase ngay khi thao tác (thông qua `server/supabaseStore.ts` + UUID chuẩn RFC4122).

---

## 5. Nhật ký thay đổi

- **2026-11-24 (Tự động đánh Mã HS & mặc định Giải lao demo khi nhập DS học sinh):** Bỏ cột `Mã HS` và `Giải lao demo` khỏi file Excel mẫu & luồng nhập danh sách học sinh (chỉ cần nhập `Họ và tên`), tự động đánh mã HS nối tiếp theo lớp (`generateNextStudentCode`, VD: `6A1-06`, `6A1-07`) ở cả preview lẫn server (`POST /api/students/batch`), và luôn đặt `alwaysBreakReady = false`.
- **2026-11-24 (Nhập/Xuất Excel & CSV Lớp học và Học sinh):** Thêm mới **Nhập DS lớp / Xuất DS lớp** (Bước 2) kèm API `POST /api/classes/batch`, và nâng cấp **Nhập DS học sinh / Xuất DS học sinh** (Bước 3) hỗ trợ tải tệp `.xlsx`/`.xls`/`.csv`, file mẫu `.xlsx`, chọn sheet, và xuất `.xlsx` / `.csv` UTF-8 BOM.
- **2026-11-24 (Skeleton loading bảng & thẻ):** Bổ sung `TableSkeletonRows` cho bảng học sinh (5 cột) và bảng giáo viên (4 cột) cùng `CardGridSkeleton` cho lưới trường học và lớp học khi chờ API `bootstrap` / làm mới dữ liệu.
- **2026-11-24 / 2026-11-23 (Lưu trực tiếp 17 bảng Supabase):** Chuyển toàn bộ CRUD `schools`, `classes`, `students` và `admin_teachers` sang đọc/ghi trực tiếp trên Supabase PostgreSQL qua `server/app.ts` & `server/supabaseStore.ts` (hỗ trợ chạy Vercel Serverless).
- **2026-11-23 (Phân cấp 3 bước Trường → Lớp → Học sinh & Đồng bộ Giáo viên):** Tái cấu trúc `SchoolsStudentsView.tsx` theo luồng phân cấp 3 bước kèm Breadcrumb + nút Quay lại; bổ sung đồng bộ 2 chiều cho `TeacherManagementView.tsx`.
- **2026-11-21 (Bố cục mới tab Quản lý Giáo viên):** Chuyển nút **Cấp tài khoản** xuống phần đầu bảng *Danh sách Giáo viên*; vô hiệu hóa thao tác đổi vai trò trực tiếp trên bảng (chỉ cho đổi vai trò trong Modal **Sửa**); chuyển nút icon **Chi tiết quyền (`Eye`)** lên phần *Quản lý Tài khoản & Phân quyền Giáo viên* phía trên gắn theo từng nhóm quyền.
- **2026-11-21 (Chuẩn hóa Modal Box & Nút Icon Chi tiết quyền):** Chuyển nút *Chi tiết quyền* tại bảng Giáo viên sang dạng chỉ hiển thị icon (`Eye`) kèm mô tả khi hover; chuyển form **Cấp Tài khoản Giáo viên mới** vào Modal Box; bổ sung Modal Box **Sửa Trường học / Sửa Lớp học / Sửa Học sinh** trong `SchoolsStudentsView.tsx`.
- **2026-11-21 (cập nhật Modal & Icon trạng thái):** Cập nhật cột *Trạng thái tài khoản* sang dạng icon, bỏ cột văn bản *Quyền thao tác* để thay bằng nút mở Modal Box chi tiết quyền, dùng Modal Box riêng khi bấm **Sửa** và Confirm Modal Box khi bấm **Xóa**.
- **2026-11-21 (cập nhật):** Loại bỏ cột và văn bản điều phối trường học khỏi `TeacherManagementView.tsx`, bổ sung đổi vai trò trực tiếp ngay trên bảng và hiển thị/bật tắt trạng thái tài khoản (`Đang hoạt động` / `Tạm khóa`).
- **2026-11-21 (bổ sung):** Chuyển phần quản lý giáo viên ra tab riêng `TeacherManagementView.tsx` cho Master với tìm kiếm và lọc theo 3 nhóm quyền, tiếp tục đảm bảo không có logic gán/điều phối trường cho từng giáo viên.
- **2026-11-21:** Bỏ ràng buộc giáo viên gắn cố định một trường; mở quyền xem & quản lý lớp/học sinh trên tất cả các trường cho mọi giáo viên; nâng cấp Panel Phân quyền Giáo viên thành 3 cấp liên trường hỗ trợ thêm/sửa vai trò & mật khẩu/xóa an toàn.
- **2026-11-20:** Tài liệu hóa đầy đủ tính năng Quản lý Trường, Lớp, Học sinh, CSV và Phân quyền GV.
