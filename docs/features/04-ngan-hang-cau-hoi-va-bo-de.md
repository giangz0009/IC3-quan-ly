# Tính năng 04: Ngân hàng Câu hỏi 4 tầng & Bộ đề Luyện/Thi đấu

**Trạng thái:** Đã hoàn thành (đầy đủ CRUD, 5 dạng câu hỏi, chọn nhiều & đồng bộ 2 chiều Supabase)  
**Cập nhật lần cuối:** 2026-11-20

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/QuestionBankView.tsx` | Luồng drill-down 4 bước, sub-tab `Bộ đề Luyện & Thi đấu`, thanh chọn nhiều & thao tác hàng loạt, nút kéo/đẩy & bật tắt đồng bộ Supabase |
| Frontend | `src/components/QuestionEditorModal.tsx` | Modal soạn/sửa câu hỏi cho cả 5 dạng (`single`, `multiple`, `true_false`, `matching`, `hotspot`); tự khóa ngữ cảnh Mô-đun/Nhóm/Phần khi tạo mới trong Phần kiến thức; hỗ trợ chọn tệp ảnh hoặc dán trực tiếp (`Ctrl + V`) cho Hotspot |
| Frontend | `src/components/HotspotCanvas.tsx` | Hiển thị ảnh giáo viên tải lên theo đúng tỷ lệ gốc (hoặc SVG fallback cho câu hỏi mẫu cũ), cho phép nhấp chọn điểm / kéo khoanh vùng `%` và hiển thị tâm điểm đúng |
| Logic thuần | `src/utils/ic3Rules.ts` | `gradeQuestion()`, `getDefaultInstructionForQuestionType()`, `extractImageFileFromClipboardData()`, `shouldUploadHotspotFileOnSave()`, `extractHotspotStoragePathFromUrl()`, `getObsoleteHotspotStoragePath()`, `collectHotspotStoragePathsToDelete()`, `buildHotspotTargetFromPoints()`, `getHotspotTargetCenter()`, `getPartQuestionsSorted()`, `getNextTopicOrder()`, `sliceQuestionsByOrderRange()`, `buildReorderedPartUpdates()`, `buildQuestionBankSupabasePayload()`, `toggleSelectAllVisibleIds()`, `pickQuestionsBySelectedIds()`, `formatQuestionOrderSummary()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test cho chấm điểm 5 dạng (gồm Hotspot ảnh tải lên), tách ảnh từ clipboard (`Ctrl + V`), quy tắc chỉ upload Storage khi bấm Lưu, tách path & dọn ảnh cũ trong bucket khi sửa/xóa, tính tọa độ điểm/vùng Hotspot, hướng dẫn mặc định theo dạng câu hỏi, sắp xếp/cắt khoảng, chọn nhiều không liên tục, payload Supabase cha → con |
| Đồng bộ Supabase | `src/utils/supabaseClient.ts` | `uploadHotspotImageToSupabase`, `deleteHotspotImagesFromSupabase`, `fetchQuestionBankFromSupabase`, `pushQuestionBankToSupabase`, `upsertModuleOnSupabase`, `deleteModuleOnSupabase`, `syncCategoryWithParentOnSupabase`, `deleteKnowledgeCategoryOnSupabase`, `syncPartWithParentsOnSupabase`, `deleteKnowledgePartOnSupabase`, `syncQuestionWithParentsOnSupabase`, `deleteQuestionAndSyncSetsOnSupabase`, `deleteQuestionsBatchAndSyncSetsOnSupabase`, `reorderQuestionsOnSupabase`, `upsertQuestionSetOnSupabase`, `deleteQuestionSetOnSupabase` |
| Backend | `server.ts` | Các route `/api/modules*`, `/api/knowledge-categories*`, `/api/knowledge-parts*`, `/api/questions*`, `/api/question-sets*`, `/api/question-bank/import-remote` |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Luồng Quản lý Phân cấp 4 bước (Drill-down)
1. **Bước 1 — Mô-đun (Level):** Quản lý danh sách `ic3_modules` (mặc định `LV1`, `LV2`, `LV3`; cho phép thêm/sửa Mô-đun mới như `LV4`, chỉ cho xóa khi không còn nhóm/phần/câu hỏi con). Tự động gộp các `module` xuất hiện trong dữ liệu cũ dưới dạng bản ghi ảo (`virtual_mod_*`) để không bị sót.
2. **Bước 2 — Nhóm kiến thức:** Lọc theo Mô-đun đã chọn (`GM`, `OT`, hoặc mã tùy chỉnh như `TH`, `BT`). Hỗ trợ thêm/sửa/xóa Nhóm (chỉ xóa khi chưa có phần/câu hỏi).
3. **Bước 3 — Phần kiến thức (`knowledge_parts`):** Hiển thị các phần như `GM1`, `GM2`, `OT1`... kèm số lượng câu và dải thứ tự (`Câu min – Câu max`). Hỗ trợ thêm/sửa/xóa Phần (chỉ xóa khi chưa có câu hỏi).
4. **Bước 4 — Danh sách Câu hỏi theo Thứ tự (`topicOrder`):**
   - Hiển thị breadcrumb điều hướng nhanh giữa 4 tầng và nút `Quay lại`.
   - Bộ lọc kết hợp: **Tìm kiếm** (theo nội dung, tên phần/chủ đề, hoặc `"Câu 1"`, `"1"`), **Dạng câu hỏi (5 dạng)**. *(Đã loại bỏ trường và bộ lọc Độ khó).*
   - **Đổi thứ tự (`ArrowUp`/`ArrowDown`):** Hoạt động khi không bật bộ lọc, tự động chuẩn hóa lại `topicOrder` liên tiếp `1..N` và đồng bộ lên Supabase.
   - **Tạo Bộ đề nhanh theo khoảng liên tiếp:** Nhập `Từ câu ... đến câu ...` → `sliceQuestionsByOrderRange` mở sẵn Modal Tạo Bộ đề.

### 2.2. Chọn nhiều (Multi-select) & Thao tác Hàng loạt ở Bước 4
- Mỗi thẻ câu hỏi có checkbox chọn độc lập (viền nổi bật khi được chọn).
- Thanh công cụ phía trên danh sách có checkbox **Chọn tất cả** (tự chuyển trạng thái `indeterminate` khi chỉ chọn một phần câu đang hiển thị; khi đang lọc chỉ chọn/bỏ chọn các câu khớp bộ lọc hiện tại mà giữ nguyên các câu đã chọn khác trong phần).
- Khi có ít nhất 1 câu được chọn (`activeSelectedQuestions`), hiện các hành động:
  - **Tạo Bộ đề (`N` câu):** Gom các câu **không liên tục** theo đúng thứ tự `topicOrder` tăng dần (`pickQuestionsBySelectedIds`), tự sinh tiêu đề và mô tả tóm tắt (`formatQuestionOrderSummary`, VD: `"Câu 1, Câu 3, Câu 5"`), mở Modal Bộ đề để lưu.
  - **Xóa nhiều câu (`N` câu đã chọn):** Có bước xác nhận inline (*"Xác nhận xóa N câu?"* → *Xác nhận xóa* / *Hủy*), gọi `POST /api/questions/batch-delete`, xóa sạch ID câu hỏi khỏi các Bộ đề liên quan, và đồng bộ xóa + cập nhật Bộ đề lên Supabase.
  - **Bỏ chọn:** Xóa nhanh toàn bộ lựa chọn hiện tại.

### 2.3. 5 Dạng Câu hỏi IC3, Quy tắc Form Soạn & Chấm điểm (`QuestionEditorModal` + `HotspotCanvas`)
- **Quy tắc Form Tạo/Sửa Câu hỏi (`QuestionEditorModal`):**
  - Khi **tạo câu hỏi mới** từ Bước 4 của một Phần kiến thức, các ô chọn **Mô-đun IC3**, **Nhóm kiến thức** và **Phần kiến thức** được khóa (`disabled`) theo đúng ngữ cảnh đang mở.
  - Không hiển thị các ô nhập thừa gồm **Chủ đề kiến thức**, **Hướng dẫn ngắn** và **Độ khó** trên giao diện soạn câu hỏi:
    - `topic` được tự động lấy theo `title` của Phần kiến thức (`knowledge_parts`) đang quản lý trong CSDL.
    - `instruction` được gán mặc định tự động theo **Dạng câu hỏi** thông qua `getDefaultInstructionForQuestionType(type)`:
      - `single`: `"Chọn một đáp án đúng nhất."`
      - `multiple`: `"Chọn TẤT CẢ đáp án đúng."`
      - `true_false`: `"Chọn Đúng hoặc Sai cho từng ý."`
      - `matching`: `"Chọn cặp tương ứng giữa Cột A và Cột B."`
      - `hotspot`: `"Nhấp chuột trực tiếp vào vùng tương ứng trên hình."`
    - Trường `difficulty` đã được gỡ bỏ hoàn toàn khỏi mô hình dữ liệu, API và payload đồng bộ Supabase (kèm câu lệnh `ALTER TABLE public.questions DROP COLUMN IF EXISTS difficulty;` trong SQL DDL).
1. **`single` (Trắc nghiệm 1 đáp án):** Tối thiểu 2 phương án, chọn 1 `correctOptionId`.
2. **`multiple` (Trắc nghiệm nhiều đáp án):** Tối thiểu 2 phương án, chọn ≥ 1 `correctOptionIds` (chấm đúng tuyệt đối tập đáp án).
3. **`true_false` (Đúng / Sai từng ý):** Danh sách `statements`, học sinh phải chọn đúng toàn bộ các ý.
4. **`matching` (Ghép nối Cột A – B):** Tối thiểu 2 mục mỗi cột, ánh xạ `correctPairs`, phải ghép đúng toàn bộ cặp.
5. **`hotspot` (Chọn điểm trên hình):**
   - Giáo viên tải ảnh câu hỏi trực tiếp từ máy tính (`PNG`, `JPG`, `WebP`, `GIF`, tối đa `10 MB`) **hoặc nhấn `Ctrl + V` (`Cmd + V` trên macOS) ở bất kỳ đâu trong modal** để dán nhanh ảnh chụp màn hình / ảnh vừa copy từ clipboard (`extractImageFileFromClipboardData`). Khi vừa chọn/dán ảnh, hệ thống **chỉ tạo bản xem trước cục bộ (`blob:` URL) và chưa đẩy lên Supabase Storage**; nếu giáo viên đổi ảnh, xóa ảnh hoặc bấm **Hủy**, sẽ không phát sinh ảnh rác trong Bucket.
   - **Chỉ khi giáo viên bấm nút "Lưu Câu hỏi" và vượt qua kiểm tra hợp lệ** (`shouldUploadHotspotFileOnSave`: có nội dung câu hỏi, có ảnh và đã chọn điểm đúng), hệ thống mới thực hiện upload ảnh lên **Supabase Storage bucket `hotspot-images`** (qua `uploadHotspotImageToSupabase`, tự suy luận phần mở rộng từ `file.type` nếu ảnh dán từ clipboard không có đuôi file) và lưu đường dẫn `imageUrl` vào `questions.payload`. Nếu chạy offline hoặc bucket Storage chưa được khởi tạo trên Supabase, hệ thống tự nén ảnh (tối đa rộng `1400px`, định dạng WebP) lưu nhúng dạng Data URL để không gián đoạn thao tác.
   - **Tự động dọn ảnh cũ trong Bucket khi Sửa & Xóa:**
     - **Khi sửa câu hỏi và đổi sang ảnh khác** (hoặc chuyển câu hỏi Hotspot sang dạng khác), ngay sau khi bấm **Lưu Câu hỏi** thành công, hệ thống tự trích xuất đường dẫn ảnh cũ (`getObsoleteHotspotStoragePath`) và gọi `deleteHotspotImagesFromSupabase` để xóa tấm ảnh cũ khỏi bucket `hotspot-images` (nếu không còn câu hỏi nào khác dùng chung đường dẫn đó).
     - **Khi xóa 1 câu hỏi hoặc xóa hàng loạt nhiều câu hỏi Hotspot**, ngay sau khi xóa câu hỏi thành công, hệ thống gom toàn bộ đường dẫn ảnh liên quan (`collectHotspotStoragePathsToDelete`) và xóa tương ứng trong bucket `hotspot-images`.
   - Giáo viên nhấp chuột trực tiếp vào **điểm đúng** trên hình (tự động tạo tâm điểm & vùng dung sai `8% x 12%`) hoặc kéo thả chuột để khoanh vùng rộng hơn. Ảnh giữ nguyên tỷ lệ khung hình gốc để tọa độ `%` luôn khớp chính xác tuyệt đối; chấm điểm cho phép **dung sai `±1.5%`** quanh vùng/điểm đáp án.
   - Bắt buộc phải có ảnh và đã chọn ít nhất một điểm/vùng đáp án trên ảnh trước khi lưu. *(Các câu hỏi mẫu cũ vẫn hiển thị tương thích qua fallback SVG nếu chưa thay ảnh tải lên).*

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
4. **Hành vi khi lỗi Supabase cục bộ:** Nếu lưu vào `server.ts` thành công nhưng bước đồng bộ Supabase bị lỗi (VD: mất mạng hoặc thiếu RLS), hệ thống giữ bản lưu cục bộ và hiển thị thông báo Toast cảnh báo/lỗi nổi ở góc dưới bên phải màn hình (`ToastContainer`) nêu rõ nguyên nhân.

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Thao tác kéo từ Supabase (`Lấy từ Supabase` / `import-remote`) ghi đè toàn bộ 5 bảng Ngân hàng Câu hỏi cục bộ theo dữ liệu Supabase (Last-pull-wins), chưa có cơ chế merge xung đột từng bản ghi.
- Khi xóa ở giao diện mà Supabase có bản ghi cha/con cũ không đồng nhất, PostgreSQL ràng buộc `ON DELETE RESTRICT` sẽ báo lỗi để bảo vệ toàn vẹn dữ liệu.

---

## 5. Nhật ký thay đổi

- **2026-11-20 (Tự động xóa ảnh Hotspot cũ trong Bucket khi Sửa & Xóa):** Bổ sung `deleteHotspotImagesFromSupabase` cùng `getObsoleteHotspotStoragePath` và `collectHotspotStoragePathsToDelete`; tự động xóa ảnh cũ khỏi bucket `hotspot-images` ngay sau khi giáo viên đổi ảnh và ấn **Lưu Câu hỏi**, cũng như khi xóa đơn lẻ hoặc xóa hàng loạt câu hỏi.
- **2026-11-20 (Trì hoãn upload Storage tới lúc bấm "Lưu Câu hỏi"):** Sửa quy trình Hotspot để ảnh chọn từ máy hoặc dán `Ctrl + V` chỉ xem trước cục bộ (`pendingHotspotFile` + `blob:` preview), chỉ tải lên bucket `hotspot-images` trên Supabase Storage sau khi giáo viên bấm **Lưu Câu hỏi** và form hợp lệ (`shouldUploadHotspotFileOnSave`), tránh sinh file rác khi đổi ảnh hoặc hủy soạn.
- **2026-11-20 (Hỗ trợ dán ảnh trực tiếp `Ctrl + V` cho Hotspot):** Bổ sung trình lắng nghe `paste` toàn modal khi đang soạn câu hỏi Hotspot (`extractImageFileFromClipboardData`), cho phép dán trực tiếp ảnh chụp màn hình từ clipboard (hoạt động song song với nút tải ảnh).
- **2026-11-20 (Nâng cấp Hotspot tải ảnh thật):** Chuyển dạng câu hỏi Hotspot sang luồng giáo viên tải ảnh từ máy tính (lưu lên Supabase Storage bucket `hotspot-images` hoặc nén nhúng khi offline), sau đó nhấp/khoanh trực tiếp điểm đúng trên ảnh giữ đúng tỷ lệ gốc để lưu `imageUrl` + tọa độ `hotspotTarget` vào `questions.payload`.
- **2026-11-20 (Cập nhật Form Tạo Câu hỏi):** Khóa chọn Mô-đun/Nhóm/Phần kiến thức khi tạo câu hỏi mới trong một Phần; bỏ hiển thị ô Chủ đề kiến thức (lấy từ `knowledge_parts`), ô Hướng dẫn ngắn (tự gán mặc định theo `Dạng câu hỏi`) và gỡ bỏ hoàn toàn trường/bộ lọc `Độ khó` (`difficulty`) khỏi giao diện, API và SQL DDL (`DROP COLUMN IF EXISTS difficulty`).
- **2026-11-20:** Hoàn thiện tính năng chọn nhiều (Chọn tất cả, tạo Bộ đề không liên tục, xóa hàng loạt đồng bộ Supabase) và modal loading toàn màn hình khi thao tác với Supabase.
- **Trước 2026-11-20:** Xây dựng cấu trúc 4 tầng (`ic3_modules` → `knowledge_categories` → `knowledge_parts` → `questions`), đồng bộ CRUD 2 chiều live với auto-ensure parent và sửa lỗi RLS/Schema Visualizer trên Supabase.
