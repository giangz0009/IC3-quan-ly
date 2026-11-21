# IC3 Master Admin — Tài liệu Dự án & Theo dõi Tiến triển

> **Tài liệu sống (Living Documentation):** Thư mục `/docs/` là nguồn sự thật chuẩn hóa theo từng tính năng của dự án **IC3 Master Admin**. Trong các lần nâng cấp, sửa lỗi hoặc thay đổi nghiệp vụ về sau, chỉ cần đọc và cập nhật trực tiếp các file tại đây mà không cần tra cứu lại lịch sử hội thoại cũ.

---

## 1. Tổng quan Dự án

**IC3 Master Admin** là cổng quản trị học vụ dành cho giáo viên tin học và quản trị viên trường học trong hệ sinh thái luyện thi tin học chuẩn quốc tế **IC3** (chấm điểm thang **0 – 1000**, ngưỡng đạt chuẩn thi thử **≥ 700**).

Hệ thống đảm nhiệm:
- Quản lý phân cấp Trường học → Lớp học → Học sinh trên **toàn bộ các trường** và phân quyền tài khoản Giáo viên 3 cấp liên trường (**GV Giảng dạy (LV1)** / **GV Chuyên môn (LV2)** / **Giáo viên Master**).
- Quản lý Ngân hàng Câu hỏi 4 tầng (`Mô-đun/Level` → `Nhóm kiến thức` → `Phần kiến thức` → `Câu hỏi có thứ tự`) với 5 dạng câu hỏi tương tác (bao gồm Hotspot vẽ vùng trực quan) và Bộ đề.
- Giao bài tập theo lớp kèm cơ chế mở khóa Giờ giải lao theo số lượt đạt điểm sàn.
- Điều phối Phòng Thi đấu Realtime với cơ chế Combo 15 giây, Thẻ Phòng thủ (`+2 Khiên`) và 4 loại Thẻ Tấn công gây nhiễu (`blur`, `frost`, `reverse`, `shake`).
- Thống kê điểm số, báo cáo chi tiết và xuất CSV chuẩn UTF-8 BOM cho Excel.
- Kết nối, kiểm tra lược đồ và đồng bộ 2 chiều với **Supabase PostgreSQL**.

---

## 2. Công nghệ & Lệnh Vận hành

| Thành phần | Công nghệ / Phiên bản |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`, `motion` |
| Backend | Express 4.21 chạy trực tiếp qua `tsx server.ts` trên cổng `3000` (tích hợp `vite.middlewares` ở dev) |
| Lưu trữ cục bộ (Local DB) | File JSON atomic write tại `data/ic3_admin_db.json` (tự khởi tạo từ `src/data/seedData.ts`) |
| Lưu trữ đám mây (Remote DB) | Supabase PostgreSQL qua `@supabase/supabase-js` (kết nối từ trình duyệt bằng Project URL + Anon Key) |
| Kiểm thử Unit Test | Node built-in test runner (`node:test`) chạy với `tsx` trên `src/utils/ic3Rules.test.ts` |

### Các lệnh phát triển & kiểm tra

```bash
# Chạy môi trường phát triển (Express API + Vite SPA trên cổng 3000)
npm run dev

# Kiểm tra TypeScript (lint)
npm run lint

# Build bản production (Vite)
npm run build

# Chạy bộ Unit Test nghiệp vụ thuần (ic3Rules)
npx --yes tsx --test src/utils/ic3Rules.test.ts
```

---

## 3. Bản đồ Cấu trúc Mã nguồn

```text
/
├── server.ts                          # Express server + REST API (/api/*) + atomic file DB
├── data/ic3_admin_db.json             # CSDL JSON cục bộ (tự sinh từ seedData nếu chưa có)
├── docs/                              # Bộ tài liệu bóc tách theo tính năng (thư mục này)
├── src/
│   ├── App.tsx                        # Khung ứng dụng chính, điều hướng 8 tab (theo phân quyền), Auth guard, Modal loading Supabase
│   ├── types/ic3.ts                   # Toàn bộ TypeScript interfaces & nhãn hiển thị (labels)
│   ├── data/seedData.ts               # SUPABASE_SCHEMA_SQL (17 bảng) + createSeedDatabase()
│   ├── utils/
│   │   ├── api.ts                     # HTTP client gọi REST API (/api/*) tới server.ts
│   │   ├── ic3Rules.ts                # Pure domain logic (chấm điểm, mật khẩu VN, CSV, sắp xếp, lọc giáo viên, clipboard ảnh, vòng đời Storage, toast variant, Supabase payload, loading format)
│   │   ├── ic3Rules.test.ts           # Unit tests cho ic3Rules.ts
│   │   └── supabaseClient.ts          # Kết nối Supabase, Storage upload/delete, pub/sub trạng thái loading, đồng bộ 2 chiều & CRUD live
│   └── components/
│       ├── AuthScreen.tsx             # Màn hình đăng nhập giáo viên & truy cập nhanh tài khoản mẫu
│       ├── ToastContainer.tsx         # Hệ thống thông báo Toast nổi góc dưới bên phải (Success / Warning / Error / Info)
│       ├── OverviewView.tsx           # Tab Tổng quan (KPI + tiến độ lớp + lượt nộp gần nhất)
│       ├── SchoolsStudentsView.tsx    # Tab Trường, Lớp, Học sinh, CSV import, Reset MK (mọi GV truy cập tất cả các trường)
│       ├── TeacherManagementView.tsx  # Tab Quản lý Giáo viên (chỉ Master): thống kê 3 nhóm quyền, tìm kiếm, lọc và CRUD tài khoản liên trường
│       ├── QuestionBankView.tsx       # Tab Ngân hàng Câu hỏi (4 bước) & Bộ đề + đồng bộ Supabase
│       ├── QuestionEditorModal.tsx    # Modal soạn/sửa 5 dạng câu hỏi IC3
│       ├── HotspotCanvas.tsx          # Hiển thị ảnh câu hỏi tải lên theo đúng tỷ lệ & nhấp/kéo chọn điểm đúng Hotspot
│       ├── ClassTasksView.tsx         # Tab Giao Bài tập Lớp & theo dõi mở khóa Giải lao
│       ├── BattleControlView.tsx      # Tab Điều phối Thi đấu Realtime theo lớp
│       ├── ReportsView.tsx            # Tab Thống kê, lịch sử nộp/thi đấu & xuất CSV Excel
│       └── SupabaseView.tsx           # Tab Kết nối Supabase, kiểm tra 14 bảng, đọc thử & SQL DDL
```

---

## 4. Mục lục Tính năng & Bảng Theo dõi Tiến triển

| Mã | Tính năng | File mô tả chi tiết | Trạng thái hiện tại | Phạm vi đồng bộ Supabase hiện tại |
|---|---|---|---|---|
| **00** | Kiến trúc, Mô hình Dữ liệu & SQL Schema | [00-kien-truc-va-du-lieu.md](./00-kien-truc-va-du-lieu.md) | Hoàn thiện lõi | 17 bảng DDL chuẩn hóa FK 4 tầng + RLS |
| **01** | Xác thực & Phân quyền 3 cấp liên trường (`LV1` / `LV2` / `Master`) | [features/01-xac-thuc-va-phan-quyen.md](./features/01-xac-thuc-va-phan-quyen.md) | Hoàn thành (`scrypt` + Bearer Token) | Cục bộ (`server.ts`); bảng `admin_teachers` có sẵn ở DDL mới (không `school_id`) |
| **02** | Tổng quan Dashboard | [features/02-tong-quan-dashboard.md](./features/02-tong-quan-dashboard.md) | Hoàn thành | Đọc từ Local DB (toàn bộ các trường cho cả 3 cấp) |
| **03** | Quản lý Trường, Lớp, Học sinh & GV | [features/03-quan-ly-truong-lop-va-hoc-sinh.md](./features/03-quan-ly-truong-lop-va-hoc-sinh.md) | Hoàn thành | Đẩy 1 chiều qua nút *"Đồng bộ Dữ liệu lên Supabase"* |
| **04** | Ngân hàng Câu hỏi 4 tầng & Bộ đề | [features/04-ngan-hang-cau-hoi-va-bo-de.md](./features/04-ngan-hang-cau-hoi-va-bo-de.md) | Hoàn thành (LV1 Chỉ xem; LV2/Master Toàn quyền) | **Đồng bộ 2 chiều trực tiếp** (kéo khởi động, đẩy/kéo tay, thêm/sửa/xóa/sắp xếp live) |
| **05** | Giao Bài tập Lớp & Mở khóa Giải lao | [features/05-giao-bai-tap-lop-va-gio-giai-lao.md](./features/05-giao-bai-tap-lop-va-gio-giai-lao.md) | Hoàn thành | Đẩy cấu hình & break states qua nút đồng bộ tổng ở Tab Supabase |
| **06** | Điều phối Thi đấu Realtime | [features/06-thi-dau-realtime.md](./features/06-thi-dau-realtime.md) | Hoàn thành lõi + mô phỏng server (LV2 & Master) | Đẩy `class_battle_configs` qua đồng bộ tổng; phòng đấu chạy trên `server.ts` |
| **07** | Thống kê & Báo cáo Excel CSV | [features/07-thong-ke-va-bao-cao.md](./features/07-thong-ke-va-bao-cao.md) | Hoàn thành | Đọc từ `submissions` & `battleRooms` cục bộ |
| **08** | Kết nối, Đồng bộ & Modal Loading Supabase | [features/08-ket-noi-dong-bo-va-loading-supabase.md](./features/08-ket-noi-dong-bo-va-loading-supabase.md) | Hoàn thành (Modal toàn màn hình, chỉ Master) | Toàn hệ thống gọi Supabase thông qua `trackSupabaseCall` |

---

## 5. Nhật ký Tiến triển gần đây (Changelog)

- **Phân quyền Giáo viên 3 cấp liên trường (`teacher_lv1` / `teacher_lv2` / `master`) & Tab `TeacherManagementView`:** Bỏ hoàn toàn việc gán/điều phối trường cho từng giáo viên — bất kỳ giáo viên nào có tài khoản đều truy cập tự do mọi trường trong hệ thống. Tách màn hình **Quản lý Giáo viên** (`TeacherManagementView.tsx`, chỉ hiển thị với Master) hỗ trợ tìm kiếm, lọc theo 3 nhóm quyền chức năng (**GV Giảng dạy LV1**: chỉ xem Ngân hàng Câu hỏi, giao bài tập lớp, không tổ chức thi đấu realtime; **GV Chuyên môn LV2**: toàn quyền Ngân hàng Câu hỏi + giao bài tập + tổ chức thi đấu realtime; **Giáo viên Master**: toàn quyền không giới hạn) và thêm/sửa/xóa tài khoản an toàn (`scrypt`, Bearer Token HMAC-SHA256 giữ trong bộ nhớ JS, và `requireAuth`/`requireRoles` trên toàn bộ REST API).
- **Kiến trúc 4 tầng Ngân hàng Câu hỏi & Khóa ngoại SQL:** Chuẩn hóa phân cấp `ic3_modules` → `knowledge_categories` → `knowledge_parts` → `questions` (với `content_code` và `topic_order`), bổ sung composite `UNIQUE` và `FOREIGN KEY` (`ON UPDATE CASCADE ON DELETE RESTRICT`) để hiển thị liên kết rõ ràng trên Supabase Schema Visualizer.
- **Đồng bộ 2 chiều Ngân hàng Câu hỏi:** Hỗ trợ đọc tự động khi mở app, kéo/đẩy thủ công, và tự động đồng bộ live mỗi khi thêm/sửa/xóa/đảo thứ tự Mô-đun, Nhóm, Phần, Câu hỏi, Bộ đề (tự động tạo bản ghi cha còn thiếu để không lỗi FK).
- **Chọn nhiều & Thao tác hàng loạt câu hỏi:** Hỗ trợ chọn từng câu, chọn tất cả (kể cả trạng thái `indeterminate` khi đang lọc), tạo Bộ đề từ các câu không liên tục và xóa hàng loạt câu hỏi (kèm đồng bộ xóa trên Supabase và gỡ ID câu hỏi khỏi các Bộ đề liên quan).
- **Câu hỏi Hotspot tải ảnh thật, dán `Ctrl + V` & Quản lý vòng đời Supabase Storage:** Cho phép giáo viên tải ảnh từ máy tính hoặc nhấn `Ctrl + V` để dán ảnh xem trước cục bộ, nhấp/khoanh trực tiếp điểm đúng trên ảnh theo tỷ lệ gốc, chỉ tải lên bucket `hotspot-images` khi bấm **Lưu Câu hỏi**, và tự động xóa ảnh cũ khỏi bucket khi đổi sang ảnh khác hoặc khi xóa câu hỏi (đơn lẻ/hàng loạt).
- **Tinh gọn Form Soạn Câu hỏi & Gỡ bỏ Độ khó:** Khóa lựa chọn Mô-đun/Nhóm/Phần khi tạo mới câu hỏi trong Phần kiến thức; bỏ ô nhập Chủ đề kiến thức (tự lấy theo tên Phần trong CSDL) và Hướng dẫn ngắn (tự gán mặc định theo Dạng câu hỏi); gỡ bỏ hoàn toàn trường & bộ lọc `Độ khó` (`difficulty`) ở cả giao diện, API và Supabase SQL DDL.
- **Hệ thống thông báo Toast góc dưới bên phải màn hình (`ToastContainer`):** Hiển thị nổi cố định ở góc dưới bên phải (`fixed bottom-5 right-5 z-[90]`), phân tách 4 trạng thái trực quan (`THÀNH CÔNG!`, `CẢNH BÁO!`, `LỖI THAO TÁC!`, `THÔNG BÁO!`) kèm icon tròn đặc trưng, xếp chồng tối đa 4 thông báo và tự đóng hoặc bấm `×` để đóng nhanh.
- **Modal Loading toàn màn hình khi chờ Supabase:** Nâng cấp từ banner nhỏ sang Modal toàn màn hình (`z-[100]`, nền mờ khóa tương tác, hộp thoại chuẩn `role="dialog"`, `aria-modal="true"`) kết hợp cơ chế `trackSupabaseCall` tập trung và khóa nút bấm cục bộ trong lúc chờ phản hồi.
- **Chuẩn hóa Modal Box cho toàn bộ thao tác Thêm / Sửa & Bố cục Quản lý Giáo viên:** Toàn bộ thao tác thêm mới và chỉnh sửa trên tất cả các màn hình (Cấp/Sửa Giáo viên, Thêm/Sửa Trường học – Lớp học – Học sinh, Thêm/Sửa Mô-đun – Nhóm – Phần – Câu hỏi – Bộ đề, Sửa Thông tin chung & Thêm/Sửa Nhiệm vụ lớp, Chỉnh sửa Cấu hình Thi đấu) đều hiển thị qua hộp thoại Modal Box (`role="dialog"`, `aria-modal="true"`). Riêng ở tab **Quản lý Giáo viên**, nút **Cấp tài khoản** đặt tại bảng danh sách giáo viên, cột *Vai trò* hiển thị chỉ đọc (chỉ đổi quyền qua Modal **Sửa**), và nút icon xem **Chi tiết quyền (`Eye`)** (hover hiện mô tả) đặt tại khối *Quản lý Tài khoản & Phân quyền Giáo viên* phía trên.

---

## 6. Quy ước Bảo trì Tài liệu (Dành cho các phiên làm việc sau)

1. **Trước khi sửa code một tính năng:** Đọc file `docs/features/0X-*.md` tương ứng và `docs/00-kien-truc-va-du-lieu.md` để nắm toàn bộ hợp đồng dữ liệu, API và các ràng buộc đã có.
2. **Sau khi thêm/sửa/xóa tính năng:** Cập nhật lại đúng file `docs/features/0X-*.md` (mục luồng xử lý, quy tắc mới, hạn chế còn tồn đọng và nhật ký thay đổi) và cập nhật bảng ở Mục 4 + Mục 5 của `docs/README.md`.
3. **Nếu thay đổi Schema hoặc Endpoint:** Cập nhật `docs/00-kien-truc-va-du-lieu.md` song song với `src/types/ic3.ts`, `src/data/seedData.ts` và `server.ts`.
