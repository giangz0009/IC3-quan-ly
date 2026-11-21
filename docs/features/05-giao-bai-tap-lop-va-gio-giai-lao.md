# Tính năng 05: Giao Bài tập Lớp & Mở khóa Giờ Giải lao

**Trạng thái:** Đã hoàn thành  
**Cập nhật lần cuối:** 2026-11-20

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/ClassTasksView.tsx` | Thẻ tóm tắt cấu hình đợt bài tập & danh sách nhiệm vụ, Modal Box Sửa Thông tin chung, Modal Box Thêm/Sửa Nhiệm vụ, bảng theo dõi tiến độ & trạng thái giải lao từng học sinh |
| Logic thuần | `src/utils/ic3Rules.ts` | `calculateIC3Score()`, `evaluateTaskCompletion()`, `isStudentBreakUnlocked()`, `formatDuration()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test tính điểm 0–1000 & điều kiện mở khóa giải lao theo số lượt và điểm sàn |
| API Client | `src/utils/api.ts` | `saveClassTaskConfig()` |
| Backend | `server.ts` | `PUT /api/class-tasks/:classId`, `POST /api/submissions` |

---

## 2. Mô tả Nghiệp vụ & Giao diện

Tab **Giao Bài tập Lớp** cho phép giáo viên thiết kế lộ trình bài tập bắt buộc cho từng lớp (lọc theo quyền `scopedClasses`) và gắn phần thưởng giờ giải lao:

### 2.1. Cấu hình Chung của Đợt Bài tập (`ClassTaskConfig`)
- Chọn **Lớp giao bài** từ dropdown (tên lớp + tên trường).
- Hiển thị thẻ tóm tắt và bấm **Sửa Thông tin chung** để mở Modal Box chỉnh sửa:
  - **Tiêu đề đợt bài tập** (`assignmentTitle`, hiển thị trên trang chủ học sinh).
  - **Giáo viên giao bài** (`teacherName`).
  - **Thưởng Giải lao khi đạt 100%** (`breakRewardMinutes`, từ `0` đến `120` phút).

### 2.2. Danh sách Nhiệm vụ (`ClassTaskItem[]`)
- Bấm **Thêm Nhiệm vụ** hoặc bấm **Sửa** trên từng thẻ nhiệm vụ để mở Modal Box nhập/chỉnh sửa cấu hình, kèm sắp xếp thứ tự (`ArrowUp` / `ArrowDown` để cập nhật `orderIndex`) hoặc xóa nhiệm vụ.
- Mỗi nhiệm vụ hỗ trợ **Áp nhanh từ Bộ đề** (`db.questionSets`) để điền tự động `title`, `level`, `category`, `contentCode`, `questionIds`, hoặc tự chỉnh tay:
  - **Chế độ làm bài (`quizMode`):** `Luyện tập (practice)` hoặc `Thi thử (exam)`.
  - **Cấp độ (`level`), Nhóm (`category`), Mã nội dung (`contentCode`), Bộ lọc Mô-đun (`moduleFilter`).**
  - **Số lượt yêu cầu (`requiredAttempts`, 1–20):** Số lượt nộp phải đạt chuẩn.
  - **Điểm sàn (`minScore`, 0–1000, bước nhảy 50):** Điểm tối thiểu để một lượt nộp được tính là đạt yêu cầu.
  - **Thời gian dự kiến (`estimatedMinutes`)** & **Mô tả hướng dẫn (`description`)**.

### 2.3. Bảng Theo dõi Hoàn thành & Trạng thái Giải lao
- Liệt kê toàn bộ học sinh của lớp đang chọn với các cột: `Mã HS`, `Họ và tên`, `Tiến độ nhiệm vụ` (`completedTasks/totalTasks`), `Điểm cao nhất`, và `Khu vực Giải lao`:
  - `Luôn mở (Demo)` nếu học sinh bật cờ `alwaysBreakReady`.
  - `Đang mở (<thời gian còn lại>)` nếu đã đạt 100% nhiệm vụ (`isStudentBreakUnlocked`).
  - `Đang khóa` nếu chưa hoàn thành đủ nhiệm vụ.

---

## 3. Quy tắc & Ràng buộc Xử lý

1. **Đánh giá hoàn thành nhiệm vụ (`evaluateTaskCompletion`):**
   - Lọc các bản ghi trong `db.submissions` khớp `(studentId, taskId)`.
   - Chỉ các lượt có `score >= task.minScore` mới được tính vào `qualifyingAttempts`.
   - Nhiệm vụ hoàn thành khi `qualifyingAttempts >= task.requiredAttempts`.
2. **Điều kiện mở khóa Giải lao (`isStudentBreakUnlocked`):**
   - Nếu lớp chưa có nhiệm vụ nào (`tasks.length === 0`) → trả về `false`.
   - Phải hoàn thành **tất cả 100%** nhiệm vụ của lớp (`tasks.every(...completed)`).
3. **Cập nhật tự động khi học sinh nộp bài (`POST /api/submissions`):**
   - Server tự tính điểm thang 1000: `Math.round((correct / total) * 1000)`, gán `attemptNumber` và `metMinScore = score >= task.minScore`.
   - Ngay khi `isStudentBreakUnlocked` chuyển sang `true`, server tự cập nhật/tạo bản ghi `breakStates` với `status = 'active'`, `totalGrantedSeconds = breakRewardMinutes * 60`, `remainingSeconds = grantedSeconds`.

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Khi nhấn *"Lưu Cấu hình Lớp"*, dữ liệu chỉ mới lưu vào Local DB (`PUT /api/class-tasks/:classId`); để học sinh thấy trên Supabase cần sang tab **Kết nối Supabase** bấm *"Đồng bộ Dữ liệu lên Supabase"* (chưa đồng bộ live 2 chiều như Ngân hàng Câu hỏi).
- Giao diện chưa có modal chỉnh sửa danh sách `questionIds` lẻ trực tiếp bên trong từng nhiệm vụ nếu không chọn từ Bộ đề có sẵn (mặc định khi nhấn *Thêm Nhiệm vụ* sẽ lấy Bộ đề đầu tiên hoặc 5 câu đầu).

---

## 5. Nhật ký thay đổi

- **2026-11-21 (Modal Box Thêm/Sửa):** Chuyển phần chỉnh sửa Thông tin chung đợt bài tập và Thêm/Sửa từng Nhiệm vụ sang Modal Box đồng nhất, hiển thị thẻ tóm tắt gọn trên giao diện chính.
- **2026-11-20:** Rà soát và tài liệu hóa chi tiết cấu hình nhiệm vụ lớp và logic mở khóa giờ giải lao.
