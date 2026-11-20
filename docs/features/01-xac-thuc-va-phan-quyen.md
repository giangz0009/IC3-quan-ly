# Tính năng 01: Xác thực & Phân quyền Giáo viên

**Trạng thái:** Đã hoàn thành (cục bộ)  
**Cập nhật lần cuối:** 2026-11-20

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/AuthScreen.tsx` | Form đăng nhập, nút truy cập nhanh tài khoản mẫu, nút đổi giao diện Sáng/Tối |
| Frontend | `src/App.tsx` | Lưu phiên đăng nhập (`sessionStorage`), hỗ trợ `?autostart=1`, truyền `scopedSchoolId` theo role |
| Frontend | `src/components/SchoolsStudentsView.tsx` | Bảng *"Phân quyền Giáo viên"* dành riêng cho `super_admin` |
| Backend | `server.ts` | `POST /api/auth/login`, `POST /api/teachers`, `DELETE /api/teachers/:userId`, `sanitizeTeachers()` |
| Dữ liệu | `src/data/seedData.ts` | 2 tài khoản giáo viên mẫu + bảng `public.admin_teachers` trong SQL DDL |

---

## 2. Mô tả Nghiệp vụ & Giao diện

### 2.1. Đăng nhập (`AuthScreen.tsx`)
- Khi chưa có phiên hợp lệ trong `sessionStorage` (key `ic3_admin_teacher_session`), ứng dụng hiển thị màn hình giới thiệu hệ thống và thẻ đăng nhập Email + Mật khẩu.
- Hỗ trợ 2 nút **Truy cập nhanh tài khoản mẫu** để kiểm thử ngay:
  - **Super Admin (Toàn hệ thống):** `admin@ic3master.edu.vn` / `admin123` (`role: 'super_admin'`, `schoolId: null`).
  - **Giáo viên Trường (THCS Nguyễn Du):** `ha.tran@nguyendu.edu.vn` / `teacher123` (`role: 'teacher'`, `schoolId: 'school_nd'`).
- Hỗ trợ tham số URL `?autostart=1` (`App.tsx`) để tự động đăng nhập tài khoản Super Admin khi kiểm thử tự động hoặc mở nhanh.
- Hỗ trợ chuyển đổi giao diện Sáng / Tối (`localStorage` key `ic3_admin_theme`).

### 2.2. Phạm vi Phân quyền (RBAC)
- **`super_admin`:**
  - Xem và quản lý toàn bộ Trường, Lớp, Học sinh, Báo cáo của mọi trường (`scopedSchoolId = null`).
  - Được quyền thêm/xóa Trường học và mở panel **Phân quyền Giáo viên** để cấp mới hoặc xóa tài khoản giáo viên khác (không thể tự xóa chính mình trên UI; server chặn xóa Super Admin cuối cùng).
- **`teacher`:**
  - Chỉ nhìn thấy và thao tác trong phạm vi trường được gán (`schoolId`). Các tab *Tổng quan*, *Trường & Học sinh*, *Giao Bài tập Lớp*, *Thi đấu Realtime*, *Thống kê & Báo cáo* đều tự động lọc lớp theo `schoolId`.
  - Không thấy nút *"Thêm Trường học"*, nút xóa trường và panel *"Phân quyền Giáo viên"*.

---

## 3. Quy tắc & Ràng buộc Xử lý

1. Email đăng nhập được so khớp không phân biệt hoa/thường (`email.trim().toLowerCase()`).
2. `GET /api/bootstrap` dùng `sanitizeTeachers()` để loại bỏ trường `password` trước khi gửi về frontend (`SafeTeacher`).
3. Khi tạo giáo viên mới (`POST /api/teachers`):
   - Kiểm tra trùng email (không phân biệt hoa/thường).
   - Nếu `role === 'teacher'`, bắt buộc phải gán `schoolId` của một trường cụ thể.
4. Khi xóa giáo viên (`DELETE /api/teachers/:userId`): không cho phép xóa nếu đó là tài khoản `super_admin` duy nhất còn lại.

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Mật khẩu giáo viên hiện lưu dạng plain text trong `data/ic3_admin_db.json` và xác thực qua Express API cục bộ; chưa tích hợp Supabase Auth (`auth.users` + `public.admin_teachers`).
- Phiên đăng nhập lưu bằng `sessionStorage` (mất khi đóng tab trình duyệt), chưa dùng HTTP-only session cookie hay JWT.

---

## 5. Nhật ký thay đổi

- **2026-11-20:** Rà soát và tài liệu hóa đầy đủ luồng đăng nhập, `?autostart=1` và phạm vi phân quyền `super_admin` / `teacher`.
