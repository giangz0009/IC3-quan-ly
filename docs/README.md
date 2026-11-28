# IC3 Master Admin — Tài liệu Dự án & Theo dõi Tiến triển

> **Tài liệu sống (Living Documentation):** Thư mục `/docs/` là nguồn sự thật chuẩn hóa theo từng tính năng và kiến trúc của dự án **IC3 Master Admin**.  
> **Quy ước bắt buộc:** **Luôn cập nhật lại toàn bộ tài liệu liên quan trong `/docs/` ngay sau mỗi yêu cầu (prompt) thay đổi tính năng, giao diện, cấu trúc hoặc cấu hình của người dùng**, bảo đảm `/docs/` luôn đồng bộ 100% với mã nguồn thực tế.

**Cập nhật lần cuối:** 2026-11-28

---

## 1. Tổng quan Dự án

**IC3 Master Admin** là cổng quản trị học vụ dành cho giáo viên tin học và quản trị viên trường học trong hệ sinh thái luyện thi tin học chuẩn quốc tế **IC3** (chấm điểm thang **0 – 1000**, ngưỡng đạt chuẩn thi thử **≥ 700**).

Hệ thống đảm nhiệm:
- **Triển khai chuẩn Vercel Serverless + Local Node.js:** Dùng chung Express app (`server/app.ts`) cho cả Vercel Serverless Function (`api/index.ts` + `vercel.json`) và dev server cục bộ (`server.ts`).
- **Lưu trữ trực tiếp trên 17 bảng Supabase PostgreSQL:** Toàn bộ nghiệp vụ (Trường/Lớp/Học sinh, Giáo viên, Ngân hàng Câu hỏi 4 tầng & Bộ đề, Giao bài tập & Giải lao, Thi đấu Realtime, Báo cáo) đọc/ghi trực tiếp vào Supabase thông qua `server/supabaseStore.ts` + `src/utils/supabaseMappers.ts`, và chỉ fallback về `server/localStore.ts` khi chưa cấu hình Supabase.
- **Quản lý phân cấp Trường học → Lớp học → Học sinh** theo mô hình đi sâu 3 bước trên toàn bộ các trường, kèm phân quyền Giáo viên 3 cấp liên trường (**GV Giảng dạy (LV1)** / **GV Chuyên môn (LV2)** / **Giáo viên Master**).
- **Quản lý Ngân hàng Câu hỏi 4 tầng** (`Mô-đun/Level` → `Nhóm kiến thức` → `Phần kiến thức` → `Câu hỏi có thứ tự`) với **6 dạng câu hỏi tương tác** (bao gồm `matrix_choice` — *Điền khuyết bảng chọn (Matrix)* và `hotspot` vẽ vùng trên ảnh), hỗ trợ **hình ảnh minh họa tùy chọn** cho cả 5 dạng không phải Hotspot (lưu Supabase Storage bucket `hotspot-images`) và Bộ đề. *(Module nhập/xuất JSON/CSV/Excel trong `ic3Excel.ts`/`ic3Rules.ts` đã hoàn thiện và đang tạm ẩn giao diện qua cờ `SHOW_QUESTION_BANK_IMPORT_EXPORT = false`).*
- **Giao bài tập theo lớp** kèm cơ chế tự động mở khóa Giờ giải lao khi đạt 100% nhiệm vụ theo số lượt đạt điểm sàn.
- **Điều phối Phòng Thi đấu Realtime** với cơ chế Combo 15 giây, Thẻ Phòng thủ (`+2 Khiên`) và 4 loại Thẻ Tấn công gây nhiễu (`blur`, `frost`, `reverse`, `shake`).
- **Thống kê điểm số, báo cáo chi tiết** và xuất báo cáo CSV chuẩn UTF-8 BOM cho Excel.
- **Kết nối, kiểm tra lược đồ 17 bảng, đọc thử và nạp dữ liệu mẫu Supabase** dành cho Giáo viên Master.

---

## 2. Công nghệ & Lệnh Vận hành

| Thành phần | Công nghệ / Phiên bản |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`, `motion`, `xlsx` (`^0.18.x`) |
| Backend & Serverless | Express 4.21 (`server/app.ts`) dùng chung cho `api/index.ts` + `vercel.json` (Vercel) và `tsx server.ts` cổng `3000` (Local/Node) |
| Lưu trữ chính (Cloud DB) | **Supabase PostgreSQL** (17 bảng + Storage bucket `hotspot-images`) qua `@supabase/supabase-js` & `server/supabaseStore.ts` |
| Lưu trữ dự phòng (Offline) | File JSON atomic write tại `data/ic3_admin_db.json` (hoặc `os.tmpdir()` khi `VERCEL` / `AWS_LAMBDA_FUNCTION_NAME`) qua `server/localStore.ts` |
| Xác thực & Phiên | Token **HMAC-SHA256 stateless** (`SESSION_SECRET`) + mật khẩu băm `scrypt` (`server/security.ts`) |
| Kiểm thử tự động | Node built-in test runner (`node:test`) + `tsx` trên 4 bộ test (Unit + Mapper + API/Serverless integration) |

### Biến môi trường cần thiết (`.env.example`)

| Biến môi trường | Bắt buộc trên Vercel | Mục đích |
|---|---|---|
| `SUPABASE_URL` | Khuyến nghị | Project URL của Supabase cho `server/supabaseStore.ts` |
| `SUPABASE_ANON_KEY` | Khuyến nghị | Public Anon Key (hoặc key có quyền phù hợp RLS) cho backend Serverless |
| `SESSION_SECRET` | Bắt buộc ở Production | Khóa ký token phiên HMAC-SHA256 stateless (giữ phiên đăng nhập ổn định giữa các Serverless instance) |
| `GEMINI_API_KEY`, `APP_URL` | Tùy môi trường | Biến runtime mặc định của AI Studio (nếu dùng) |

### Các lệnh phát triển & kiểm tra

```bash
# Chạy môi trường phát triển (Express API + Vite SPA trên cổng 3000)
npm run dev

# Kiểm tra TypeScript (lint)
npm run lint

# Build bản production (Vite → dist/)
npm run build

# Chạy toàn bộ 4 bộ kiểm thử tự động (53 test cases)
npx --yes tsx --test src/utils/ic3Rules.test.ts src/utils/ic3Excel.test.ts src/utils/supabaseMappers.test.ts server/app.test.ts
```

---

## 3. Bản đồ Cấu trúc Mã nguồn

```text
/
├── api/
│   └── index.ts                       # Entry point Vercel Serverless Function + normalizeApiUrl()
├── vercel.json                        # Cấu hình build Vite, function maxDuration=30s và rewrite /api/* → /api/index?__path=$1
├── .env.example                       # Mẫu biến môi trường (SUPABASE_URL, SUPABASE_ANON_KEY, SESSION_SECRET...)
├── server.ts                          # Máy chủ Express + Vite dev/static chạy trên cổng 3000 (gọi createApp())
├── server/
│   ├── app.ts                         # Express app factory (createApp) với toàn bộ route /api/*, requireAuth, requireRoles
│   ├── supabaseStore.ts               # Đọc/ghi trực tiếp toàn bộ 17 bảng Supabase + Storage + chẩn đoán lược đồ
│   ├── localStore.ts                  # CSDL JSON dự phòng (data/ic3_admin_db.json hoặc os.tmpdir()) khi chưa cấu hình Supabase
│   ├── security.ts                    # Hash/verify scrypt, ký & xác thực HMAC-SHA256 stateless token, UUID helper
│   └── app.test.ts                    # Kiểm thử tích hợp Express API, phân quyền, auth, import-remote & Vercel URL rewrite
├── data/ic3_admin_db.json             # CSDL JSON cục bộ (dự phòng offline)
├── docs/                              # Bộ tài liệu sống cập nhật sau mọi prompt
│   ├── README.md                      # Mục lục chính, quy ước bảo trì & changelog
│   ├── 00-kien-truc-va-du-lieu.md     # Kiến trúc Vercel Serverless, 17 bảng Supabase & danh mục REST API
│   ├── App.md                         # Bản lưu kiến trúc điều phối gốc (từ src/App.tsx)
│   ├── server-app.md                  # Bản lưu kiến trúc backend Express API (từ server/app.ts)
│   ├── types-ic3.md                   # Bản lưu toàn bộ TypeScript types & labels (từ src/types/ic3.ts)
│   └── features/                      # Tài liệu chi tiết theo từng phân hệ (01 → 08)
├── src/
│   ├── App.tsx                        # Khung ứng dụng chính, điều hướng 8 tab theo phân quyền, Auth guard, Modal loading
│   ├── types/ic3.ts                   # Toàn bộ TypeScript interfaces & nhãn hiển thị (labels)
│   ├── data/seedData.ts               # SUPABASE_SCHEMA_SQL (17 bảng + Storage + Migration) & createSeedDatabase()
│   ├── utils/
│   │   ├── api.ts                     # HTTP client gọi /api/*, gắn Bearer token & X-Supabase-* headers
│   │   ├── ic3Rules.ts                # Pure domain logic (chấm điểm, mật khẩu VN, CSV/tabular Lớp & HS, Import/Export JSON/CSV, phân cấp, phân quyền)
│   │   ├── ic3Rules.test.ts           # Unit tests nghiệp vụ thuần (ic3Rules.ts)
│   │   ├── ic3Excel.ts                # Đọc/xuất Workbook Excel (.xlsx/.xls) cho Ngân hàng Câu hỏi, Danh sách Lớp học & Danh sách Học sinh
│   │   ├── ic3Excel.test.ts           # Unit tests xử lý Excel (ic3Excel.ts)
│   │   ├── supabaseMappers.ts         # Ánh xạ 2 chiều Domain ↔ PostgreSQL snake_case & chuẩn hóa UUID RFC4122
│   │   ├── supabaseMappers.test.ts    # Unit tests mapper 17 bảng & UUID xác định
│   │   └── supabaseClient.ts          # Cấu hình trình duyệt, pub/sub trạng thái loading Modal, upload/pull dự phòng
│   └── components/
│       ├── AuthScreen.tsx             # Màn hình đăng nhập giáo viên & 3 nút truy cập nhanh tài khoản mẫu
│       ├── TableSkeleton.tsx          # Hệ thống Skeleton Loading (TableSkeletonRows, TableSkeletonCard, CardGridSkeleton, ListSkeleton)
│       ├── ToastContainer.tsx         # Hệ thống thông báo Toast nổi góc dưới bên phải (Success / Warning / Error / Info)
│       ├── OverviewView.tsx           # Tab Tổng quan (KPI + tiến độ lớp + lượt nộp gần nhất)
│       ├── SchoolsStudentsView.tsx    # Tab Trường & Học sinh (phân cấp 3 bước Trường → Lớp → HS, Nhập/Xuất Excel & CSV Lớp học & Học sinh, Reset MK)
│       ├── TeacherManagementView.tsx  # Tab Quản lý Giáo viên (chỉ Master): thống kê 3 nhóm quyền, tìm kiếm, lọc và CRUD tài khoản
│       ├── QuestionBankView.tsx       # Tab Ngân hàng Câu hỏi (4 bước) & Bộ đề (ghi trực tiếp Supabase; tạm ẩn nút Nhập/Xuất)
│       ├── QuestionEditorModal.tsx    # Modal soạn/sửa 6 dạng câu hỏi IC3, ảnh minh họa tùy chọn & ảnh Hotspot
│       ├── HotspotCanvas.tsx          # Hiển thị ảnh theo đúng tỷ lệ & nhấp/kéo chọn điểm đúng Hotspot
│       ├── ClassTasksView.tsx         # Tab Giao Bài tập Lớp & theo dõi mở khóa Giải lao
│       ├── BattleControlView.tsx      # Tab Điều phối Thi đấu Realtime theo lớp
│       ├── ReportsView.tsx            # Tab Thống kê, lịch sử nộp/thi đấu & xuất CSV Excel
│       └── SupabaseView.tsx           # Tab Kết nối Supabase (chỉ Master): cấu hình, kiểm tra 15/17 bảng, SQL DDL & nạp dữ liệu
```

---

## 4. Mục lục Tính năng & Bảng Theo dõi Tiến triển

| Mã | Tính năng | File mô tả chi tiết | Trạng thái hiện tại | Phạm vi lưu trữ Supabase hiện tại |
|---|---|---|---|---|
| **00** | Kiến trúc Vercel Serverless, Mô hình Dữ liệu & SQL Schema | [00-kien-truc-va-du-lieu.md](./00-kien-truc-va-du-lieu.md) | Hoàn thiện | Kiến trúc Serverless `api/index.ts` + lưu trực tiếp **17 bảng Supabase** & `hotspot-images` |
| **Lưu trữ lõi** | Bản chụp cấu trúc `App.tsx`, `server/app.ts`, `types/ic3.ts` | [App.md](./App.md), [server-app.md](./server-app.md), [types-ic3.md](./types-ic3.md) | Cập nhật 2026-11-24 | Lưu trữ code cốt lõi, route, middleware & union/interface để tra cứu kiến trúc nhanh |
| **01** | Xác thực & Phân quyền 3 cấp liên trường (`LV1` / `LV2` / `Master`) | [features/01-xac-thuc-va-phan-quyen.md](./features/01-xac-thuc-va-phan-quyen.md) | Hoàn thành (`scrypt` + HMAC stateless + fallback schema `admin_teachers`) | Đọc/ghi trực tiếp `public.admin_teachers` & `supabase.auth` |
| **02** | Tổng quan Dashboard | [features/02-tong-quan-dashboard.md](./features/02-tong-quan-dashboard.md) | Hoàn thành | Đọc live toàn hệ thống từ 17 bảng Supabase qua `GET /api/bootstrap` |
| **03** | Quản lý Phân cấp Trường → Lớp → Học sinh & GV | [features/03-quan-ly-truong-lop-va-hoc-sinh.md](./features/03-quan-ly-truong-lop-va-hoc-sinh.md) | Hoàn thành (3 bước + Nhập/Xuất Excel & CSV Lớp & HS) | Đọc/ghi trực tiếp `schools`, `classes`, `students`, `admin_teachers` qua server |
| **04** | Ngân hàng Câu hỏi 4 tầng & Bộ đề | [features/04-ngan-hang-cau-hoi-va-bo-de.md](./features/04-ngan-hang-cau-hoi-va-bo-de.md) | Hoàn thành (bật/tắt sẵn sàng Nhóm & Phần kiến thức; gỡ UI đồng bộ tay; **tạm ẩn UI Nhập/Xuất**) | Đọc/ghi trực tiếp `ic3_modules`, `knowledge_categories` (kèm `is_enabled`), `knowledge_parts` (kèm `is_enabled`), `questions`, `question_sets` + bucket `hotspot-images` |
| **05** | Giao Bài tập Lớp & Mở khóa Giải lao | [features/05-giao-bai-tap-lop-va-gio-giai-lao.md](./features/05-giao-bai-tap-lop-va-gio-giai-lao.md) | Hoàn thành | Đọc/ghi trực tiếp `class_task_configs`, `class_tasks`, `student_task_submissions`, `student_break_states` |
| **06** | Điều phối Thi đấu Realtime | [features/06-thi-dau-realtime.md](./features/06-thi-dau-realtime.md) | Hoàn thành (LV2 & Master) | Đọc/ghi trực tiếp `class_battle_configs`, `battle_rooms`, `battle_participants`, `battle_events` |
| **07** | Thống kê & Báo cáo Excel CSV | [features/07-thong-ke-va-bao-cao.md](./features/07-thong-ke-va-bao-cao.md) | Hoàn thành | Đọc live `student_task_submissions` & `battle_rooms` từ Supabase qua server |
| **08** | Kết nối, Chẩn đoán & Modal Loading Supabase | [features/08-ket-noi-dong-bo-va-loading-supabase.md](./features/08-ket-noi-dong-bo-va-loading-supabase.md) | Hoàn thành (chỉ Master) | Chẩn đoán 15/17 bảng, nạp dữ liệu mẫu, đồng bộ/kéo GV & RBAC qua server |

---

## 5. Nhật ký Tiến triển gần đây (Changelog)

- **2026-11-28 (Bật tất cả / Tắt tất cả phần kiến thức thuộc một nhóm):** Bổ sung hai nút **Bật tất cả** và **Tắt tất cả** ngay trên thanh tiêu đề Bước 3 của Ngân hàng Câu hỏi (`QuestionBankView.tsx`), kèm helper `canBatchToggleKnowledgeParts()` (`ic3Rules.ts`) và endpoint nguyên tử `POST /api/knowledge-parts/batch-readiness` (`server/app.ts`, `server/supabaseStore.ts`) cho phép GV LV2 & Master bật hoặc tạm tắt hàng loạt toàn bộ các phần thuộc nhóm đang chọn chỉ trong một lần bấm.
- **2026-11-28 (Bật/Tắt trạng thái sẵn sàng cho từng Phần kiến thức như `OT1`, `OT2`, `OT3`...):** Bổ sung thuộc tính `isEnabled` (`is_enabled boolean not null default true` trên bảng `public.knowledge_parts`) cho phép GV LV2 & Master bật/tắt trạng thái sẵn sàng cho học sinh làm bài trực tiếp trên từng thẻ Phần kiến thức ở Bước 3 hoặc trong Modal thêm/sửa Phần (`QuestionBankView.tsx`, `server/app.ts`, `server/supabaseStore.ts`, `src/data/seedData.ts`), kèm bộ đếm sẵn sàng, bộ lọc trạng thái, gợi ý `(Tạm tắt)` ở Bước 2 và cảnh báo khi đang biên soạn ở Bước 4.
- **2026-11-28 (Bật/Tắt trạng thái sẵn sàng cho bộ Nhóm kiến thức):** Bổ sung thuộc tính `isEnabled` (`is_enabled boolean not null default true` trên bảng `public.knowledge_categories`) cho phép GV LV2 & Master bật/tắt trạng thái sẵn sàng cho học sinh làm bài trực tiếp trên từng thẻ Nhóm kiến thức ở Bước 2 hoặc trong Modal thêm/sửa Nhóm (`QuestionBankView.tsx`, `server/app.ts`, `server/supabaseStore.ts`, `src/data/seedData.ts`), kèm bộ lọc theo trạng thái và bộ đếm sẵn sàng.
- **2026-11-28 (Dạng câu hỏi mới `matrix_choice` — Điền khuyết bảng chọn & Ảnh minh họa tùy chọn):** Phân tích mẫu đề GMetrix bổ sung dạng câu hỏi thứ 6 `matrix_choice` (*Điền khuyết bảng chọn (Matrix)*: đoạn văn có chỗ trống `_(1)_`, `_(2)_`... đi kèm bảng chọn đáp án dùng chung nhiều cột và nhiều dòng, hỗ trợ chọn lại cùng 1 cột cho nhiều chỗ trống) vào `src/types/ic3.ts`, `QuestionEditorModal.tsx`, `QuestionBankView.tsx`, `ic3Rules.ts`, `ic3Excel.ts`, `seedData.ts` (kèm câu mẫu `q_lo_matrix_01` và migration `questions_type_check`). Đồng thời hỗ trợ thêm **hình ảnh minh họa tùy chọn** (`imageUrl`/`imageAlt` trong `payload`, upload Storage hoặc dán `Ctrl + V`) cho cả 5 dạng không phải Hotspot (`single`, `multiple`, `true_false`, `matching`, `matrix_choice`).
- **2026-11-24 (Tự động đánh Mã HS & bỏ cột Giải lao demo khi nhập DS học sinh):** Cập nhật luồng **Nhập DS học sinh** (`ic3Rules.ts`, `ic3Excel.ts`, `SchoolsStudentsView.tsx`, `server/app.ts`, `server/supabaseStore.ts`): giáo viên chỉ cần nhập cột **Họ và tên** (bỏ cột `Mã HS` và `Giải lao demo` khỏi file Excel mẫu và giao diện nhập), hệ thống tự động đánh **Mã HS** nối tiếp theo lớp (`<TênLớp>-01`, `<TênLớp>-02`... kế tiếp mã hiện có trong lớp qua `generateNextStudentCode()`), và tự động gán `alwaysBreakReady = false` (mặc định *Theo nhiệm vụ*).
- **2026-11-24 (Nhập/Xuất Excel & CSV Danh sách Lớp học và Học sinh trong Trường & Học sinh):** Bổ sung đầy đủ tính năng **Nhập DS lớp / Xuất DS lớp** (Bước 2) và nâng cấp **Nhập DS học sinh / Xuất DS học sinh** (Bước 3) trong `SchoolsStudentsView.tsx`, hỗ trợ tải file Excel mẫu (`.xlsx`), kéo thả/tải tệp `.xlsx`/`.xls`/`.csv`, chọn sheet, dán CSV, chuẩn hóa khối lớp tự động, xem trước trùng tên/mã, xuất `.xlsx` (kèm sheet `HuongDan`) hoặc `.csv` UTF-8 BOM, kèm endpoint `POST /api/classes/batch` và `POST /api/students/batch` (ghi trực tiếp Supabase).
- **2026-11-24 (Hiệu ứng Skeleton Loading cho toàn bộ bảng danh sách & nút Làm mới):** Bổ sung `src/components/TableSkeleton.tsx` (`TableSkeletonRows`, `TableSkeletonCard`, `CardGridSkeleton`, `ListSkeleton`) hỗ trợ Light/Dark mode và `motion-safe:animate-pulse`, giữ nguyên cấu trúc cột `<thead>` khi tải dữ liệu trên tất cả các bảng (`SchoolsStudentsView`, `TeacherManagementView`, `ClassTasksView`, `BattleControlView`, `ReportsView`, `SupabaseView`, `QuestionBankView`, `OverviewView`), đồng thời bổ sung nút **Làm mới** trên header `App.tsx` và skeleton theo ngữ cảnh tab khi bootstrap ban đầu.
- **2026-11-24 (Bổ sung bản lưu kiến trúc cốt lõi `App.md`, `server-app.md`, `types-ic3.md`):** Tạo 3 file Markdown lưu trữ nội dung quan trọng của `src/App.tsx`, `server/app.ts` và `src/types/ic3.ts` ngay trong `docs/` để tra cứu kiến trúc hệ thống hiện tại.
- **2026-11-24 (Tạm ẩn UI Nhập/Xuất câu hỏi & Cập nhật đồng bộ toàn bộ `/docs/`):** Tạm ẩn nút *"Xuất ngân hàng"*, *"Nhập Excel / File"* cùng 2 Modal tương ứng trong `QuestionBankView.tsx` qua cờ `SHOW_QUESTION_BANK_IMPORT_EXPORT = false` (giữ nguyên toàn bộ engine pure logic JSON/CSV/Excel trong `ic3Rules.ts`, `ic3Excel.ts`, API `POST /api/question-bank/import-remote` và bộ 44 test tự động để sẵn sàng bật lại khi cần). Thiết lập quy ước luôn cập nhật `/docs/` sau mọi prompt và rà soát toàn bộ tài liệu `00` + `01`–`08`.
- **2026-11-24 (Xây dựng chức năng Nhập/Xuất Ngân hàng Câu hỏi JSON/CSV/Excel):** Bổ sung thư viện `xlsx`, module `src/utils/ic3Excel.ts` (đọc/xuất file `.xlsx`/`.xls` nhiều sheet `CauHoi`, `BoDe`, `HuongDan`), hỗ trợ tiêu đề cột & loại câu hỏi tiếng Việt trong `ic3Rules.ts`, và chế độ `merge` / `replace` trên `POST /api/question-bank/import-remote`.
- **2026-11-24 (Gỡ bỏ component đồng bộ thủ công ở Ngân hàng Câu hỏi):** Xóa thanh/nút đồng bộ Supabase thủ công khỏi `QuestionBankView.tsx` vì toàn bộ thao tác CRUD Ngân hàng Câu hỏi đã ghi trực tiếp vào Supabase ở backend theo mặc định.
- **2026-11-23 (Chuyển đổi Kiến trúc Vercel Serverless & Direct 17-table Supabase + Khắc phục lỗi 500/404 đăng nhập):**
  - Đóng gói Express app thành Vercel Serverless Function (`api/index.ts` + `vercel.json` với `normalizeApiUrl` sửa lỗi `404` route `/api/*` trên Vercel).
  - Bổ sung `server/supabaseStore.ts` và `src/utils/supabaseMappers.ts` đọc/ghi trực tiếp toàn bộ 17 bảng Supabase + Storage.
  - Sửa lỗi `500` khi đăng nhập tài khoản giáo viên tạo trực tiếp trên Supabase bằng cách fallback truy vấn `admin_teachers` khi thiếu cột (`42703`/`PGRST204`) và lưu thêm `email` trong payload token HMAC-SHA256 stateless (`server/security.ts`).
- **2026-11-23 (Phân cấp 3 bước Quản lý Trường → Lớp → Học sinh):** Nâng cấp `SchoolsStudentsView.tsx` theo cấu trúc 3 bước đi sâu từ tổng quát đến chi tiết (Trường học → Lớp học → Học sinh) kèm Breadcrumb và nút Quay lại tương đồng với Ngân hàng Câu hỏi.
- **2026-11-23 (Đồng bộ Supabase `public.admin_teachers` & Tích hợp Đăng nhập):** Chuẩn hóa bảng `public.admin_teachers`, xác thực mật khẩu `scrypt` hoặc Supabase Auth kèm token HMAC-SHA256.
- **2026-11-21 – 2026-11-20:** Phân quyền 3 cấp liên trường (`LV1` / `LV2` / `Master`), Modal Box toàn hệ thống, ToastContainer, Modal Loading toàn màn hình, Hotspot tải ảnh & dán `Ctrl + V` + dọn Storage tự động, cấu trúc Ngân hàng Câu hỏi 4 tầng & gỡ bỏ trường Độ khó.

---

## 6. Quy ước Bảo trì Tài liệu (BẮT BUỘC SAU MỖI PROMPT)

1. **Bắt buộc sau MỌI câu prompt có thay đổi dự án:** Trước khi kết thúc phản hồi, **luôn luôn rà soát và cập nhật lại `/docs/`** (bao gồm `docs/README.md`, `docs/00-kien-truc-va-du-lieu.md` và các file `docs/features/0X-*.md` liên quan) để phản ánh đúng trạng thái mới nhất của mã nguồn, UI, cấu hình và test.
2. **Trước khi sửa code một tính năng:** Đọc file `docs/features/0X-*.md` tương ứng và `docs/00-kien-truc-va-du-lieu.md` để nắm hợp đồng dữ liệu, API và ràng buộc hiện tại.
3. **Nếu thay đổi Schema, biến môi trường hoặc Endpoint:** Cập nhật `docs/00-kien-truc-va-du-lieu.md` và `.env.example` song song với `src/types/ic3.ts`, `src/data/seedData.ts`, `server/app.ts` và `server/supabaseStore.ts`.
