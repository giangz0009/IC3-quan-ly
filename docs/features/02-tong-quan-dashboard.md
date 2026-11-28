# Tính năng 02: Tổng quan Dashboard

**Trạng thái:** Đã hoàn thành  
**Cập nhật lần cuối:** 2026-11-24

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/OverviewView.tsx` | Component `OverviewView` |
| Logic thuần | `src/utils/ic3Rules.ts` | `isStudentBreakUnlocked()`, `formatDuration()` |
| Điều phối | `src/App.tsx` | Truyền `db`, `scopedSchoolId`, `onNavigate` khi `activeTab === 'overview'` |

---

## 2. Mô tả Nghiệp vụ & Giao diện

Tab **Tổng quan** là màn hình mặc định ngay sau khi đăng nhập, cung cấp bức tranh nhanh về tình hình học tập của **toàn bộ các trường và lớp** trong hệ thống (`scopedSchoolId = null` đối với mọi cấp giáo viên LV1, LV2 và Master):

### 2.1. Dải 4 Thẻ Chỉ số (KPI Strip)
1. **Học sinh đang quản lý:** Tổng số học sinh thuộc các lớp trong hệ thống (`visibleStudents.length`), kèm tổng số lớp và tổng số trường.
2. **Ngân hàng câu hỏi IC3:** Tổng số câu hỏi (`db.questions.length`) và số bộ đề (`db.questionSets.length`).
3. **Điểm trung bình lượt nộp:** Trung bình cộng điểm thang 1000 của tất cả lượt nộp trong phạm vi (`visibleSubmissions`), kèm tỷ lệ đạt chuẩn `score >= 700` (số lượt đạt / tổng số lượt).
4. **Phòng Thi đấu Realtime:** Số lớp trong hệ thống đang bật nút Thi đấu (`battleConfigs` có `isEnabled === true`).

### 2.2. Khu vực Theo dõi Chi tiết (Split 7/5)
- **Tiến độ Bài tập & Mở khóa Giải lao theo Lớp (7 cột):**
  - Liệt kê từng lớp kèm tên trường, sĩ số, số nhiệm vụ đã giao, số phút thưởng giải lao và trạng thái nút Thi đấu (`Đang bật` / `Tắt`).
  - Tính tỷ lệ `%` học sinh đã mở khóa giờ giải lao (`isStudentBreakUnlocked(taskCfg.tasks, db.submissions, st.id)`) và hiển thị thanh tiến độ trực quan.
  - Có nút chuyển nhanh sang tab **Giao Bài tập Lớp**.
- **Lượt nộp bài gần nhất (5 cột):**
  - Hiển thị tối đa **6 lượt nộp mới nhất** (`visibleSubmissions.slice(0, 6)`), gồm tên học sinh, tên lớp, tên nhiệm vụ, lần làm (`attemptNumber/requiredAttempts`), thời lượng làm bài (`formatDuration`), điểm và trạng thái `Đạt chuẩn` / `Dưới sàn {minScore}`.
  - Có nút chuyển nhanh sang tab **Thống kê & Báo cáo**.

---

## 3. Quy tắc & Ràng buộc Xử lý

- Cả 3 cấp giáo viên (LV1, LV2, Master) đều theo dõi được dữ liệu toàn hệ thống trên tất cả các trường (`scopedSchoolId = null`).
- Thẻ KPI *Điểm trung bình* lấy mốc `>= 700` để tính tỷ lệ đạt chuẩn IC3 chung; trong khi danh sách *Lượt nộp bài gần nhất* dùng `sub.metMinScore` (so với `minScore` cấu hình riêng của từng nhiệm vụ).

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Số liệu hiển thị được nạp qua `GET /api/bootstrap` trực tiếp từ 17 bảng Supabase tại thời điểm mở/làm mới dữ liệu (bao gồm `student_task_submissions`, `student_break_states`, `battle_rooms`); chưa tự động đăng ký WebSocket realtime liên tục trên màn hình Tổng quan (cần nhấn làm mới hoặc chuyển tab để cập nhật lượt nộp mới nhất từ học sinh).

---

## 5. Nhật ký thay đổi

- **2026-11-24:** Cập nhật tài liệu phản ánh dữ liệu Tổng quan được đọc trực tiếp từ 17 bảng Supabase qua `server/supabaseStore.ts` (`GET /api/bootstrap`).
- **2026-11-21:** Cập nhật mô hình tổng quan liên trường thống nhất cho cả 3 cấp giáo viên (LV1, LV2, Master).
- **2026-11-20:** Rà soát và tách tài liệu mô tả riêng cho tab Tổng quan Dashboard.
