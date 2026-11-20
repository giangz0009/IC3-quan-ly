# Tính năng 04: Ngân hàng Câu hỏi 4 tầng & Bộ đề Luyện/Thi đấu

**Trạng thái:** Đã hoàn thành (đầy đủ CRUD, 5 dạng câu hỏi, chọn nhiều & đồng bộ 2 chiều Supabase)  
**Cập nhật lần cuối:** 2026-11-20

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/QuestionBankView.tsx` | Luồng drill-down 4 bước, sub-tab `Bộ đề Luyện & Thi đấu`, thanh chọn nhiều & thao tác hàng loạt, nút kéo/đẩy & bật tắt đồng bộ Supabase |
| Frontend | `src/components/QuestionEditorModal.tsx` | Modal soạn/sửa câu hỏi cho cả 5 dạng (`single`, `multiple`, `true_false`, `matching`, `hotspot`) |
| Frontend | `src/components/HotspotCanvas.tsx` | Vẽ/hiển thị SVG 4 mẫu giao diện (`word_ribbon`, `excel_ribbon`, `pc_hardware_ports`, `browser_security`) & kéo thả khoanh vùng % |
| Logic thuần | `src/utils/ic3Rules.ts` | `gradeQuestion()`, `getPartQuestionsSorted()`, `getNextTopicOrder()`, `sliceQuestionsByOrderRange()`, `buildReorderedPartUpdates()`, `buildQuestionBankSupabasePayload()`, `toggleSelectAllVisibleIds()`, `pickQuestionsBySelectedIds()`, `formatQuestionOrderSummary()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test cho chấm điểm 5 dạng, sắp xếp/cắt khoảng, chọn nhiều không liên tục, payload Supabase cha → con |
| Đồng bộ Supabase | `src/utils/supabaseClient.ts` | `fetchQuestionBankFromSupabase`, `pushQuestionBankToSupabase`, `upsertModuleOnSupabase`, `deleteModuleOnSupabase`, `syncCategoryWithParentOnSupabase`, `deleteKnowledgeCategoryOnSupabase`, `syncPartWithParentsOnSupabase`, `deleteKnowledgePartOnSupabase`, `syncQuestionWithParentsOnSupabase`, `deleteQuestionAndSyncSetsOnSupabase`, `deleteQuestionsBatchAndSyncSetsOnSupabase`, `reorderQuestionsOnSupabase`, `upsertQuestionSetOnSupabase`, `deleteQuestionSetOnSupabase` |
| Backend | `server.ts` | Các route `/api/modules*`, `/api/knowledge-categories*`, `/api/knowledge-parts*`, `/api/questions*`, `/api/question-sets*`, `/api/question-bank/import-remote` |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Luồng Quản lý Phân cấp 4 bước (Drill-down)
1. **Bước 1 — Mô-đun (Level):** Quản lý danh sách `ic3_modules` (mặc định `LV1`, `LV2`, `LV3`; cho phép thêm/sửa Mô-đun mới như `LV4`, chỉ cho xóa khi không còn nhóm/phần/câu hỏi con). Tự động gộp các `module` xuất hiện trong dữ liệu cũ dưới dạng bản ghi ảo (`virtual_mod_*`) để không bị sót.
2. **Bước 2 — Nhóm kiến thức:** Lọc theo Mô-đun đã chọn (`GM`, `OT`, hoặc mã tùy chỉnh như `TH`, `BT`). Hỗ trợ thêm/sửa/xóa Nhóm (chỉ xóa khi chưa có phần/câu hỏi).
3. **Bước 3 — Phần kiến thức (`knowledge_parts`):** Hiển thị các phần như `GM1`, `GM2`, `OT1`... kèm số lượng câu và dải thứ tự (`Câu min – Câu max`). Hỗ trợ thêm/sửa/xóa Phần (chỉ xóa khi chưa có câu hỏi).
4. **Bước 4 — Danh sách Câu hỏi theo Thứ tự (`topicOrder`):**
   - Hiển thị breadcrumb điều hướng nhanh giữa 4 tầng và nút `Quay lại`.
   - Bộ lọc kết hợp: **Tìm kiếm** (theo nội dung, chủ đề, hoặc `"Câu 1"`, `"1"`), **Dạng câu hỏi (5 dạng)**, **Độ khó (`easy`/`medium`/`hard`)**.
   - **Đổi thứ tự (`ArrowUp`/`ArrowDown`):** Hoạt động khi không bật bộ lọc, tự động chuẩn hóa lại `topicOrder` liên tiếp `1..N` và đồng bộ lên Supabase.
   - **Tạo Bộ đề nhanh theo khoảng liên tiếp:** Nhập `Từ câu ... đến câu ...` → `sliceQuestionsByOrderRange` mở sẵn Modal Tạo Bộ đề.

### 2.2. Chọn nhiều (Multi-select) & Thao tác Hàng loạt ở Bước 4
- Mỗi thẻ câu hỏi có checkbox chọn độc lập (viền nổi bật khi được chọn).
- Thanh công cụ phía trên danh sách có checkbox **Chọn tất cả** (tự chuyển trạng thái `indeterminate` khi chỉ chọn một phần câu đang hiển thị; khi đang lọc chỉ chọn/bỏ chọn các câu khớp bộ lọc hiện tại mà giữ nguyên các câu đã chọn khác trong phần).
- Khi có ít nhất 1 câu được chọn (`activeSelectedQuestions`), hiện các hành động:
  - **Tạo Bộ đề (`N` câu):** Gom các câu **không liên tục** theo đúng thứ tự `topicOrder` tăng dần (`pickQuestionsBySelectedIds`), tự sinh tiêu đề và mô tả tóm tắt (`formatQuestionOrderSummary`, VD: `"Câu 1, Câu 3, Câu 5"`), mở Modal Bộ đề để lưu.
  - **Xóa nhiều câu (`N` câu đã chọn):** Có bước xác nhận inline (*"Xác nhận xóa N câu?"* → *Xác nhận xóa* / *Hủy*), gọi `POST /api/questions/batch-delete`, xóa sạch ID câu hỏi khỏi các Bộ đề liên quan, và đồng bộ xóa + cập nhật Bộ đề lên Supabase.
  - **Bỏ chọn:** Xóa nhanh toàn bộ lựa chọn hiện tại.

### 2.3. 5 Dạng Câu hỏi IC3 & Chấm điểm (`QuestionEditorModal` + `HotspotCanvas`)
1. **`single` (Trắc nghiệm 1 đáp án):** Tối thiểu 2 phương án, chọn 1 `correctOptionId`.
2. **`multiple` (Trắc nghiệm nhiều đáp án):** Tối thiểu 2 phương án, chọn ≥ 1 `correctOptionIds` (chấm đúng tuyệt đối tập đáp án).
3. **`true_false` (Đúng / Sai từng ý):** Danh sách `statements`, học sinh phải chọn đúng toàn bộ các ý.
4. **`matching` (Ghép nối Cột A – B):** Tối thiểu 2 mục mỗi cột, ánh xạ `correctPairs`, phải ghép đúng toàn bộ cặp.
5. **`hotspot` (Chọn điểm trên hình):**
   - Chọn 1 trong 4 mẫu SVG dựng sẵn: `word_ribbon`, `excel_ribbon`, `pc_hardware_ports`, `browser_security`.
   - Kéo thả chuột trực tiếp trên `HotspotCanvas` (tỷ lệ `aspect-[16/7]`) để khoanh vùng tọa độ phần trăm `minX..maxX`, `minY..maxY` (nhấp đơn tạo vùng `8% x 14%`). Chấm điểm cho phép **dung sai `±1.5%`** quanh khung đáp án.

### 2.4. Sub-tab `Bộ đề Luyện & Thi đấu` (`question_sets`)
- Hiển thị danh sách các Bộ đề, cho phép tạo mới, chỉnh sửa metadata + tick chọn danh sách câu hỏi, hoặc xóa Bộ đề.

### 2.5. Cơ chế Đồng bộ 2 chiều với Supabase
- Khi bật công tắc **"Tự động đồng bộ Supabase"** (`ic3_admin_supabase_qb_live`):
  - **Lúc mở app:** Tự động kéo 5 bảng từ Supabase về Local DB (nếu có dữ liệu).
  - **Khi Thêm / Sửa / Xóa / Đổi thứ tự:** Lưu vào `server.ts` trước rồi gọi ngay helper đồng bộ lên Supabase (`syncCategoryWithParentOnSupabase`, `syncPartWithParentsOnSupabase`, `syncQuestionWithParentsOnSupabase`, `deleteQuestionAndSyncSetsOnSupabase`, `deleteQuestionsBatchAndSyncSetsOnSupabase`, `reorderQuestionsOnSupabase`, `upsertQuestionSetOnSupabase`, `deleteQuestionSetOnSupabase`).
  - **Tự đảm bảo dữ liệu cha (Parent Auto-Ensure):** Trước khi `upsert` Nhóm, Phần hoặc Câu hỏi lên Supabase, code tự động gọi `ensureModuleParentRaw` / `ensureCategoryParentRaw` / `ensurePartParentRaw` (`ignoreDuplicates: true`) để không bao giờ vướng lỗi ràng buộc Khóa ngoại 4 tầng trên PostgreSQL.
- Ngoài ra luôn có 2 nút thủ công trên thanh công cụ: **"Lấy từ Supabase"** (ghi đè Local DB) và **"Đẩy lên Supabase"** (chuẩn hóa thứ tự cha → con qua `buildQuestionBankSupabasePayload`).

---

## 3. Quy tắc & Ràng buộc Xử lý

1. **Ràng buộc xóa phân cấp:** Server (`server.ts`) và UI đều chặn xóa Mô-đun nếu còn Nhóm/Phần/Câu hỏi; chặn xóa Nhóm nếu còn Phần/Câu hỏi; chặn xóa Phần nếu còn Câu hỏi (`400 Bad Request`).
2. **Sửa Mô-đun:** Không đổi `code` (khóa chính logic), nhưng nếu đổi `level` thì `server.ts` và `upsertModuleRaw` tự cập nhật đồng bộ `level` cho toàn bộ `knowledgeParts` và `questions` thuộc mô-đun đó.
3. **Thứ tự câu hỏi (`topicOrder`):** Câu hỏi mới mặc định nhận `getNextTopicOrder(...)` = `max + 1` trong Phần kiến thức. Khi xóa 1 hoặc nhiều câu hỏi, hệ thống tự loại bỏ ID tương ứng khỏi `questionIds` của mọi `questionSets`.
4. **Hành vi khi lỗi Supabase cục bộ:** Nếu lưu vào `server.ts` thành công nhưng bước đồng bộ Supabase bị lỗi (VD: mất mạng hoặc thiếu RLS), hệ thống giữ bản lưu cục bộ và thông báo toast cảnh báo đỏ rõ nguyên nhân.

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Chế độ `HotspotCanvas` hiện dùng 4 ảnh SVG vẽ sẵn trong code; chưa hỗ trợ tải lên ảnh màn hình tùy chỉnh (PNG/JPG) từ máy tính giáo viên.
- Thao tác kéo từ Supabase (`Lấy từ Supabase` / `import-remote`) ghi đè toàn bộ 5 bảng Ngân hàng Câu hỏi cục bộ theo dữ liệu Supabase (Last-pull-wins), chưa có cơ chế merge xung đột từng bản ghi.
- Khi xóa ở giao diện mà Supabase có bản ghi cha/con cũ không đồng nhất, PostgreSQL ràng buộc `ON DELETE RESTRICT` sẽ báo lỗi để bảo vệ toàn vẹn dữ liệu.

---

## 5. Nhật ký thay đổi

- **2026-11-20:** Hoàn thiện tính năng chọn nhiều (Chọn tất cả, tạo Bộ đề không liên tục, xóa hàng loạt đồng bộ Supabase) và modal loading toàn màn hình khi thao tác với Supabase.
- **Trước 2026-11-20:** Xây dựng cấu trúc 4 tầng (`ic3_modules` → `knowledge_categories` → `knowledge_parts` → `questions`), đồng bộ CRUD 2 chiều live với auto-ensure parent và sửa lỗi RLS/Schema Visualizer trên Supabase.
