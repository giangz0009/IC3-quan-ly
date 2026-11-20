# IC3 Master — Đặc tả Kỹ thuật & Cơ sở Dữ liệu để Xây dựng Web App Quản lý Admin (Supabase)

Tài liệu này tổng hợp đầy đủ các phân hệ, quy tắc nghiệp vụ, cấu trúc dữ liệu (TypeScript contracts) và thiết kế lược đồ PostgreSQL/Realtime trên **Supabase** từ **Ứng dụng Học sinh (IC3 Master Student Web App)**, nhằm làm bản đặc tả đầu vào hoàn chỉnh để phát triển **Web App Quản lý Giáo viên / Admin**.

---

## 1. Tổng quan Kiến trúc Hệ sinh thái

Hệ thống gồm 2 ứng dụng web độc lập dùng chung một dự án **Supabase**:

1. **Student Web App (đã hoàn thiện)**:
   - Giao diện tối giản tập trung vào việc làm bài của học sinh (hỗ trợ **Chế độ Sáng / Tối** với bảng màu `slate`, chuyển đổi trực tiếp trên thanh điều hướng).
   - Hỗ trợ 2 chế độ truy cập: **Tài khoản học sinh** (chọn Trường → Lớp → Học sinh, hiển thị modal xác thực mật khẩu ngay tại trang Đăng nhập) và **Chế độ Khách** (trải nghiệm nhanh trên trình duyệt, không đồng bộ dữ liệu lên server).
   - Bảo vệ nội dung bài thi phía client (chặn chuột phải, phím tắt xem mã nguồn/DevTools `F12`, `Ctrl+U`, `Ctrl+Shift+I/J/C/K/E`, `Ctrl+S`, chống bôi đen/sao chép câu hỏi và tắt source map production).
2. **Teacher / Admin Web App (cần xây dựng với Supabase)**:
   - Quản lý Trường học, Lớp học, Tài khoản & Mật khẩu học sinh.
   - Quản lý Ngân hàng Câu hỏi IC3 (5 dạng câu hỏi) và Bộ đề.
   - Giao Bài tập theo từng lớp (`requiredAttempts`, `minScore`, `breakRewardMinutes`).
   - Điều phối và bật/tắt chế độ **Thi đấu Realtime** theo từng lớp.
   - Thống kê kết quả học tập, điểm số và thời gian làm bài của từng học sinh/lớp.

---

## 2. Quy tắc Nghiệp vụ Cốt lõi của Student App (Admin cần đáp ứng)

### 2.1. Trường học, Lớp học & Tài khoản Học sinh
- Phân cấp dữ liệu: `School (1) ──▶ SchoolClass (N) ──▶ StudentProfile (N)`.
- **Quy tắc mật khẩu mặc định của học sinh**:
  - Họ tên viết thường, bỏ toàn bộ dấu tiếng Việt (kể cả chuyển `đ/Đ -> d`), xóa toàn bộ khoảng trắng.
  - Ví dụ: `"Đỗ Gia Huy"` → `"dogiahuy"`, `"Nguyễn Văn An"` → `"nguyenvanan"`.
- **Đổi mật khẩu & Reset mật khẩu**:
  - Học sinh có thể tự đổi mật khẩu trong mục **Cài đặt** (tối thiểu 4 ký tự, không chứa khoảng trắng, khác mật khẩu hiện tại) hoặc tự khôi phục về mặc định.
  - Admin cần có chức năng **Reset mật khẩu học sinh về mặc định** khi học sinh quên mật khẩu đã đổi.
- **Tài khoản đặc biệt (tùy chọn kiểm thử)**: Có cờ `always_break_ready` (ví dụ tài khoản test giải lao) để luôn mở khóa Khu vực Giải lao phục vụ giáo viên/kiểm thử.

### 2.2. Ngân hàng Câu hỏi IC3 & Thang điểm Chuẩn
- **3 Mô-đun IC3 (`IC3Module`)**:
  - `computing_fundamentals` — Máy tính căn bản (**LV1**)
  - `key_applications` — Các ứng dụng chủ chốt (**LV2**)
  - `living_online` — Cuộc sống trực tuyến (**LV3**)
- **2 Nhóm kiến thức (`KnowledgeCategory`)**:
  - `GM`: Kiến thức nền tảng chuẩn GMetrix (`GM1`, `GM2`, ...)
  - `OT`: Chuyên đề ôn tập chi tiết / Bổ sung / Tổng hợp (`OT1`, `OT2`, `Tổng hợp`, ...)
- **5 Dạng câu hỏi (`QuestionType`)** cần giao diện nhập liệu ở Admin:
  1. `single` — **Trắc nghiệm 1 đáp án đúng**:
     - `options`: `Array<{ id: string; text: string }>`
     - `correctOptionId`: `string`
  2. `multiple` — **Trắc nghiệm nhiều đáp án đúng**:
     - `options`: `Array<{ id: string; text: string }>`
     - `correctOptionIds`: `string[]` (phải chọn đúng và đủ toàn bộ đáp án mới tính điểm)
  3. `true_false` — **Xác định Đúng / Sai cho từng ý nhỏ của câu hỏi**:
     - `statements`: `Array<{ id: string; text: string; isTrue: boolean; explanation?: string }>`
     - Học sinh phải chọn đúng trạng thái `Đúng`/`Sai` cho **tất cả** các ý mới được tính đúng câu.
  4. `matching` — **Ghép nối cặp Cột A – Cột B**:
     - `matchingLeft`: `Array<{ id: string; text: string }>` (hiển thị đánh số `1, 2, 3...`)
     - `matchingRight`: `Array<{ id: string; text: string }>` (hiển thị đánh chữ `A, B, C...`)
     - `correctPairs`: `Array<{ leftId: string; rightId: string }>`
  5. `hotspot` — **Chọn vị trí trực tiếp trên hình ảnh**:
     - `hotspotType`: `'word_ribbon' | 'excel_ribbon' | 'pc_hardware_ports' | 'browser_security'` (hoặc ảnh URL tùy chỉnh nếu mở rộng ở Admin)
     - `hotspotTarget`: `{ label: string; minX: number; minY: number; maxX: number; maxY: number }` (tọa độ phần trăm `0–100`, chấm điểm có dung sai `±1.5%`).
- **Quy tắc chấm điểm IC3**:
  - Thang điểm: `0 – 1000` theo công thức `Math.round((correctCount / totalCount) * 1000)`.
  - Ngưỡng đạt chuẩn thi thử IC3: `score >= 700`.
  - *Lưu ý UI*: Student App hiện tạm ẩn phần hiển thị giải thích câu hỏi khi làm bài, nhưng Admin vẫn nên lưu cột `explanation` và `tips` trong DB để sẵn sàng bật lại khi cần.

### 2.3. Giao Bài tập theo Lớp & Cơ chế Mở khóa Khu vực Giải lao
- Trang chủ học sinh ưu tiên hiển thị trực tiếp **Bài tập còn thiếu** của lớp và danh sách **Chủ đề luyện thi**.
- Giáo viên cấu hình cho từng lớp (`ClassTaskConfig`):
  - `assignmentTitle`: Tiêu đề đợt bài tập (VD: `"Nhiệm vụ Tuần 12..."`)
  - `teacherName`: Tên giáo viên giao bài
  - `breakRewardMinutes`: Số phút giải lao thưởng khi hoàn thành **100%** các bài tập của lớp (mở khóa kho trò chơi nhúng & game 2 người trong Khu vực Giải lao).
  - Danh sách nhiệm vụ (`ClassTaskItem[]`), mỗi nhiệm vụ có:
    - `order`: Thứ tự hiển thị
    - `title`, `description`, `level`, `category`, `contentCode`, `moduleFilter`
    - `quizMode`: `'practice' | 'exam'`
    - `questionCount`, `estimatedMinutes`, `targetQuestionIds?: string[]`
    - **`requiredAttempts`** *(int, mặc định `1`)*: Số lần tối thiểu học sinh phải hoàn thành đạt chuẩn cho nhiệm vụ đó.
    - **`minScore`** *(int `0–1000`, mặc định `0`)*: Điểm tối thiểu mỗi lần nộp bài để lần làm đó được tính là **đạt chuẩn (`metMinScore`)**.
- **Quy tắc tính hoàn thành & đếm ngược Giải lao**:
  - Một nhiệm vụ chỉ được đánh dấu *Hoàn thành* khi `qualifyingAttempts >= requiredAttempts` (tức số lần nộp bài có `score >= minScore` đạt đủ số lần quy định).
  - Khi **tất cả** nhiệm vụ trong lớp đều hoàn thành, `breakState.status` chuyển từ `'locked'` sang `'active'` với `remainingSeconds = breakRewardMinutes * 60`. Khi đếm về `0`, chuyển thành `'expired'` và khóa lại Khu vực Giải lao.
- **Dữ liệu thống kê học sinh nộp về Admin (`AdminTaskStatRecord`)**:
  - Mỗi lần học sinh nộp bài thuộc một nhiệm vụ lớp, ghi nhận bản ghi gồm: `studentId`, `studentName`, `studentCode`, `schoolId`, `classId`, `taskId`, `taskTitle`, `score`, `correctCount`, `totalCount`, `durationSeconds`, `completedAt`, `attemptNumber`, `requiredAttempts`, `minScore`, `metMinScore`.

### 2.4. Chế độ Thi đấu Realtime theo Lớp (`Battle Arena`)
- Trên Trang chủ (cạnh nút **Thi thử**) và trên Thanh điều hướng có nút **Thi đấu**:
  - Bị khóa/mờ nếu `isEnabled === false` hoặc không có cấu hình cho lớp.
  - Sáng nổi bật (màu vàng hổ phách) khi Admin bật `isEnabled === true` cho lớp đó.
- **Cấu hình Thi đấu do Admin thiết lập cho từng lớp (`ClassBattleConfig`)**:
  - `isEnabled`: Bật/tắt quyền vào phòng thi đấu cho lớp.
  - `title`: Tên giải đấu của lớp.
  - `questionSetId`, `questionSetName`, `questionIds[]`, `moduleFilter`: Bộ đề thi đấu được chọn cho lớp.
  - `teacherName`: Tên giáo viên tổ chức.
  - `timeLimitSeconds`: Thời gian giới hạn toàn trận (giây, mặc định `300s`).
  - `fastComboWindowSeconds`: Ngưỡng tổng thời gian trả lời **2 câu đúng liên tiếp** (VD: `15s` hoặc `20s`) để học sinh nhận 1 lượt chọn Thẻ kỹ năng.
  - `topRewardCount`: **Top X** học sinh xếp hạng cao nhất được thưởng giờ giải lao.
  - `breakRewardMinutes`: Số phút thưởng giải lao cộng thêm cho Top X.
- **Luật chơi & Cơ chế thẻ Realtime**:
  - Trạng thái phòng (`BattleRoomStatus`): `'lobby'` → `'playing'` → `'finished'`.
  - Xếp hạng ưu tiên: **Điểm (`score` thang 1000) giảm dần → Thời gian làm (`durationSeconds`) tăng dần**.
  - Khi học sinh trả lời đúng 2 câu liên tiếp trong tổng thời gian `<= fastComboWindowSeconds`, được chọn:
    - **Thẻ Phòng Thủ**: Cộng `+2` lượt khiên chắn (`shieldCharges`).
    - **Thẻ Tấn Công**: Chọn 1 bạn cùng phòng để áp dụng hiệu ứng bất lợi (`BattleDebuffType`) trong **6 giây (`6000ms`)**:
      - `blur` (Làm mờ câu hỏi)
      - `frost` (Đóng băng khung câu hỏi)
      - `reverse` (Đảo ngược thứ tự phương án / ý đúng-sai)
      - `shake` (Rung lắc giao diện)
    - Nếu đối phương đang có `shieldCharges > 0`, đòn tấn công bị chặn và trừ `1` khiên của đối phương.
  - Kết thúc trận: Hệ thống vinh danh Top 3, xuất `BattleRankedResult[]`, cộng `breakRewardMinutes` cho Top X, và lưu câu trả lời để học sinh xem lại.

---

## 3. Ánh xạ Contract Dữ liệu Local hiện tại sang Supabase

Hiện tại Student App đang giao tiếp/lưu trữ dữ liệu giả lập qua `localStorage` và WebSocket server (`/ws/battle`). Khi chuyển sang tích hợp Supabase với Admin App, các khóa sau tương ứng trực tiếp với các bảng Supabase:

| Nguồn hiện tại (Student App) | Bảng / Kênh tương ứng trên Supabase |
|---|---|
| `MOCK_SCHOOLS` (Trường → Lớp → Học sinh) | `schools`, `classes`, `students` |
| `ic3_student_passwords` | Cột `password_hash`, `is_custom_password` trong `students` |
| `INITIAL_QUESTIONS` & `CURRICULUM_DATA` | `questions`, `question_sets`, `curriculum_items` |
| `ic3_admin_class_tasks_configs` (`MOCK_CLASS_TASKS`) | `class_task_configs` + `class_tasks` |
| `ic3_student_task_state_<studentId>` | `student_task_progress` + `student_break_states` |
| `ic3_admin_task_results_<classId>` | `student_task_submissions` |
| `ic3_exam_history_<studentId>` | `student_exam_histories` |
| `ic3_admin_battle_configs` (`MOCK_BATTLE_CONFIGS`) | `class_battle_configs` |
| WebSocket `/ws/battle` (`BattleRoomState`) | **Supabase Realtime** trên `battle_rooms`, `battle_participants`, `battle_events` |

---

## 4. Lược đồ PostgreSQL Đề xuất cho Supabase

Có thể chạy trực tiếp kịch bản SQL sau trên **Supabase SQL Editor** để khởi tạo cơ sở dữ liệu dùng chung cho cả Admin App và Student App:

```sql
-- =========================================================
-- 1. TỔ CHỨC TRƯỜNG HỌC - LỚP HỌC - HỌC SINH
-- =========================================================
create table if not exists public.schools (
  id text primary key,
  name text not null,
  district text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id text primary key,
  school_id text not null references public.schools(id) on delete cascade,
  name text not null,
  grade text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id text primary key,
  class_id text not null references public.classes(id) on delete cascade,
  full_name text not null,
  student_code text not null,
  password_hash text not null,
  is_custom_password boolean not null default false,
  always_break_ready boolean not null default false,
  created_at timestamptz not null default now(),
  unique (class_id, student_code)
);

-- Bảng phân quyền giáo viên / admin (gắn với Supabase Auth auth.users)
create table if not exists public.admin_teachers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null check (role in ('super_admin', 'teacher')) default 'teacher',
  school_id text references public.schools(id) on delete set null,
  created_at timestamptz not null default now()
);

-- =========================================================
-- 2. NGÂN HÀNG CÂU HỎI & BỘ ĐỀ IC3
-- =========================================================
create table if not exists public.questions (
  id text primary key,
  module text not null check (module in ('computing_fundamentals', 'key_applications', 'living_online')),
  level text not null check (level in ('LV1', 'LV2', 'LV3')),
  category text not null check (category in ('GM', 'OT')),
  topic text not null,
  type text not null check (type in ('single', 'multiple', 'true_false', 'matching', 'hotspot')),
  prompt text not null,
  instruction text,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')) default 'medium',
  -- payload chứa chi tiết theo dạng câu hỏi:
  -- single: { options, correctOptionId }
  -- multiple: { options, correctOptionIds }
  -- true_false: { statements: [{ id, text, isTrue, explanation }] }
  -- matching: { matchingLeft, matchingRight, correctPairs }
  -- hotspot: { hotspotType, hotspotTarget: { label, minX, minY, maxX, maxY }, imageAlt }
  payload jsonb not null,
  explanation text not null default '',
  tips text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_sets (
  id text primary key,
  title text not null,
  description text default '',
  level text check (level in ('LV1', 'LV2', 'LV3')),
  category text check (category in ('GM', 'OT')),
  content_code text,
  question_ids text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 3. BÀI TẬP THEO LỚP & PHẦN THƯỞNG GIẢI LAO
-- =========================================================
create table if not exists public.class_task_configs (
  class_id text primary key references public.classes(id) on delete cascade,
  assignment_title text not null,
  teacher_name text not null,
  break_reward_minutes integer not null default 10 check (break_reward_minutes >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.class_tasks (
  id text primary key,
  class_id text not null references public.class_task_configs(class_id) on delete cascade,
  order_index integer not null default 1,
  title text not null,
  description text not null default '',
  level text not null check (level in ('LV1', 'LV2', 'LV3')),
  category text not null check (category in ('GM', 'OT')),
  content_code text not null,
  module_filter text not null check (module_filter in ('all', 'computing_fundamentals', 'key_applications', 'living_online')),
  quiz_mode text not null check (quiz_mode in ('practice', 'exam')) default 'practice',
  question_ids text[] not null default '{}',
  estimated_minutes integer not null default 10,
  required_attempts integer not null default 1 check (required_attempts >= 1),
  min_score integer not null default 0 check (min_score between 0 and 1000)
);

-- =========================================================
-- 4. LỊCH SỬ NỘP BÀI, THỐNG KÊ ADMIN & ĐỒNG HỒ GIẢI LAO
-- =========================================================
create table if not exists public.student_task_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id) on delete cascade,
  class_id text not null references public.classes(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  task_id text not null references public.class_tasks(id) on delete cascade,
  score integer not null check (score between 0 and 1000),
  correct_count integer not null check (correct_count >= 0),
  total_count integer not null check (total_count >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  attempt_number integer not null default 1,
  required_attempts integer not null default 1,
  min_score integer not null default 0,
  met_min_score boolean not null default false,
  answers_snapshot jsonb,
  completed_at timestamptz not null default now()
);

create index if not exists idx_submissions_class_task
  on public.student_task_submissions (class_id, task_id, student_id, completed_at desc);

create table if not exists public.student_exam_histories (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(id) on delete cascade,
  mode text not null check (mode in ('practice', 'exam')),
  title text not null,
  score integer not null check (score between 0 and 1000),
  passed boolean not null,
  correct_count integer not null,
  total_count integer not null,
  duration_seconds integer not null,
  module_breakdown jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.student_break_states (
  student_id text primary key references public.students(id) on delete cascade,
  status text not null check (status in ('locked', 'active', 'expired')) default 'locked',
  total_granted_seconds integer not null default 0,
  remaining_seconds integer not null default 0,
  unlocked_at timestamptz,
  expired_at timestamptz,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 5. THI ĐẤU REALTIME THEO LỚP (SUPABASE REALTIME)
-- =========================================================
create table if not exists public.class_battle_configs (
  class_id text primary key references public.classes(id) on delete cascade,
  is_enabled boolean not null default false,
  title text not null,
  question_set_id text references public.question_sets(id) on delete set null,
  question_set_name text not null,
  teacher_name text not null,
  module_filter text not null default 'all',
  question_ids text[] not null default '{}',
  fast_combo_window_seconds integer not null default 15 check (fast_combo_window_seconds >= 5),
  top_reward_count integer not null default 3 check (top_reward_count >= 1),
  break_reward_minutes integer not null default 10 check (break_reward_minutes >= 0),
  time_limit_seconds integer not null default 300 check (time_limit_seconds >= 30),
  updated_at timestamptz not null default now()
);

create table if not exists public.battle_rooms (
  id uuid primary key default gen_random_uuid(),
  class_id text not null references public.classes(id) on delete cascade,
  status text not null check (status in ('lobby', 'playing', 'finished')) default 'lobby',
  question_ids text[] not null default '{}',
  config_snapshot jsonb not null,
  started_at timestamptz,
  ends_at timestamptz,
  finished_at timestamptz,
  ranked_results jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.battle_participants (
  room_id uuid not null references public.battle_rooms(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  student_name text not null,
  student_code text not null,
  connected boolean not null default true,
  answered_count integer not null default 0,
  correct_count integer not null default 0,
  score integer not null default 0,
  duration_seconds integer not null default 0,
  finished boolean not null default false,
  finished_at timestamptz,
  shield_charges integer not null default 0,
  pending_card_choices integer not null default 0,
  attacks_used integer not null default 0,
  defenses_used integer not null default 0,
  attacks_blocked integer not null default 0,
  active_debuffs jsonb not null default '[]'::jsonb,
  current_pair_count integer not null default 0,
  current_pair_elapsed_seconds integer not null default 0,
  answers jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  primary key (room_id, student_id)
);

create table if not exists public.battle_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.battle_rooms(id) on delete cascade,
  type text not null check (type in ('join', 'start', 'combo', 'attack', 'blocked', 'defense', 'finish')),
  message text not null,
  actor_student_id text,
  actor_student_name text,
  target_student_id text,
  target_student_name text,
  debuff_type text check (debuff_type in ('blur', 'frost', 'reverse', 'shake')),
  created_at timestamptz not null default now()
);
```

### Khuyến nghị Supabase Realtime & Bảo mật (RLS / RPC)
- **Supabase Realtime**: Bật publication `supabase_realtime` cho 3 bảng `battle_rooms`, `battle_participants`, `battle_events` (và `class_battle_configs` / `class_task_configs` nếu muốn học sinh cập nhật ngay khi giáo viên thay đổi cấu hình).
- **Chấm điểm & Xác thực phía Server (Edge Functions / PostgreSQL RPC)**:
  - Nên viết các RPC bảo mật hoặc Supabase Edge Functions cho:
    1. `verify_student_login(student_id, plain_password)`: Kiểm tra mật khẩu mà không lộ `password_hash` về trình duyệt.
    2. `submit_task_answers(...)`: Chấm điểm phía server dựa trên `questions.payload` (để học sinh không đọc được đáp án đúng qua Network/DevTools khi làm bài thi hoặc thi đấu).
    3. `apply_battle_action(...)`: Xử lý combo, cộng khiên phòng thủ, áp dụng debuff và tính bảng xếp hạng/thưởng giải lao Top X mang tính server-authoritative.
- **Row Level Security (RLS)**:
  - `admin_teachers`: Giáo viên đăng nhập qua Supabase Auth có quyền ghi trên dữ liệu Trường/Lớp thuộc phạm vi quản lý.
  - Học sinh không dùng Supabase Auth (đăng nhập bằng danh sách lớp + mật khẩu học sinh) có thể đọc câu hỏi không kèm đáp án đúng (qua View/RPC) và chỉ ghi bài nộp thông qua RPC đã xác thực phiên.

---

## 5. Danh sách Tính năng Cần Xây dựng cho Web App Quản lý Admin

1. **Xác thực & Phân quyền Giáo viên (`Supabase Auth`)**:
   - Đăng nhập bằng Email/Mật khẩu giáo viên; phân vai `super_admin` (toàn trường/hệ thống) và `teacher` (quản lý lớp được phân công).
2. **Quản lý Trường – Lớp – Học sinh**:
   - CRUD Trường học, Lớp học, Học sinh.
   - Nhập nhanh danh sách học sinh từ CSV/Excel, tự động tạo `student_code` và `password_hash` mặc định từ họ tên tiếng Việt không dấu.
   - Nút **Đặt lại mật khẩu về mặc định** cho từng học sinh hoặc cả lớp; bật/tắt cờ `always_break_ready` cho tài khoản demo.
3. **Trình biên tập Ngân hàng Câu hỏi IC3 (5 dạng) & Bộ đề**:
   - Lọc & tìm kiếm câu hỏi theo Mô-đun (`LV1/LV2/LV3`), Nhóm (`GM/OT`), Chủ đề, Độ khó, Dạng câu hỏi.
   - Form chuyên biệt cho từng dạng:
     - `single` / `multiple`: Nhập các lựa chọn và tích 1 hoặc nhiều đáp án đúng.
     - `true_false`: Thêm/sửa/xóa từng ý phát biểu kèm toggle `Đúng` / `Sai`.
     - `matching`: Tạo danh sách Cột A (1, 2, 3...) – Cột B (A, B, C...) và ánh xạ cặp đúng.
     - `hotspot`: Hiển thị ảnh mẫu (`word_ribbon`, `excel_ribbon`, `pc_hardware_ports`, `browser_security`...) và cho giáo viên kéo khoanh vùng trực tiếp để tự sinh tọa độ `%` (`minX, minY, maxX, maxY`).
   - Gom câu hỏi thành **Bộ đề (`question_sets`)** để tái sử dụng cho cả Bài tập và Thi đấu.
4. **Quản lý Giao Bài tập theo Lớp (`Class Tasks Manager`)**:
   - Chọn lớp → Đặt tiêu đề tuần/đợt bài tập, tên giáo viên, số phút giải lao thưởng (`break_reward_minutes`).
   - Thêm/sắp xếp thứ tự nhiệm vụ (`class_tasks`): chọn bộ câu hỏi, chế độ `practice` / `exam`, thời gian dự kiến, **`required_attempts`** (số lần cần hoàn thành) và **`min_score`** (điểm sàn 0–1000).
   - Xem trực quan tỷ lệ học sinh trong lớp đã hoàn thành từng nhiệm vụ và tổng thời gian giải lao đang có.
5. **Trung tâm Điều phối Thi đấu Realtime (`Battle Control Room`)**:
   - Công tắc bật/tắt **`is_enabled`** cho từng lớp (quyết định nút **Thi đấu** trên app học sinh sáng hay khóa).
   - Chọn Bộ đề thi đấu, chỉnh `time_limit_seconds`, `fast_combo_window_seconds`, `top_reward_count`, `break_reward_minutes`.
   - Bảng điều khiển trực tiếp theo dõi danh sách học sinh vào `lobby`, bấm **Bắt đầu trận đấu**, theo dõi bảng xếp hạng live + log tấn công/phòng thủ realtime, hoặc **Tạo phòng mới / Reset**.
6. **Dashboard Thống kê & Báo cáo Học tập**:
   - Thống kê theo Lớp / Nhiệm vụ / Học sinh: số lượt làm, điểm cao nhất (`bestScore`), điểm trung bình, tỷ lệ đạt `min_score`, thời gian làm bài (`durationSeconds`).
   - Bảng lịch sử chi tiết từng lần nộp bài (`student_task_submissions`) và lịch sử các trận Thi đấu đã kết thúc (`battle_rooms`).
   - Xuất báo cáo điểm số ra CSV/Excel cho giáo viên lưu trữ.
