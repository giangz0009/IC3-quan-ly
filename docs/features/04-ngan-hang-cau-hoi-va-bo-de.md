# Tính năng 04: Ngân hàng Câu hỏi 4 tầng & Bộ đề Luyện/Thi đấu

**Trạng thái:** Đã hoàn thành (6 dạng câu hỏi + ảnh minh họa tùy chọn cho 5 dạng không phải Hotspot + **bật/tắt sẵn sàng Nhóm & Phần kiến thức cho HS làm bài**; CRUD ghi trực tiếp Supabase mặc định; engine Nhập/Xuất JSON/CSV/Excel đã sẵn sàng nhưng **tạm ẩn trên UI**)  
**Cập nhật lần cuối:** 2026-11-28

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/QuestionBankView.tsx` | Luồng drill-down 4 bước, **công tắc bật/tắt sẵn sàng (`role="switch"`) & bộ lọc trạng thái cho cả Nhóm kiến thức (Bước 2) và Phần kiến thức (Bước 3), kèm nút `Bật tất cả` / `Tắt tất cả` các phần thuộc nhóm**, bộ lọc 6 dạng, hiển thị ảnh minh họa tùy chọn & bảng ma trận `matrix_choice` trên thẻ câu hỏi, sub-tab `Bộ đề Luyện & Thi đấu`, thanh chọn nhiều & thao tác hàng loạt. Đã **gỡ bỏ các nút đồng bộ Supabase thủ công**; có cờ `SHOW_QUESTION_BANK_IMPORT_EXPORT = false` để tạm ẩn nút & modal Nhập/Xuất |
| Frontend | `src/components/QuestionEditorModal.tsx` | Modal soạn/sửa câu hỏi cho cả **6 dạng** (`single`, `multiple`, `true_false`, `matching`, `matrix_choice`, `hotspot`); hỗ trợ thêm/đổi/xóa **hình ảnh minh họa tùy chọn** (tải tệp hoặc dán `Ctrl + V`) cho cả 5 dạng không phải Hotspot; khóa ngữ cảnh Mô-đun/Nhóm/Phần khi tạo mới |
| Frontend | `src/components/HotspotCanvas.tsx` | Hiển thị ảnh tải lên theo tỷ lệ gốc, cho phép nhấp chọn điểm / kéo khoanh vùng `%` và hiển thị tâm điểm đúng |
| Logic thuần | `src/utils/ic3Rules.ts` | `isKnowledgeCategoryEnabled()`, `summarizeKnowledgeCategoryReadiness()`, `filterKnowledgeCategoriesByReadiness()`, `isKnowledgePartEnabled()`, `summarizeKnowledgePartReadiness()`, `filterKnowledgePartsByReadiness()`, `canBatchToggleKnowledgeParts()`, `gradeQuestion()`, `isValidPayloadForType()`, `getDefaultInstructionForQuestionType()`, `extractImageFileFromClipboardData()`, `shouldUploadHotspotFileOnSave()`, `shouldUploadQuestionImageOnSave()`, `extractHotspotStoragePathFromUrl()`, `getObsoleteHotspotStoragePath()`, `collectHotspotStoragePathsToDelete()`, `buildHotspotTargetFromPoints()`, `getHotspotTargetCenter()`, `getPartQuestionsSorted()`, `getNextTopicOrder()`, `sliceQuestionsByOrderRange()`, `buildReorderedPartUpdates()`, `buildQuestionBankSupabasePayload()`, `buildQuestionBankExportPackage()`, `formatQuestionBankToCsv()`, `parseQuestionBankTabularRows()`, `parseQuestionBankImportInput()`, `mergeQuestionBankImport()`, `toggleSelectAllVisibleIds()`, `pickQuestionsBySelectedIds()`, `formatQuestionOrderSummary()` |
| Engine Excel | `src/utils/ic3Excel.ts` | `readExcelWorkbookBuffer()`, `parseQuestionBankExcelSheet()`, `buildQuestionBankExcelBuffer()` — đọc/xuất file `.xlsx`/`.xls` nhiều sheet (`CauHoi`, `BoDe`, `HuongDan`) hỗ trợ cả `matrix_choice` và câu hỏi có `imageUrl` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` & `src/utils/ic3Excel.test.ts` | Unit test chấm điểm **6 dạng** (bao gồm `matrix_choice` dùng chung cột), kiểm tra `isKnowledgeCategoryEnabled`, `isKnowledgePartEnabled`, `canBatchToggleKnowledgeParts` / lọc & tổng hợp trạng thái sẵn sàng, `shouldUploadQuestionImageOnSave`, vòng đời Storage, sắp xếp/chọn nhiều, phân tích CSV/JSON/Excel & gộp `mergeQuestionBankImport` |
| Backend | `server/app.ts` & `server/supabaseStore.ts` | Các route `/api/modules*`, `/api/knowledge-categories*` (lưu cờ `isEnabled`/`is_enabled`), `/api/knowledge-parts*` (lưu cờ `isEnabled`/`is_enabled` và `POST /api/knowledge-parts/batch-readiness`), `/api/questions*`, `/api/question-sets*`, `/api/storage/hotspot-upload`, `/api/question-bank/import-remote` (hỗ trợ `mode: 'merge' | 'replace'`, ghi trực tiếp 5 bảng Supabase & bucket `hotspot-images`) |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Luồng Quản lý Phân cấp 4 bước (Drill-down)
1. **Bước 1 — Mô-đun (Level):** Quản lý `ic3_modules` (`LV1`, `LV2`, `LV3` và các mô-đun mở rộng qua Modal Box; chỉ cho xóa khi không còn nhóm/phần/câu hỏi con). Tự động gộp các `module` xuất hiện trong dữ liệu cũ dưới dạng bản ghi ảo (`virtual_mod_*`) để không bị sót.
2. **Bước 2 — Nhóm kiến thức (kèm bật/tắt sẵn sàng cho học sinh):** Lọc theo Mô-đun đã chọn (`GM`, `OT`, hoặc mã tùy chỉnh). Hỗ trợ thêm/sửa Nhóm qua Modal Box (có checkbox *"Sẵn sàng cho học sinh làm bài"*) và xóa khi chưa có phần/câu hỏi con.
   - Mỗi thẻ Nhóm hiển thị trạng thái **Sẵn sàng cho HS làm bài** hoặc **Tạm tắt · Chưa mở HS**, kèm bộ lọc nhanh (`Tất cả`, `Đã mở HS`, `Tạm tắt`) và bộ đếm `X/Y nhóm` ở đầu trang.
   - Giáo viên LV2 / Master có thể bật/tắt trực tiếp bằng công tắc (`role="switch"`) trên thẻ Nhóm (tự lưu qua `PUT /api/knowledge-categories/:id`, hoặc tự khởi tạo bản ghi thật nếu là nhóm ảo `virtual_cat_*`), trong khi GV LV1 chỉ xem trạng thái. Giáo viên vẫn mở được các Phần và Câu hỏi bên trong nhóm đang tạm tắt để tiếp tục biên soạn trước khi mở cho học sinh. Thẻ Nhóm ở Bước 2 cũng gợi ý `(Tạm tắt)` cạnh mã phần nếu phần con bên trong đang tắt.
   - **Lưu ý CSDL Supabase:** Bảng `public.knowledge_categories` bổ sung cột `is_enabled boolean not null default true`.
3. **Bước 3 — Phần kiến thức (`knowledge_parts`, kèm bật/tắt sẵn sàng từng phần như `OT1`, `OT2`, `OT3`...):** Hiển thị các phần như `GM1`, `GM2`, `OT1`, `OT2`, `OT3`... kèm số lượng câu và dải thứ tự (`Câu min – Câu max`). Hỗ trợ thêm/sửa/xóa qua Modal Box (có checkbox `#new-part-enabled` *"Sẵn sàng cho học sinh làm bài"*).
   - Mỗi thẻ Phần hiển thị trạng thái **Sẵn sàng cho HS làm bài** hoặc **Tạm tắt · Chưa mở HS** (`data-testid="part-status-<CODE>"`), kèm bộ đếm tổng hợp (`data-testid="part-readiness-summary"` → `Sẵn sàng cho học sinh: X/Y phần`) và bộ lọc nhanh (`Tất cả`, `Đã mở HS`, `Tạm tắt`).
   - Giáo viên LV2 / Master có thể bật/tắt trực tiếp từng phần bằng công tắc (`role="switch"`) trên thẻ Phần (tự lưu qua `PUT /api/knowledge-parts/:id`, hoặc tự khởi tạo bản ghi thật qua `POST /api/knowledge-parts` nếu là phần ảo `virtual_*`), hoặc sử dụng hai nút thao tác nhanh **Bật tất cả** (`data-testid="parts-enable-all-btn"`) và **Tắt tất cả** (`data-testid="parts-disable-all-btn"`) trên thanh tiêu đề Bước 3 (gọi `POST /api/knowledge-parts/batch-readiness`, tự động vô hiệu hóa nút tương ứng khi toàn bộ phần đã ở trạng thái đó), trong khi GV LV1 chỉ xem trạng thái. Nếu Nhóm cha đang tạm tắt, hiển thị nhắc trạng thái ngay dưới tiêu đề Bước 3.
   - **Lưu ý CSDL Supabase:** Bảng `public.knowledge_parts` bổ sung cột `is_enabled boolean not null default true`.
4. **Bước 4 — Danh sách Câu hỏi theo Thứ tự (`topicOrder`):**
   - Nếu Phần kiến thức đang ở trạng thái tạm tắt, hiển thị thanh nhắc `role="status"` để giáo viên biết phần này chưa mở cho học sinh khi tiếp tục biên soạn câu hỏi.
   - Breadcrumb điều hướng nhanh giữa 4 tầng và nút `Quay lại`.
   - Bộ lọc kết hợp: **Tìm kiếm** (theo nội dung, tên phần/chủ đề, hoặc `"Câu 1"`, `"1"`), **Dạng câu hỏi (6 dạng)**. *(Đã gỡ bỏ trường và bộ lọc Độ khó).*
   - **Đổi thứ tự (`ArrowUp`/`ArrowDown`):** Chuẩn hóa lại `topicOrder` liên tiếp `1..N` và lưu trực tiếp lên Supabase.
   - **Tạo Bộ đề nhanh theo khoảng liên tiếp:** Nhập `Từ câu ... đến câu ...` → `sliceQuestionsByOrderRange` mở sẵn Modal Tạo Bộ đề.

### 2.2. Chọn nhiều (Multi-select) & Thao tác Hàng loạt ở Bước 4
- Mỗi thẻ câu hỏi có checkbox chọn độc lập; thanh công cụ có checkbox **Chọn tất cả** (hỗ trợ trạng thái `indeterminate` khi đang lọc).
- Khi chọn ≥ 1 câu (`activeSelectedQuestions`):
  - **Tạo Bộ đề (`N` câu):** Gom các câu không liên tục theo thứ tự `topicOrder` tăng dần (`pickQuestionsBySelectedIds`), tự sinh tiêu đề và mô tả (`formatQuestionOrderSummary`).
  - **Xóa nhiều câu (`N` câu đã chọn):** Xác nhận inline → gọi `POST /api/questions/batch-delete`, gỡ ID khỏi các Bộ đề liên quan, xóa câu hỏi & ảnh Hotspot cũ khỏi bucket `hotspot-images` trên Supabase.

### 2.3. 6 Dạng Câu hỏi IC3, Ảnh Minh họa Tùy chọn & Chấm điểm (`QuestionEditorModal` + `HotspotCanvas`)
- **Quy tắc Form (`QuestionEditorModal`):**
  - Khi tạo mới trong Phần kiến thức, khóa ngữ cảnh **Mô-đun**, **Nhóm kiến thức** và **Phần kiến thức**.
  - `topic` tự động lấy từ `title` của Phần kiến thức (`knowledge_parts`), `instruction` gán tự động theo `type` qua `getDefaultInstructionForQuestionType(type)`, và trường `difficulty` đã bị loại bỏ hoàn toàn.
  - **Hình ảnh minh họa tùy chọn (áp dụng cho cả 5 dạng không phải Hotspot):** Cho phép giáo viên tùy ý thêm ảnh minh họa (chọn file hoặc dán `Ctrl + V`), nhập mô tả `imageAlt`, đổi hoặc xóa ảnh, hoặc để trống. Chỉ tải lên bucket `hotspot-images` (hoặc nén WebP fallback) khi bấm **Lưu Câu hỏi** (`shouldUploadQuestionImageOnSave`), và tự dọn ảnh cũ khỏi Storage khi sửa/xóa câu hỏi (`getObsoleteHotspotStoragePath`, `collectHotspotStoragePathsToDelete`). Ảnh được lưu trong `payload.imageUrl` (`jsonb`) nên **không cần thêm cột mới trong bảng `questions`**.
1. **`single` (Trắc nghiệm 1 đáp án):** Tối thiểu 2 phương án, chọn 1 `correctOptionId`.
2. **`multiple` (Trắc nghiệm nhiều đáp án):** Tối thiểu 2 phương án, chọn ≥ 1 `correctOptionIds`.
3. **`true_false` (Đúng / Sai từng ý):** Danh sách `statements`, chấm đúng toàn bộ các ý.
4. **`matching` (Ghép nối Cột A – B):** Tối thiểu 2 mục mỗi cột (`matchingLeft`, `matchingRight`, `correctPairs`), phải ghép đúng toàn bộ cặp.
5. **`matrix_choice` (Điền khuyết bảng chọn (Matrix)):**
   - Soạn theo cấu trúc chuẩn GMetrix (như bài toán tử tìm kiếm Boolean): phần câu chữ có các chỗ trống đánh số `_(1)_`, `_(2)_`... (`templateText`), danh sách cột lựa chọn dùng chung (`options`, tối thiểu 2 cột), và danh sách các dòng chỗ trống (`slots: { id, label, correctOptionId }[]`, tối thiểu 1 dòng).
   - Mỗi dòng chọn 1 cột đáp án đúng qua bảng radio; **nhiều chỗ trống có thể dùng chung cùng 1 cột đáp án**. Chấm điểm (`gradeQuestion`) yêu cầu đúng toàn bộ `slots`.
   - **Lưu ý CSDL Supabase:** Ràng buộc `CHECK` trên cột `public.questions.type` cần cho phép thêm giá trị `'matrix_choice'` (`questions_type_check`).
6. **`hotspot` (Chọn điểm trên hình):**
   - Chọn ảnh từ máy (`PNG`, `JPG`, `WebP`, `GIF`, tối đa `10 MB`) hoặc nhấn **`Ctrl + V` / `Cmd + V`** trong modal (`extractImageFileFromClipboardData`).
   - Ảnh vừa chọn chỉ xem trước cục bộ (`blob:` URL) và **chỉ upload lên Supabase Storage bucket `hotspot-images` (qua `POST /api/storage/hotspot-upload` trên server) khi bấm Lưu và vượt qua kiểm tra hợp lệ** (`shouldUploadQuestionImageOnSave`). Nếu chưa cấu hình Supabase, tự nén WebP max width `1400px` thành Data URL.
   - Khi sửa đổi ảnh hoặc xóa câu hỏi, server/client tự gom đường dẫn ảnh không còn dùng chung (`getObsoleteHotspotStoragePath`, `collectHotspotStoragePathsToDelete`) để dọn sạch khỏi bucket `hotspot-images`.
   - Bắt buộc có ảnh và điểm/vùng đáp án (`hotspotTarget`); chấm điểm hỗ trợ dung sai `±1.5%`.

### 2.4. Lưu trữ Mặc định Trực tiếp trên Supabase (Đã gỡ UI đồng bộ tay)
- Toàn bộ thao tác Thêm / Sửa / Xóa / Đổi thứ tự Mô-đun, Nhóm, Phần, Câu hỏi và Bộ đề trong `QuestionBankView.tsx` **lưu trực tiếp vào 5 bảng Supabase thông qua API backend (`server/app.ts` + `server/supabaseStore.ts`)**.
- Các component/nút đồng bộ thủ công (*"Lấy từ Supabase"*, *"Đẩy lên Supabase"*, công tắc đồng bộ tay ở thanh công cụ Ngân hàng Câu hỏi) **đã được gỡ bỏ** để tránh dư thừa và nhầm lẫn.
- Khi ghi lên Supabase, `server/supabaseStore.ts` luôn tự động bảo đảm bản ghi cha (`ensureModule` / `ensureCategory` / `ensurePart`) trước khi ghi bản ghi con nhằm tôn trọng ràng buộc Khóa ngoại 4 tầng.

### 2.5. Tính năng Nhập / Xuất Ngân hàng Câu hỏi (JSON / CSV / Excel `.xlsx`) — *Đang tạm ẩn UI*
- **Trạng thái giao diện hiện tại:** Tạm thời ẩn 2 nút *"Xuất ngân hàng"*, *"Nhập Excel / File"* và 2 Modal tương ứng thông qua cờ `const SHOW_QUESTION_BANK_IMPORT_EXPORT: boolean = false;` trong `src/components/QuestionBankView.tsx` (có thể bật lại bằng cách đổi thành `true`).
- **Engine & Backend vẫn được giữ nguyên và kiểm thử đầy đủ:**
  - **Xuất (`buildQuestionBankExportPackage`, `formatQuestionBankToCsv`, `buildQuestionBankExcelBuffer`):** Hỗ trợ xuất toàn bộ ngân hàng hoặc nhánh đang xem ra Excel `.xlsx` (3 sheet `CauHoi`, `BoDe`, `HuongDan` với các cột `optionA`–`optionF`, `matchingLeft`, `matchingRight`, `correctAnswer`, kèm `payloadJson` fallback cho `hotspot`/cấu trúc phức tạp), JSON hoặc CSV UTF-8 BOM.
  - **Nhập hàng loạt (`readExcelWorkbookBuffer`, `parseQuestionBankExcelSheet`, `parseQuestionBankTabularRows`, `parseQuestionBankImportInput`):** Hỗ trợ kéo thả `.xlsx`/`.xls`/`.csv`/`.json`, tải file mẫu `.xlsx`/`.json`/`.csv`, chọn Sheet Excel, nhận diện cả cột tiếng Anh lẫn tiêu đề tiếng Việt (`Mô-đun`, `Nhóm`, `Phần`, `Dạng`, `Nội dung câu hỏi`, `Đáp án A..F`, `Đáp án đúng`...), xem trước bảng 5 dòng, kiểm tra hợp lệ từng câu (`isValidPayloadForType`), và gửi qua `POST /api/question-bank/import-remote` với 2 chế độ `merge` (gộp/cập nhật) hoặc `replace` (thay thế).

---

## 3. Quy tắc & Ràng buộc Xử lý

1. **Phân quyền Ngân hàng Câu hỏi (`canEdit`):**
   - **GV Giảng dạy (`teacher_lv1`):** Chỉ có quyền **Xem** (hiển thị banner `[data-testid="qb-readonly-banner"]`), duyệt 4 tầng, tìm kiếm/lọc, xem Hotspot & Bộ đề; ẩn toàn bộ nút Thêm/Sửa/Xóa/Đảo thứ tự/Chọn nhiều và backend trả `403` cho mọi API ghi.
   - **GV Chuyên môn (`teacher_lv2`) & Giáo viên Master (`master`):** Toàn quyền thêm/sửa/xóa/sắp xếp 4 tầng + Bộ đề + gọi `/api/question-bank/import-remote`.
2. **Ràng buộc xóa phân cấp:** Backend (`server/app.ts` + `server/supabaseStore.ts`) và UI đều chặn xóa Mô-đun nếu còn Nhóm/Phần/Câu hỏi; chặn xóa Nhóm nếu còn Phần/Câu hỏi; chặn xóa Phần nếu còn Câu hỏi (`400 Bad Request`).
3. **Sửa Mô-đun:** Không đổi `code` (khóa chính logic), nhưng nếu đổi `level` thì hệ thống tự cập nhật đồng bộ `level` cho toàn bộ `knowledgeParts` và `questions` thuộc mô-đun đó.
4. **Thứ tự câu hỏi (`topicOrder`):** Câu hỏi mới mặc định nhận `getNextTopicOrder(...)` = `max + 1` trong Phần kiến thức. Khi xóa 1 hoặc nhiều câu hỏi, hệ thống tự loại bỏ ID tương ứng khỏi `questionIds` của mọi `questionSets`.

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Khi người dùng muốn sử dụng lại chức năng Nhập/Xuất hàng loạt từ Excel/CSV/JSON, chỉ cần đổi `SHOW_QUESTION_BANK_IMPORT_EXPORT = true` trong `src/components/QuestionBankView.tsx` (hoặc tinh chỉnh thêm cột ảnh Hotspot nếu muốn nhập ảnh từ URL công khai).
- Khi xóa bản ghi cha mà Supabase còn bản ghi con ngoài ý muốn, ràng buộc PostgreSQL `ON DELETE RESTRICT` sẽ từ chối để bảo vệ toàn vẹn dữ liệu.

---

## 5. Nhật ký thay đổi

- **2026-11-28 (Bật tất cả / Tắt tất cả phần kiến thức thuộc một nhóm):** Bổ sung hai nút thao tác nhanh `Bật tất cả` / `Tắt tất cả` ở Bước 3 (`QuestionBankView.tsx`), hàm kiểm tra thuần `canBatchToggleKnowledgeParts()` (`ic3Rules.ts`) và endpoint nguyên tử `POST /api/knowledge-parts/batch-readiness` (`server/app.ts`, `server/supabaseStore.ts`) để giáo viên LV2/Master bật hoặc tắt hàng loạt toàn bộ phần thuộc nhóm chỉ trong một lần bấm.
- **2026-11-28 (Bật/Tắt sẵn sàng cho từng Phần kiến thức như `OT1`, `OT2`, `OT3`...):** Bổ sung thuộc tính `isEnabled` (`is_enabled boolean not null default true` trên `public.knowledge_parts`), công tắc `role="switch"` trực tiếp trên từng thẻ Phần ở Bước 3, bộ đếm `part-readiness-summary`, bộ lọc trạng thái (`Tất cả`, `Đã mở HS`, `Tạm tắt`), checkbox `#new-part-enabled` trong Modal thêm/sửa Phần, gợi ý `(Tạm tắt)` ở Bước 2 và thanh nhắc ở Bước 4 (`QuestionBankView.tsx`, `server/app.ts`, `server/supabaseStore.ts`, `src/data/seedData.ts`).
- **2026-11-28 (Bật/Tắt sẵn sàng Nhóm kiến thức cho học sinh):** Thêm trường `isEnabled` (`is_enabled boolean not null default true` trên `public.knowledge_categories`), công tắc `role="switch"` trực tiếp trên từng thẻ Nhóm ở Bước 2, checkbox trong Modal thêm/sửa Nhóm, bộ lọc trạng thái (`Tất cả`, `Đã mở HS`, `Tạm tắt`) và bộ đếm tổng hợp trong `QuestionBankView.tsx`, kèm hỗ trợ lưu trực tiếp qua `PUT /api/knowledge-categories/:id` và migration DDL trong `seedData.ts`.
- **2026-11-28 (Bổ sung dạng `matrix_choice` & Ảnh minh họa tùy chọn):** Thêm dạng câu hỏi thứ 6 `matrix_choice` (*Điền khuyết bảng chọn (Matrix)*) vào `ic3.ts`, `QuestionEditorModal.tsx`, `QuestionBankView.tsx`, `ic3Rules.ts`, `ic3Excel.ts`, `seedData.ts` (kèm câu mẫu `q_lo_matrix_01` & migration `questions_type_check`); cho phép tất cả dạng câu hỏi trừ `hotspot` được đính kèm **hình ảnh minh họa tùy chọn** (file / `Ctrl + V`, lưu trong `payload.imageUrl`).
- **2026-11-24 (Tạm ẩn UI Nhập/Xuất câu hỏi):** Ẩn nút *"Xuất ngân hàng"*, *"Nhập Excel / File"* cùng Export Modal và Import Modal trong `QuestionBankView.tsx` qua `SHOW_QUESTION_BANK_IMPORT_EXPORT = false`; giữ nguyên `ic3Excel.ts`, `ic3Rules.ts`, route `POST /api/question-bank/import-remote` và toàn bộ unit/integration tests.
- **2026-11-24 (Tính năng Nhập/Xuất JSON, CSV & Excel `.xlsx`):** Tạo `src/utils/ic3Excel.ts` + bộ test `ic3Excel.test.ts`; mở rộng `ic3Rules.ts` (`parseQuestionBankTabularRows`, alias cột & tên dạng câu hỏi tiếng Việt) và sửa `isValidPayloadForType()` cho `matching`/`hotspot`; thêm chế độ `merge` / `replace` vào `/api/question-bank/import-remote`.
- **2026-11-24 (Gỡ bỏ component đồng bộ Supabase thủ công):** Xóa các nút kéo/đẩy & công tắc đồng bộ Supabase ở `QuestionBankView.tsx` vì toàn bộ thao tác Ngân hàng Câu hỏi đã đọc/ghi trực tiếp trên Supabase qua backend.
- **2026-11-23 (Lưu trữ trực tiếp 5 bảng Supabase & Upload ảnh qua Server):** Toàn bộ CRUD Ngân hàng Câu hỏi và upload ảnh `hotspot-images` chuyển sang xử lý qua `server/supabaseStore.ts`, hỗ trợ chạy thuần bằng biến môi trường Vercel mà không phụ thuộc cấu hình `localStorage`.
- **2026-11-21 – 2026-11-20:** Modal Box 4 tầng, phân quyền LV1 Chỉ xem / LV2 & Master Toàn quyền, Hotspot tải ảnh thật & `Ctrl + V` + dọn Storage tự động, bỏ trường Độ khó, chọn nhiều không liên tục.
