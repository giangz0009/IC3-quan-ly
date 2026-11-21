# Tính năng 06: Điều phối Thi đấu Realtime (Battle Arena)

**Trạng thái:** Đã hoàn thành lõi điều phối + mô phỏng trên server  
**Cập nhật lần cuối:** 2026-11-20

---

## 1. Mã nguồn liên quan

| Lớp | File | Thành phần / Hàm chính |
|---|---|---|
| Frontend | `src/components/BattleControlView.tsx` | Chọn lớp, công tắc bật/tắt nút Thi đấu, thẻ tóm tắt & Modal Box chỉnh sửa cấu hình luật, bảng xếp hạng Live & Nhật ký Sự kiện Realtime |
| Logic thuần | `src/utils/ic3Rules.ts` | `calculateIC3Score()`, `rankBattleParticipants()`, `formatDuration()` |
| Kiểm thử | `src/utils/ic3Rules.test.ts` | Unit test xếp hạng ưu tiên Điểm giảm dần → Thời gian tăng dần & trao thưởng Top X |
| API Client | `src/utils/api.ts` | `saveBattleConfig`, `createBattleRoom`, `joinBattleRoom`, `startBattleRoom`, `simulateBattleStep`, `finishBattleRoom`, `resetBattleRoom` |
| Backend | `server.ts` | Các route `/api/battle-configs/:classId` và `/api/battle-rooms*` |

---

## 2. Mô tả Nghiệp vụ & Giao diện

Tab **Thi đấu Realtime** là phòng điều khiển cho phép giáo viên thuộc nhóm **GV Chuyên môn (`teacher_lv2`)** và **Giáo viên Master (`master`)** tổ chức giải đấu tốc độ cho **bất kỳ lớp nào trên tất cả các trường** trong hệ thống *(tài khoản **GV Giảng dạy `teacher_lv1`** không thấy tab này và bị chặn `403` trên toàn bộ API `/api/battle-*`)*:

### 2.1. Công tắc Tổng & Cấu hình Luật (`ClassBattleConfig`)
- **Nút Thi đấu Học sinh (ĐANG BẬT / ĐANG KHÓA):** Lưu nhanh cờ `isEnabled` để mở hoặc khóa nút vào đấu trường bên ứng dụng học sinh.
- **Cấu hình giải đấu (Modal Box qua nút *Chỉnh sửa Cấu hình*):**
  - **Tên giải đấu lớp (`title`)**, **Giáo viên tổ chức (`teacherName`)**, **Bộ đề thi đấu (`questionSetId` → nạp `questionIds`)**.
  - **Thời gian trận (`timeLimitSeconds`):** tối thiểu 30 giây (mặc định 300s).
  - **Ngưỡng Combo 2 câu (`fastComboWindowSeconds`):** tối thiểu 5 giây (mặc định 15s).
  - **Số hạng Top X nhận thưởng (`topRewardCount`):** tối thiểu 1 (mặc định Top 3).
  - **Thưởng giải lao Top X (`breakRewardMinutes`):** số phút giải lao cộng thêm cho người chiến thắng.

### 2.2. Vòng đời Phòng Thi đấu (`lobby` → `playing` → `finished`)
1. **Tạo phòng (`POST /api/battle-rooms`):** Tạo phòng mới ở trạng thái `lobby` kèm `configSnapshot` tại thời điểm mở phòng. Nếu đang có phòng `lobby` hoặc `playing`, nút thao tác điều khiển phòng đó sẽ hiển thị ưu tiên.
2. **Phòng chờ (`lobby`):** Giáo viên có thể thêm học sinh của lớp vào phòng (`joinBattleRoom`), sau đó bấm **"Bắt đầu Trận đấu"** (`startBattleRoom`, thiết lập `startedAt` và `endsAt`).
3. **Đang thi đấu (`playing`):**
   - Hiển thị bảng xếp hạng trực tiếp theo thời gian thực: Hạng, Học sinh, Tiến độ (`answeredCount/total`, số câu đúng), Điểm (thang 1000), Thời gian, Số Khiên (`shieldCharges`) và Debuff đang dính.
   - Cột phải hiển thị **Nhật ký Sự kiện Realtime** (`activeRoom.events`, tối đa 40 sự kiện gần nhất).
   - Nút **"Mô phỏng lượt trả lời"** (`simulateBattleStep`) để giáo viên chạy thử kịch bản thi đấu ngay trên dashboard (mỗi bước cho học sinh trả lời tối đa 2 câu, tính combo nhanh, kích hoạt khiên hoặc tung thẻ tấn công, tự động kết thúc trận khi 100% học sinh làm xong).
   - Nút **"Kết thúc & Trao giải"** (`finishBattleRoom`) để chốt kết quả ngay lập tức.
4. **Đã kết thúc (`finished`):**
   - Hiển thị **Bảng Vinh Danh Kết Quả Chung Cuộc** (Top 3) kèm số phút giải lao thưởng.
   - Cho phép bấm **Reset** (`resetBattleRoom`) để đưa phòng và toàn bộ điểm/khiên/debuff về trạng thái `lobby` ban đầu.

---

## 3. Quy tắc & Ràng buộc Xử lý

1. **Phân quyền tổ chức (`requireRoles('teacher_lv2', 'master')`):** Tài khoản `teacher_lv1` bị ẩn tab trên giao diện và bị chặn `403 Forbidden` ở mọi route `/api/battle-configs/:classId` và `/api/battle-rooms*`.
2. **Quy tắc xếp hạng (`rankBattleParticipants`):**
   - Sắp xếp theo: `score` giảm dần → `durationSeconds` tăng dần → `correctCount` giảm dần.
   - Các học sinh có `rank <= topRewardCount` được gán `rewardedBreakMinutes = config.breakRewardMinutes`, các hạng sau nhận `0`.
3. **Cộng dồn Giờ Giải lao khi kết thúc (`finishBattleRoom`):**
   - Với mỗi thí sinh có `rewardedBreakMinutes > 0`, server cộng thêm `rewardedBreakMinutes * 60` giây vào `totalGrantedSeconds` và `remainingSeconds` trong `db.breakStates` và đặt `status = 'active'`.
4. **Cơ chế Thẻ Kỹ năng (trong `simulate-step`):**
   - Khi trả lời đúng 2 câu liên tiếp trong `<= fastComboWindowSeconds`: có thể nhận **Thẻ Phòng Thủ (`+2 Khiên`)** hoặc tung **Thẻ Tấn Công** hiệu lực **6 giây** gồm 4 loại: `blur` (làm mờ), `frost` (đóng băng), `reverse` (đảo ngược phương án), `shake` (rung lắc).
   - Nếu mục tiêu còn `shieldCharges > 0`, đòn tấn công bị chặn (`shieldCharges - 1`, ghi nhận `attacksBlocked + 1` và event `blocked`).

---

## 4. Hạn chế hiện tại & Hướng phát triển

- Trạng thái phòng đấu (`battle_rooms`), thí sinh (`battle_participants`) và nhật ký sự kiện (`battle_events`) hiện đang chạy và mô phỏng trên **Express Local DB (`server.ts`)**; chưa nối luồng Supabase Realtime (`postgres_changes` / channel subscription) để đồng bộ trực tiếp từ trình duyệt học sinh thật.
- Cấu hình giải đấu (`class_battle_configs`) được đẩy lên Supabase thông qua nút đồng bộ tổng ở tab Kết nối Supabase, chưa đẩy tự động tức thì khi bấm *"Lưu Cấu hình"* hoặc bật/tắt công tắc.
- Trong `server.ts`, phần tự động kết thúc khi mọi người hoàn thành ở `simulate-step` cập nhật `rankedResults` nhưng đoạn cộng `breakStates` hiện nằm ở endpoint `POST /api/battle-rooms/:roomId/finish` (cần cân nhắc gộp logic cộng thưởng vào hàm dùng chung nếu chạy auto-finish thật).

---

## 5. Nhật ký thay đổi

- **2026-11-21 (Modal Box Cấu hình Thi đấu):** Chuyển form *Cấu hình Luật & Bộ đề Thi đấu* sang Modal Box qua nút **Chỉnh sửa Cấu hình**, hiển thị thẻ tóm tắt thông số trận đấu trên giao diện chính.
- **2026-11-21:** Mở phạm vi tổ chức Thi đấu cho mọi lớp trên tất cả các trường; giới hạn quyền tổ chức cho **GV Chuyên môn (LV2)** và **Giáo viên Master** (chặn LV1 cả UI lẫn API).
- **2026-11-20:** Rà soát và tài liệu hóa toàn bộ vòng đời phòng thi đấu, luật Combo/Khiên/Debuff và giới hạn đồng bộ Realtime hiện tại.
