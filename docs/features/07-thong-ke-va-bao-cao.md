# Tính năng 07: Thống kê & Báo cáo Xuất Excel (CSV)

**Trạng thái:** Đã hoàn thành  
**Cập nhật lần cuối:** 2026-11-20

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/ReportsView.tsx` | Bộ lọc Lớp & Trạng thái, bảng Tổng hợp Thành tích Học sinh, bảng Chi tiết Lịch sử Nộp bài, danh sách Trận Thi đấu đã kết thúc, nút Xuất CSV |
| Logic thuần | `src/utils/ic3Rules.ts` | `formatSubmissionsToCsv()`, `formatDuration()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test xuất CSV kiểm tra UTF-8 BOM (`\uFEFF`) và xử lý ký tự đặc biệt/dấu phẩy tiếng Việt |

---

## 2. Mô tả Nghiệp vụ & Giao diện

Tab **Thống kê & Báo cáo** cung cấp góc nhìn tổng hợp và chi tiết về kết quả luyện thi và thi đấu theo phạm vi trường của tài khoản (`scopedSchoolId`):

### 2.1. Thanh Lọc & Xuất Báo cáo
- **Lọc theo Lớp:** `Tất cả các lớp` (trong phạm vi quản lý) hoặc chọn 1 lớp cụ thể.
- **Lọc theo Trạng thái đạt chuẩn:** `Tất cả lượt` / `Đạt điểm sàn` (`metMinScore === true`) / `Chưa đạt` (`metMinScore === false`).
- **Nút "Xuất CSV (Excel)":** Tải xuống file `ic3-bao-cao-diem-YYYY-MM-DD.csv` chứa đúng danh sách lượt nộp đang được lọc (`filteredSubmissions`). Nút tự động khóa nếu không có dữ liệu lọc.

### 2.2. Ba Khối Dữ liệu Chính
1. **Tổng hợp Thành tích Học sinh:** Gom nhóm theo từng `studentId`, sắp xếp theo **Điểm cao nhất giảm dần**, hiển thị: Mã HS, Họ tên, Lớp, Số lượt làm, Số lượt đạt chuẩn (`qualifying/attempts`), Điểm cao nhất, Điểm trung bình (`Math.round(totalScore / attempts)`), Thời gian trung bình (`formatDuration`).
2. **Chi tiết Lịch sử Nộp bài:** Liệt kê từng lượt nộp với lần làm (`attemptNumber/requiredAttempts`), số câu đúng/tổng, điểm thang 1000, thời lượng và nhãn `Đạt (≥minScore)` / `Chưa đạt (minScore)`.
3. **Lịch sử Các trận Thi đấu đã Kết thúc:** Lọc các `battleRooms` có `status === 'finished'` theo lớp và phạm vi trường, hiển thị thời điểm kết thúc và Top 3 xếp hạng kèm phút giải lao đã thưởng.

---

## 3. Quy tắc & Ràng buộc Xử lý

1. **Định dạng CSV chuẩn Excel (`formatSubmissionsToCsv`):**
   - Bắt đầu chuỗi bằng ký tự **UTF-8 BOM (`\uFEFF`)** và phân tách dòng `\r\n` để Microsoft Excel mở trực tiếp không bị lỗi font tiếng Việt.
   - Bọc dấu ngoặc kép và escape `""` cho các ô chứa dấu phẩy, ngoặc kép hoặc xuống dòng (`escapeCsvCell`).
   - Gồm 12 cột: `Mã học sinh`, `Họ và tên`, `Lớp`, `Nhiệm vụ`, `Lần làm`, `Điểm (1000)`, `Số câu đúng`, `Tổng số câu`, `Điểm sàn`, `Đạt chuẩn`, `Thời gian (giây)`, `Thời điểm nộp`.
2. **Phân quyền xem:** Giáo viên trường chỉ lọc và xuất được dữ liệu của các lớp thuộc trường mình.

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Chưa có bộ lọc theo khoảng thời gian (từ ngày – đến ngày) hoặc tìm kiếm theo tên/mã một học sinh cụ thể ngay trong bảng báo cáo.
- Dữ liệu `submissions` và `battleRooms` hiện đọc từ Local DB (`server.ts`); chưa có nút kéo dữ liệu bài làm mới từ Supabase `student_task_submissions` về tab Báo cáo.

---

## 5. Nhật ký thay đổi

- **2026-11-20:** Rà soát và tài liệu hóa đầy đủ tính năng Thống kê & Xuất CSV.
