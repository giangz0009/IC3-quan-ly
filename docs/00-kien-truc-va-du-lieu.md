# Kiến trúc Hệ thống, Mô hình Dữ liệu & API

**Cập nhật lần cuối:** 2026-11-20  
**File nguồn liên quan:** `server.ts`, `src/types/ic3.ts`, `src/data/seedData.ts`, `src/utils/api.ts`, `src/utils/supabaseClient.ts`

---

## 1. Kiến trúc Lưu trữ & Luồng Dữ liệu Lai (Hybrid Persistence)

Ứng dụng vận hành theo mô hình **2 lớp dữ liệu**:

1. **Lớp máy chủ cục bộ (`Express` + `data/ic3_admin_db.json`)**:
   - Toàn bộ thao tác trên giao diện Admin gọi qua `src/utils/api.ts` tới REST API `/api/*` của `server.ts`.
   - Khi khởi động (`ensureDb()`), nếu chưa có `data/ic3_admin_db.json`, server tự sinh dữ liệu mẫu từ `createSeedDatabase()` (`src/data/seedData.ts`); nếu có dữ liệu cũ thiếu `modules`, `knowledgeCategories`, `knowledgeParts`, `contentCode` hoặc `topicOrder`, server tự bù migration nhẹ và lưu lại.
   - Ghi file an toàn theo cơ chế atomic write (`ic3_admin_db.json.tmp` → `fs.renameSync`).

2. **Lớp đám mây (`Supabase PostgreSQL`)**:
   - Trình duyệt khởi tạo `SupabaseClient` trực tiếp qua `Project URL` và `Anon Key` lưu trong `localStorage` (`ic3_admin_supabase_url`, `ic3_admin_supabase_anon_key`).
   - Toàn bộ **16 bảng vận hành** đều được bật RLS với policy cho phép `anon` và `authenticated` thao tác (`select, insert, update, delete`), phục vụ dùng chung với ứng dụng Học sinh.
   - Riêng phân hệ **Ngân hàng Câu hỏi** có cơ chế đồng bộ 2 chiều trực tiếp (kéo về lúc khởi động và đẩy từng thay đổi CRUD ngay lập tức khi tùy chọn `ic3_admin_supabase_qb_live` đang bật). Các phân hệ Trường/Lớp/Học sinh/Bài tập/Cấu hình thi đấu đồng bộ đẩy lên qua nút *"Đồng bộ Dữ liệu lên Supabase"*.

```text
[React UI] ──(1) API /api/*──▶ [Express server.ts] ──▶ [data/ic3_admin_db.json]
    │
    └──(2) @supabase/supabase-js (trực tiếp từ trình duyệt, bọc qua trackSupabaseCall)
            └──▶ [Supabase PostgreSQL (public.*)]
```

---

## 2. Mô hình Dữ liệu TypeScript (`src/types/ic3.ts`)

### 2.1. Tổ chức & Tài khoản
- **`School`**: `{ id, name, district, createdAt }`
- **`SchoolClass`**: `{ id, schoolId, name, grade, createdAt }`
- **`StudentProfile`**: `{ id, classId, fullName, studentCode, passwordHash, isCustomPassword, alwaysBreakReady, createdAt }`
- **`AdminTeacher`**: `{ userId, fullName, email, password, role: 'super_admin' | 'teacher', schoolId: string | null, createdAt }` *(kiểu `SafeTeacher` ở frontend lược bỏ trường `password`)*.

### 2.2. Ngân hàng Câu hỏi 4 tầng & Bộ đề
- **`IC3ModuleRecord`**: `{ id, code, level, title, description, orderIndex }` *(mặc định có `computing_fundamentals` [LV1], `key_applications` [LV2], `living_online` [LV3]; cho phép thêm tùy biến)*.
- **`KnowledgeCategoryRecord`**: `{ id, module, code, title, description, orderIndex }` *(mặc định `GM`, `OT` theo từng mô-đun; cho phép thêm tùy biến)*.
- **`KnowledgePart`**: `{ id, module, level, category, code, title, description, orderIndex }` *(VD: `GM1`, `GM2`, `OT1`...)*.
- **`Question`**: `{ id, module, level, category, contentCode, topicOrder, topic, type, prompt, instruction?, difficulty, payload, explanation, tips?, createdAt, updatedAt }`
  - `type`: `'single' | 'multiple' | 'true_false' | 'matching' | 'hotspot'`
  - `difficulty`: `'easy' | 'medium' | 'hard'`
  - `payload`: Union type theo 5 dạng câu hỏi (options/correctOptionId, options/correctOptionIds, statements, matchingLeft/matchingRight/correctPairs, hotspotType/hotspotTarget/imageAlt).
- **`QuestionSet`**: `{ id, title, description, level?, category?, contentCode?, questionIds: string[], createdAt, updatedAt }`

### 2.3. Giao bài tập, Giải lao & Báo cáo
- **`ClassTaskConfig`**: `{ classId, assignmentTitle, teacherName, breakRewardMinutes, updatedAt, tasks: ClassTaskItem[] }`
- **`ClassTaskItem`**: `{ id, classId, orderIndex, title, description, level, category, contentCode, moduleFilter, quizMode: 'practice' | 'exam', questionIds, estimatedMinutes, requiredAttempts, minScore }`
- **`AdminTaskStatRecord`**: `{ id, studentId, studentName, studentCode, schoolId, classId, taskId, taskTitle, score, correctCount, totalCount, durationSeconds, completedAt, attemptNumber, requiredAttempts, minScore, metMinScore }`
- **`StudentBreakState`**: `{ studentId, status: 'locked' | 'active' | 'expired', totalGrantedSeconds, remainingSeconds, unlockedAt?, expiredAt?, updatedAt }`

### 2.4. Thi đấu Realtime
- **`ClassBattleConfig`**: `{ classId, isEnabled, title, questionSetId, questionSetName, teacherName, moduleFilter, questionIds, fastComboWindowSeconds, topRewardCount, breakRewardMinutes, timeLimitSeconds, updatedAt }`
- **`BattleRoomState`**: `{ id, classId, status: 'lobby' | 'playing' | 'finished', questionIds, configSnapshot, startedAt?, endsAt?, finishedAt?, rankedResults?, participants: BattleParticipant[], events: BattleEvent[], createdAt }`
- **`BattleDebuffType`**: `'blur' | 'frost' | 'reverse' | 'shake'`

---

## 3. Danh mục REST API (`server.ts` ↔ `src/utils/api.ts`)

| Nhóm | Method & Route | Chức năng |
|---|---|---|
| Hệ thống | `GET /api/health` | Kiểm tra trạng thái server |
| Hệ thống | `GET /api/bootstrap` | Trả toàn bộ `AdminDatabase` (đã ẩn `password` của `teachers`) |
| Xác thực & GV | `POST /api/auth/login` | Đăng nhập bằng `email` + `password` |
| Xác thực & GV | `POST /api/teachers`, `DELETE /api/teachers/:userId` | Tạo / xóa tài khoản giáo viên (chặn xóa Super Admin cuối cùng) |
| Trường học | `POST /api/schools`, `PUT /api/schools/:id`, `DELETE /api/schools/:id` | CRUD Trường học (xóa kéo theo lớp, học sinh, bài tập, nộp bài, break, battle của trường) |
| Lớp học | `POST /api/classes`, `PUT /api/classes/:id`, `DELETE /api/classes/:id` | CRUD Lớp học (xóa kéo theo học sinh và cấu hình của lớp) |
| Học sinh | `POST /api/students`, `POST /api/students/batch`, `PUT /api/students/:id`, `DELETE /api/students/:id` | CRUD Học sinh + nhập hàng loạt CSV (tự sinh MK không dấu) |
| Mật khẩu HS | `POST /api/students/:id/reset-password`, `POST /api/classes/:id/reset-passwords` | Reset MK 1 học sinh hoặc cả lớp về mặc định không dấu |
| Mô-đun IC3 | `POST /api/modules`, `PUT /api/modules/:id`, `DELETE /api/modules/:id` | CRUD Mô-đun (sửa `level` tự cập nhật cho `parts` & `questions`; chặn xóa khi còn dữ liệu con) |
| Nhóm kiến thức | `POST /api/knowledge-categories`, `PUT /api/knowledge-categories/:id`, `DELETE /api/knowledge-categories/:id` | CRUD Nhóm kiến thức theo `module` (chặn xóa khi còn `parts` hoặc `questions`) |
| Phần kiến thức | `POST /api/knowledge-parts`, `PUT /api/knowledge-parts/:id`, `DELETE /api/knowledge-parts/:id` | CRUD Phần kiến thức (chặn xóa khi còn `questions`) |
| Câu hỏi | `POST /api/questions`, `PUT /api/questions/:id`, `DELETE /api/questions/:id` | CRUD Câu hỏi (tự đánh `topicOrder`, giữ/điều chỉnh `topicOrder`, xóa gỡ khỏi `questionSets`) |
| Câu hỏi nâng cao | `POST /api/questions/reorder`, `POST /api/questions/batch-delete` | Cập nhật `topicOrder` hàng loạt & xóa nhiều câu hỏi cùng lúc |
| Bộ đề | `POST /api/question-sets`, `PUT /api/question-sets/:id`, `DELETE /api/question-sets/:id` | CRUD Bộ đề luyện & thi đấu |
| Đồng bộ Remote | `POST /api/question-bank/import-remote` | Ghi đè toàn bộ 5 mảng Ngân hàng Câu hỏi từ Supabase vào Local DB |
| Bài tập & Nộp bài | `PUT /api/class-tasks/:classId`, `POST /api/submissions` | Lưu cấu hình nhiệm vụ lớp; ghi nhận lượt nộp & tự mở khóa giờ giải lao khi đủ 100% |
| Thi đấu | `PUT /api/battle-configs/:classId`, `POST /api/battle-rooms`, `POST /api/battle-rooms/:roomId/join`, `start`, `simulate-step`, `finish`, `reset` | Lưu luật thi đấu lớp & điều phối toàn vòng đời phòng thi đấu |

---

## 4. Lược đồ Supabase PostgreSQL (`SUPABASE_SCHEMA_SQL` — 17 bảng)

Kịch bản SQL tại `src/data/seedData.ts` định nghĩa **17 bảng** trong schema `public`:

1. **Tổ chức & Tài khoản (4 bảng):**
   - `schools` → `classes` (`school_id` FK `ON DELETE CASCADE`) → `students` (`class_id` FK `ON DELETE CASCADE`, `UNIQUE(class_id, student_code)`)
   - `admin_teachers` (`user_id` FK `auth.users(id)`, `school_id` FK `schools(id) ON DELETE SET NULL`)
2. **Ngân hàng Câu hỏi & Bộ đề (5 bảng — Khóa ngoại 4 tầng):**
   - `ic3_modules` (`code UNIQUE`)
   - `knowledge_categories` (`UNIQUE(module, code)`, FK `module` → `ic3_modules(code)` `ON UPDATE CASCADE ON DELETE RESTRICT`)
   - `knowledge_parts` (`UNIQUE(module, category, code)`, composite FK `(module, category)` → `knowledge_categories(module, code)` `ON UPDATE CASCADE ON DELETE RESTRICT`)
   - `questions` (index `idx_questions_part_order(module, category, content_code, topic_order)`, composite FK `(module, category, content_code)` → `knowledge_parts(module, category, code)` `ON UPDATE CASCADE ON DELETE RESTRICT`)
   - `question_sets` (`question_ids text[]`)
3. **Bài tập, Nộp bài & Giải lao (4 bảng):**
   - `class_task_configs` (`class_id PK` → `classes(id) ON DELETE CASCADE`) → `class_tasks` (`class_id` → `class_task_configs(class_id) ON DELETE CASCADE`)
   - `student_task_submissions` (FK tới `schools`, `classes`, `students`, `class_tasks` đều `ON DELETE CASCADE`)
   - `student_break_states` (`student_id PK` → `students(id) ON DELETE CASCADE`)
4. **Thi đấu Realtime (4 bảng):**
   - `class_battle_configs` (`class_id PK` → `classes(id) ON DELETE CASCADE`, `question_set_id` → `question_sets(id) ON DELETE SET NULL`)
   - `battle_rooms` (`class_id` → `classes(id) ON DELETE CASCADE`) → `battle_participants` (`PK(room_id, student_id)`) & `battle_events` (`room_id` FK)

> **Lưu ý quan trọng khi nâng cấp DB cũ trên Supabase:** `SUPABASE_SCHEMA_SQL` có sẵn đoạn gỡ bỏ các ràng buộc `CHECK` cứng cũ trên `module/level/category` và tự động `INSERT ... ON CONFLICT DO NOTHING` để tạo dữ liệu cha còn thiếu từ `questions`/`knowledge_parts` trước khi gắn 3 ràng buộc khóa ngoại `fk_knowledge_categories_module`, `fk_knowledge_parts_category`, `fk_questions_part`.
