# Tính năng 02: Tổng quan Dashboard

**Trạng thái:** Đã hoàn thành  
**Cập nhật lần cuối:** 2026-11-20

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/OverviewView.tsx` | Component `OverviewView` |
| Logic thuần | `src/utils/ic3Rules.ts` | `isStudentBreakUnlocked()`, `formatDuration()` |
| Điều phối | `src/App.tsx` | Truyền `db`, `scopedSchoolId`, `onNavigate` khi `activeTab === 'overview'` |

---

## 2. Mô tả Nghiệp vụ & Giao diện

Tab **Tổng quan** là màn hình mặc định ngay sau khi đăng nhập, cung cấp bức tranh nhanh về tình hình học tập theo đúng phạm vi trường học của tài khoản đang đăng nhập (`scopedSchoolId`):

### 2.1. Dải 4 Thẻ Chỉ số (KPI Strip)
1. **Học sinh đang quản lý:** Tổng số học sinh thuộc các lớp trong phạm vi (`visibleStudents.length`), kèm số lớp và số trường (`1 trường` nếu là `teacher`, hoặc tổng số trường nếu là `super_admin`).
2. **Ngân hàng câu hỏi IC3:** Tổng số câu hỏi (`db.questions.length`) và số bộ đề (`db.questionSets.length`).
3. **Điểm trung bình lượt nộp:** Trung bình cộng điểm thang 1000 của tất cả lượt nộp trong phạm vi (`visibleSubmissions`), kèm tỷ lệ đạt chuẩn `score >= 700` (số lượt đạt / tổng số lượt).
4. **Phòng Thi đấu Realtime:** Số lớp trong phạm vi đang bật nút Thi đấu (`battleConfigs` có `isEnabled === true`).

### 2.2. Khu vực Theo dõi Chi tiết (Split 7/5)
- **Tiến độ Bài tập & Mở khóa Giải lao theo Lớp (7 cột):**
  - Liệt kê từng lớp trong phạm vi kèm tên trường, sĩ số, số nhiệm vụ đã giao, số phút thưởng giải lao và trạng thái nút Thi đấu (`Đang bật` / `Tắt`).
  - Tính tỷ lệ `%` học sinh đã mở khóa giờ giải lao (`isStudentBreakUnlocked(taskCfg.tasks, db.submissions, st.id)`) và hiển thị thanh tiến độ trực quan.
  - Có nút chuyển nhanh sang tab **Giao Bài tập Lớp**.
- **Lượt nộp bài gần nhất (5 cột):**
  - Hiển thị tối đa **6 lượt nộp mới nhất** (`visibleSubmissions.slice(0, 6)`), gồm tên học sinh, tên lớp, tên nhiệm vụ, lần làm (`attemptNumber/requiredAttempts`), thời lượng làm bài (`formatDuration`), điểm và trạng thái `Đạt chuẩn` / `Dưới sàn {minScore}`.
  - Có nút chuyển nhanh sang tab **Thống kê & Báo cáo**.

---

## 3. Quy tắc & Ràng buộc Xử lý

- Nếu tài khoản là `teacher`, chỉ các lớp thuộc `schoolId` của giáo viên đó mới được tính vào KPI, danh sách tiến độ lớp và lượt nộp gần nhất.
- Thẻ KPI *Điểm trung bình* lấy mốc `>= 700` để tính tỷ lệ đạt chuẩn IC3 chung; trong khi danh sách *Lượt nộp bài gần nhất* dùng `sub.metMinScore` (so với `minScore` cấu hình riêng của từng nhiệm vụ).

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Chưa tự động kéo lượt nộp mới (`student_task_submissions`) và trạng thái giải lao (`student_break_states`) từ Supabase khi mở app; hiện chỉ tự kéo 5 bảng Ngân hàng Câu hỏi.

---

## 5. Nhật ký thay đổi

- **2026-11-20:** Rà soát và tách tài liệu mô tả riêng cho tab Tổng quan Dashboard.
