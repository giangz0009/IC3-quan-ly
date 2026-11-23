import type { AdminDatabase } from '../types/ic3.js';

export const SUPABASE_SCHEMA_SQL = `-- =========================================================
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

create table if not exists public.admin_teachers (
  user_id text primary key,
  full_name text not null,
  email text not null unique,
  password_hash text not null default '',
  role text not null check (role in ('teacher_lv1', 'teacher_lv2', 'master')) default 'teacher_lv1',
  status text not null check (status in ('active', 'locked')) default 'active',
  created_at timestamptz not null default now()
);

-- Nâng cấp bảng admin_teachers nếu đang dùng schema cũ (uuid FK auth.users, super_admin/teacher, school_id)
alter table public.admin_teachers drop constraint if exists admin_teachers_user_id_fkey;
alter table public.admin_teachers alter column user_id type text using user_id::text;
alter table public.admin_teachers add column if not exists password_hash text not null default '';
alter table public.admin_teachers drop constraint if exists admin_teachers_role_check;
update public.admin_teachers set role = 'master' where role = 'super_admin';
update public.admin_teachers set role = 'teacher_lv1' where role = 'teacher';
alter table public.admin_teachers alter column role set default 'teacher_lv1';
alter table public.admin_teachers add constraint admin_teachers_role_check check (role in ('teacher_lv1', 'teacher_lv2', 'master'));
alter table public.admin_teachers add column if not exists status text not null default 'active' check (status in ('active', 'locked'));
alter table public.admin_teachers drop column if exists school_id;

-- =========================================================
-- 2. NGÂN HÀNG CÂU HỎI & BỘ ĐỀ IC3
-- =========================================================
create table if not exists public.ic3_modules (
  id text primary key,
  code text not null unique,
  level text not null,
  title text not null,
  description text default '',
  order_index integer not null default 1
);

create table if not exists public.knowledge_categories (
  id text primary key,
  module text not null,
  code text not null,
  title text not null,
  description text default '',
  order_index integer not null default 1,
  unique (module, code),
  constraint fk_knowledge_categories_module
    foreign key (module) references public.ic3_modules(code)
    on update cascade on delete restrict
);

create table if not exists public.knowledge_parts (
  id text primary key,
  module text not null,
  level text not null,
  category text not null,
  code text not null,
  title text not null,
  description text default '',
  order_index integer not null default 1,
  unique (module, category, code),
  constraint fk_knowledge_parts_category
    foreign key (module, category) references public.knowledge_categories(module, code)
    on update cascade on delete restrict
);

create table if not exists public.questions (
  id text primary key,
  module text not null,
  level text not null,
  category text not null,
  content_code text not null default 'GM1',
  topic_order integer not null default 1,
  topic text not null,
  type text not null check (type in ('single', 'multiple', 'true_false', 'matching', 'hotspot')),
  prompt text not null,
  instruction text,
  payload jsonb not null,
  explanation text not null default '',
  tips text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_questions_part
    foreign key (module, category, content_code) references public.knowledge_parts(module, category, code)
    on update cascade on delete restrict
);

alter table public.questions
  add column if not exists content_code text not null default 'GM1';
alter table public.questions
  add column if not exists topic_order integer not null default 1;
alter table public.questions
  drop column if exists difficulty;

create index if not exists idx_questions_part_order
  on public.questions (module, category, content_code, topic_order);

create table if not exists public.question_sets (
  id text primary key,
  title text not null,
  description text default '',
  level text,
  category text,
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
  level text not null,
  category text not null,
  content_code text not null,
  module_filter text not null default 'all',
  quiz_mode text not null check (quiz_mode in ('practice', 'exam')) default 'practice',
  question_ids text[] not null default '{}',
  estimated_minutes integer not null default 10,
  required_attempts integer not null default 1 check (required_attempts >= 1),
  min_score integer not null default 0 check (min_score between 0 and 1000)
);

-- Gỡ bỏ ràng buộc CHECK cứng nếu nâng cấp từ phiên bản cũ để hỗ trợ Module/Nhóm tự định nghĩa
alter table public.knowledge_parts drop constraint if exists knowledge_parts_module_check;
alter table public.knowledge_parts drop constraint if exists knowledge_parts_level_check;
alter table public.knowledge_parts drop constraint if exists knowledge_parts_category_check;
alter table public.questions drop constraint if exists questions_module_check;
alter table public.questions drop constraint if exists questions_level_check;
alter table public.questions drop constraint if exists questions_category_check;
alter table public.question_sets drop constraint if exists question_sets_level_check;
alter table public.question_sets drop constraint if exists question_sets_category_check;
alter table public.class_tasks drop constraint if exists class_tasks_level_check;
alter table public.class_tasks drop constraint if exists class_tasks_category_check;
alter table public.class_tasks drop constraint if exists class_tasks_module_filter_check;

-- Đồng bộ dữ liệu cha còn thiếu (nếu nâng cấp DB cũ) và gắn Khóa ngoại 4 tầng để hiển thị liên kết trên Schema Visualizer
insert into public.ic3_modules (id, code, level, title, description, order_index)
select distinct on (src.module)
  'mod_' || lower(regexp_replace(src.module, '[^a-zA-Z0-9]+', '_', 'g')),
  src.module,
  src.level,
  case src.module
    when 'computing_fundamentals' then 'Máy tính căn bản (Computing Fundamentals)'
    when 'key_applications' then 'Các ứng dụng chủ chốt (Key Applications)'
    when 'living_online' then 'Cuộc sống trực tuyến (Living Online)'
    else src.level || ' — ' || src.module
  end,
  '',
  99
from (
  select module, level, 1 as prio from public.knowledge_parts
  union all
  select module, level, 2 as prio from public.questions
  union all
  select module,
    case module
      when 'computing_fundamentals' then 'LV1'
      when 'key_applications' then 'LV2'
      when 'living_online' then 'LV3'
      else upper(module)
    end as level,
    3 as prio
  from public.knowledge_categories
) src
order by src.module, src.prio
on conflict do nothing;

insert into public.knowledge_categories (id, module, code, title, description, order_index)
select distinct on (src.module, src.category)
  'cat_' || lower(regexp_replace(src.module || '_' || src.category, '[^a-zA-Z0-9]+', '_', 'g')),
  src.module,
  src.category,
  'Nhóm ' || src.category,
  '',
  99
from (
  select module, category from public.knowledge_parts
  union all
  select module, category from public.questions
) src
order by src.module, src.category
on conflict do nothing;

insert into public.knowledge_parts (id, module, level, category, code, title, description, order_index)
select distinct on (q.module, q.category, q.content_code)
  'part_' || lower(regexp_replace(q.module || '_' || q.category || '_' || q.content_code, '[^a-zA-Z0-9]+', '_', 'g')),
  q.module,
  q.level,
  q.category,
  q.content_code,
  coalesce(nullif(q.topic, ''), 'Chuyên đề ' || q.content_code),
  '',
  99
from public.questions q
order by q.module, q.category, q.content_code, q.topic_order
on conflict do nothing;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_knowledge_categories_module'
      and conrelid = 'public.knowledge_categories'::regclass
  ) then
    alter table public.knowledge_categories
      add constraint fk_knowledge_categories_module
      foreign key (module) references public.ic3_modules(code)
      on update cascade on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_knowledge_parts_category'
      and conrelid = 'public.knowledge_parts'::regclass
  ) then
    alter table public.knowledge_parts
      add constraint fk_knowledge_parts_category
      foreign key (module, category) references public.knowledge_categories(module, code)
      on update cascade on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_questions_part'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
      add constraint fk_questions_part
      foreign key (module, category, content_code) references public.knowledge_parts(module, category, code)
      on update cascade on delete restrict;
  end if;
end $$;

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

-- =========================================================
-- 6. PHÂN QUYỀN TRUY CẬP API CHO ANON / AUTHENTICATED (RLS)
-- =========================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'schools', 'classes', 'students', 'admin_teachers',
    'ic3_modules', 'knowledge_categories', 'knowledge_parts', 'questions', 'question_sets',
    'class_task_configs', 'class_tasks', 'student_task_submissions', 'student_break_states',
    'class_battle_configs', 'battle_rooms', 'battle_participants', 'battle_events'
  ] loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('drop policy if exists "ic3_admin_full_access" on public.%I;', tbl);
    execute format(
      'create policy "ic3_admin_full_access" on public.%I for all to anon, authenticated using (true) with check (true);',
      tbl
    );
  end loop;
end $$;

-- =========================================================
-- 7. SUPABASE STORAGE CHO ẢNH CÂU HỎI CHỌN ĐIỂM (HOTSPOT)
-- =========================================================
insert into storage.buckets (id, name, public)
values ('hotspot-images', 'hotspot-images', true)
on conflict (id) do update set public = true;

drop policy if exists "ic3_hotspot_images_public_read" on storage.objects;
create policy "ic3_hotspot_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'hotspot-images');

drop policy if exists "ic3_hotspot_images_upload" on storage.objects;
create policy "ic3_hotspot_images_upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'hotspot-images');

drop policy if exists "ic3_hotspot_images_update" on storage.objects;
create policy "ic3_hotspot_images_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'hotspot-images')
  with check (bucket_id = 'hotspot-images');

drop policy if exists "ic3_hotspot_images_delete" on storage.objects;
create policy "ic3_hotspot_images_delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'hotspot-images');`;

export function createSeedDatabase(): AdminDatabase {
  const now = '2026-11-15T08:00:00.000Z';

  return {
    schools: [
      {
        id: 'school_nd',
        name: 'THCS Nguyễn Du',
        district: 'Quận 1, TP.HCM',
        createdAt: '2026-09-01T08:00:00.000Z',
      },
      {
        id: 'school_lqd',
        name: 'THCS Lê Quý Đôn',
        district: 'Quận 3, TP.HCM',
        createdAt: '2026-09-02T08:00:00.000Z',
      },
    ],
    classes: [
      {
        id: 'class_nd_6a1',
        schoolId: 'school_nd',
        name: '6A1',
        grade: 'Khối 6',
        createdAt: '2026-09-05T08:00:00.000Z',
      },
      {
        id: 'class_nd_6a2',
        schoolId: 'school_nd',
        name: '6A2',
        grade: 'Khối 6',
        createdAt: '2026-09-05T08:00:00.000Z',
      },
      {
        id: 'class_nd_7a1',
        schoolId: 'school_nd',
        name: '7A1',
        grade: 'Khối 7',
        createdAt: '2026-09-05T08:00:00.000Z',
      },
      {
        id: 'class_lqd_8a1',
        schoolId: 'school_lqd',
        name: '8A1',
        grade: 'Khối 8',
        createdAt: '2026-09-06T08:00:00.000Z',
      },
    ],
    students: [
      {
        id: 'st_6a1_01',
        classId: 'class_nd_6a1',
        fullName: 'Đỗ Gia Huy',
        studentCode: '6A1-01',
        passwordHash: 'dogiahuy',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-08T08:00:00.000Z',
      },
      {
        id: 'st_6a1_02',
        classId: 'class_nd_6a1',
        fullName: 'Nguyễn Văn An',
        studentCode: '6A1-02',
        passwordHash: 'an2026',
        isCustomPassword: true,
        alwaysBreakReady: false,
        createdAt: '2026-09-08T08:00:00.000Z',
      },
      {
        id: 'st_6a1_03',
        classId: 'class_nd_6a1',
        fullName: 'Trần Minh Thư',
        studentCode: '6A1-03',
        passwordHash: 'tranminhthu',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-08T08:00:00.000Z',
      },
      {
        id: 'st_6a1_04',
        classId: 'class_nd_6a1',
        fullName: 'Lê Hoàng Phúc',
        studentCode: '6A1-04',
        passwordHash: 'lehoangphuc',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-08T08:00:00.000Z',
      },
      {
        id: 'st_6a1_05',
        classId: 'class_nd_6a1',
        fullName: 'Phạm Bảo Ngọc',
        studentCode: '6A1-05',
        passwordHash: 'phambaongoc',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-08T08:00:00.000Z',
      },
      {
        id: 'st_6a1_demo',
        classId: 'class_nd_6a1',
        fullName: 'Tài khoản Kiểm thử Giải lao',
        studentCode: 'DEMO-BREAK',
        passwordHash: 'taikhoankiemthugiailao',
        isCustomPassword: false,
        alwaysBreakReady: true,
        createdAt: '2026-09-08T08:00:00.000Z',
      },
      {
        id: 'st_6a2_01',
        classId: 'class_nd_6a2',
        fullName: 'Võ Quốc Khánh',
        studentCode: '6A2-01',
        passwordHash: 'voquockhanh',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-09T08:00:00.000Z',
      },
      {
        id: 'st_6a2_02',
        classId: 'class_nd_6a2',
        fullName: 'Đặng Thảo Vy',
        studentCode: '6A2-02',
        passwordHash: 'vyic3',
        isCustomPassword: true,
        alwaysBreakReady: false,
        createdAt: '2026-09-09T08:00:00.000Z',
      },
      {
        id: 'st_7a1_01',
        classId: 'class_nd_7a1',
        fullName: 'Huỳnh Đức Thịnh',
        studentCode: '7A1-01',
        passwordHash: 'huynhducthinh',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-10T08:00:00.000Z',
      },
      {
        id: 'st_7a1_02',
        classId: 'class_nd_7a1',
        fullName: 'Bùi Phương Linh',
        studentCode: '7A1-02',
        passwordHash: 'buiphuonglinh',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-10T08:00:00.000Z',
      },
      {
        id: 'st_8a1_01',
        classId: 'class_lqd_8a1',
        fullName: 'Ngô Tấn Tài',
        studentCode: '8A1-01',
        passwordHash: 'ngotantai',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-11T08:00:00.000Z',
      },
      {
        id: 'st_8a1_02',
        classId: 'class_lqd_8a1',
        fullName: 'Dương Khánh Linh',
        studentCode: '8A1-02',
        passwordHash: 'duongkhanhlinh',
        isCustomPassword: false,
        alwaysBreakReady: false,
        createdAt: '2026-09-11T08:00:00.000Z',
      },
    ],
    teachers: [
      {
        userId: 'teacher_admin_01',
        fullName: 'Thầy Nguyễn Hoàng Minh',
        email: 'admin@ic3master.edu.vn',
        password: 'admin123',
        role: 'master',
        status: 'active',
        createdAt: '2026-09-01T07:00:00.000Z',
      },
      {
        userId: 'teacher_lv2_01',
        fullName: 'Cô Phạm Minh Anh',
        email: 'chuyenmon.lv2@ic3master.edu.vn',
        password: 'teacher123',
        role: 'teacher_lv2',
        status: 'active',
        createdAt: '2026-09-02T07:00:00.000Z',
      },
      {
        userId: 'teacher_nd_01',
        fullName: 'Cô Trần Thanh Hà',
        email: 'giangday.lv1@ic3master.edu.vn',
        password: 'teacher123',
        role: 'teacher_lv1',
        status: 'active',
        createdAt: '2026-09-03T07:00:00.000Z',
      },
    ],
    modules: [
      {
        id: 'mod_lv1',
        code: 'computing_fundamentals',
        level: 'LV1',
        title: 'Máy tính căn bản (LV1)',
        description:
          'Phần cứng, bộ nhớ, thiết bị ngoại vi, hệ điều hành Windows và quản lý tệp tin.',
        orderIndex: 1,
      },
      {
        id: 'mod_lv2',
        code: 'key_applications',
        level: 'LV2',
        title: 'Ứng dụng chủ chốt (LV2)',
        description:
          'Microsoft Word, Excel, PowerPoint, định dạng văn bản, hàm tính toán và trình chiếu.',
        orderIndex: 2,
      },
      {
        id: 'mod_lv3',
        code: 'living_online',
        level: 'LV3',
        title: 'Cuộc sống trực tuyến (LV3)',
        description:
          'Trình duyệt Web, chứng chỉ HTTPS, thư điện tử (Email) và an toàn công dân số.',
        orderIndex: 3,
      },
    ],
    knowledgeCategories: [
      {
        id: 'cat_lv1_gm',
        module: 'computing_fundamentals',
        code: 'GM',
        title: 'Nhóm GM — Chuẩn GMetrix',
        description:
          'Kiến thức nền tảng và dạng bài bám sát cấu trúc đề thi chuẩn GMetrix.',
        orderIndex: 1,
      },
      {
        id: 'cat_lv1_ot',
        module: 'computing_fundamentals',
        code: 'OT',
        title: 'Nhóm OT — Chuyên đề Ôn tập',
        description:
          'Chuyên đề ôn luyện mở rộng, bổ sung và tổng hợp theo từng phần.',
        orderIndex: 2,
      },
      {
        id: 'cat_lv2_gm',
        module: 'key_applications',
        code: 'GM',
        title: 'Nhóm GM — Chuẩn GMetrix',
        description:
          'Kiến thức nền tảng và dạng bài bám sát cấu trúc đề thi chuẩn GMetrix.',
        orderIndex: 1,
      },
      {
        id: 'cat_lv2_ot',
        module: 'key_applications',
        code: 'OT',
        title: 'Nhóm OT — Chuyên đề Ôn tập',
        description:
          'Chuyên đề ôn luyện mở rộng, bổ sung và tổng hợp theo từng phần.',
        orderIndex: 2,
      },
      {
        id: 'cat_lv3_gm',
        module: 'living_online',
        code: 'GM',
        title: 'Nhóm GM — Chuẩn GMetrix',
        description:
          'Kiến thức nền tảng và dạng bài bám sát cấu trúc đề thi chuẩn GMetrix.',
        orderIndex: 1,
      },
      {
        id: 'cat_lv3_ot',
        module: 'living_online',
        code: 'OT',
        title: 'Nhóm OT — Chuyên đề Ôn tập',
        description:
          'Chuyên đề ôn luyện mở rộng, bổ sung và tổng hợp theo từng phần.',
        orderIndex: 2,
      },
    ],
    knowledgeParts: [
      {
        id: 'part_lv1_gm1',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'GM',
        code: 'GM1',
        title: 'Phần cứng, Bộ nhớ & Thiết bị ngoại vi',
        description: 'Phân loại RAM/ROM/SSD, thiết bị nhập xuất cơ bản.',
        orderIndex: 1,
      },
      {
        id: 'part_lv1_gm2',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'GM',
        code: 'GM2',
        title: 'Cổng kết nối & Giao tiếp phần cứng',
        description: 'HDMI, USB-C, RJ-45 Ethernet và thiết bị mạng.',
        orderIndex: 2,
      },
      {
        id: 'part_lv1_ot1',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'OT',
        code: 'OT1',
        title: 'Quản lý Tệp tin & Hệ điều hành Windows',
        description: 'Thao tác tệp, phím tắt xóa vĩnh viễn và đặt tên hợp lệ.',
        orderIndex: 1,
      },
      {
        id: 'part_lv1_ot2',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'OT',
        code: 'OT2',
        title: 'Thực hành Nhận diện Cổng máy tính',
        description: 'Bài tập Hotspot nhận diện cổng mặt sau I/O.',
        orderIndex: 2,
      },
      {
        id: 'part_lv2_gm1',
        module: 'key_applications',
        level: 'LV2',
        category: 'GM',
        code: 'GM1',
        title: 'Microsoft Word & Thanh công cụ Ribbon',
        description: 'Sao chép định dạng Format Painter, nhóm Clipboard và Font.',
        orderIndex: 1,
      },
      {
        id: 'part_lv2_gm2',
        module: 'key_applications',
        level: 'LV2',
        category: 'GM',
        code: 'GM2',
        title: 'Microsoft Excel & Hàm tính toán',
        description: 'Merge & Center, hàm COUNT, COUNTA, SUM cơ bản.',
        orderIndex: 2,
      },
      {
        id: 'part_lv2_ot1',
        module: 'key_applications',
        level: 'LV2',
        category: 'OT',
        code: 'OT1',
        title: 'Microsoft PowerPoint & Trình chiếu',
        description: 'Slide Master, phím trình chiếu và hiệu ứng Transition.',
        orderIndex: 1,
      },
      {
        id: 'part_lv3_gm1',
        module: 'living_online',
        level: 'LV3',
        category: 'GM',
        code: 'GM1',
        title: 'Trình duyệt Web & Chứng chỉ HTTPS',
        description: 'Nhận diện kết nối bảo mật SSL/TLS trên thanh địa chỉ.',
        orderIndex: 1,
      },
      {
        id: 'part_lv3_gm2',
        module: 'living_online',
        level: 'LV3',
        category: 'GM',
        code: 'GM2',
        title: 'Thư điện tử (Email) & Quy tắc Cc/Bcc',
        description: 'Gửi email nhóm bảo mật danh sách người nhận.',
        orderIndex: 2,
      },
      {
        id: 'part_lv3_ot1',
        module: 'living_online',
        level: 'LV3',
        category: 'OT',
        code: 'OT1',
        title: 'Phòng chống Lừa đảo (Phishing) & Công dân số',
        description: 'Nhận diện email giả mạo, liên kết độc hại và bảo mật tài khoản.',
        orderIndex: 1,
      },
    ],
    questions: [
      {
        id: 'q_cf_single_01',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'GM',
        contentCode: 'GM1',
        topicOrder: 1,
        topic: 'Phần cứng & Bộ nhớ',
        type: 'single',
        prompt:
          'Loại bộ nhớ nào mất toàn bộ dữ liệu đang lưu trữ khi máy tính bị tắt nguồn đột ngột?',
        instruction: 'Chọn một đáp án đúng nhất.',
        payload: {
          options: [
            { id: 'opt_1', text: 'RAM (Random Access Memory)' },
            { id: 'opt_2', text: 'SSD (Solid State Drive)' },
            { id: 'opt_3', text: 'ROM (Read-Only Memory)' },
            { id: 'opt_4', text: 'Ổ cứng HDD gắn ngoài' },
          ],
          correctOptionId: 'opt_1',
        },
        explanation:
          'RAM là bộ nhớ khả biến (volatile), chỉ giữ dữ liệu khi còn nguồn điện.',
        tips: 'Nhớ cặp đối lập: RAM (tạm thời) vs SSD/HDD/ROM (lưu trữ lâu dài).',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_cf_multi_01',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'GM',
        contentCode: 'GM1',
        topicOrder: 2,
        topic: 'Thiết bị ngoại vi',
        type: 'multiple',
        prompt: 'Những thiết bị nào sau đây thuộc nhóm thiết bị NHẬP dữ liệu (Input Devices)?',
        instruction: 'Chọn TẤT CẢ đáp án đúng.',
        payload: {
          options: [
            { id: 'opt_1', text: 'Bàn phím cơ (Keyboard)' },
            { id: 'opt_2', text: 'Máy quét tài liệu (Scanner)' },
            { id: 'opt_3', text: 'Máy in laser (Laser Printer)' },
            { id: 'opt_4', text: 'Micro thu âm (Microphone)' },
          ],
          correctOptionIds: ['opt_1', 'opt_2', 'opt_4'],
        },
        explanation:
          'Bàn phím, máy quét và micro đưa tín hiệu vào máy tính; máy in là thiết bị xuất.',
        tips: 'Xác định hướng đi của dữ liệu: Từ ngoài vào máy là Input.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_cf_tf_01',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'OT',
        contentCode: 'OT1',
        topicOrder: 1,
        topic: 'Hệ điều hành & Tệp tin',
        type: 'true_false',
        prompt:
          'Xác định tính Đúng hoặc Sai của các phát biểu sau về quản lý tệp tin trên Windows:',
        instruction: 'Chọn Đúng hoặc Sai cho từng ý.',
        payload: {
          statements: [
            {
              id: 'st_1',
              text: 'Nhấn tổ hợp phím Shift + Delete sẽ xóa vĩnh viễn tệp tin mà không đưa vào Recycle Bin.',
              isTrue: true,
              explanation: 'Shift + Delete bỏ qua Thùng rác.',
            },
            {
              id: 'st_2',
              text: 'Hai tệp tin khác phần mở rộng (ví dụ bao_cao.docx và bao_cao.pdf) vẫn có thể nằm cùng một thư mục.',
              isTrue: true,
              explanation: 'Tên đầy đủ bao gồm cả phần mở rộng nên không trùng.',
            },
            {
              id: 'st_3',
              text: 'Tên tệp tin trong Windows được phép chứa ký tự dấu hỏi (?) và dấu sao (*).',
              isTrue: false,
              explanation: 'Các ký tự \\ / : * ? " < > | bị cấm trong tên tệp Windows.',
            },
          ],
        },
        explanation:
          'Nắm vững quy tắc đặt tên tệp Windows và cơ chế xóa tạm/vĩnh viễn.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_cf_match_01',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'GM',
        contentCode: 'GM2',
        topicOrder: 1,
        topic: 'Cổng kết nối & Phím tắt',
        type: 'matching',
        prompt: 'Ghép nối từng chuẩn cổng kết nối ở Cột A với công dụng chính ở Cột B:',
        instruction: 'Chọn cặp tương ứng 1-A, 2-B...',
        payload: {
          matchingLeft: [
            { id: 'l1', text: 'HDMI' },
            { id: 'l2', text: 'RJ-45 (Ethernet)' },
            { id: 'l3', text: 'USB-C' },
          ],
          matchingRight: [
            { id: 'r1', text: 'Kết nối mạng dây LAN tốc độ cao' },
            { id: 'r2', text: 'Truyền dữ liệu, hình ảnh và sạc hai chiều' },
            { id: 'r3', text: 'Truyền tải đồng thời âm thanh và hình ảnh HD' },
          ],
          correctPairs: [
            { leftId: 'l1', rightId: 'r3' },
            { leftId: 'l2', rightId: 'r1' },
            { leftId: 'l3', rightId: 'r2' },
          ],
        },
        explanation: 'HDMI truyền AV, RJ-45 cho mạng dây Ethernet, USB-C đa năng cắm hai chiều.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_cf_hotspot_01',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'OT',
        contentCode: 'OT2',
        topicOrder: 1,
        topic: 'Cổng kết nối Phần cứng',
        type: 'hotspot',
        prompt:
          'Trên bảng mặt sau của thùng máy tính (PC Hardware Ports), hãy nhấp vào vị trí cổng mạng dây Ethernet (RJ-45).',
        instruction: 'Nhấp chuột trực tiếp vào vùng cổng tương ứng trên hình.',
        payload: {
          hotspotType: 'pc_hardware_ports',
          imageAlt: 'Sơ đồ các cổng kết nối mặt sau máy tính để bàn',
          hotspotTarget: {
            label: 'Cổng Ethernet (RJ-45)',
            minX: 55,
            minY: 30,
            maxX: 73,
            maxY: 66,
          },
        },
        explanation: 'Cổng RJ-45 có dạng hình vuông vát góc đặc trưng dùng cáp mạng xoắn đôi.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_ka_hotspot_word',
        module: 'key_applications',
        level: 'LV2',
        category: 'GM',
        contentCode: 'GM1',
        topicOrder: 1,
        topic: 'Microsoft Word — Định dạng văn bản',
        type: 'hotspot',
        prompt:
          'Trên thanh Ribbon thẻ Home của Microsoft Word, hãy chọn nút lệnh dùng để sao chép định dạng (Format Painter).',
        instruction: 'Nhấp vào biểu tượng cây cọ Format Painter trên thanh Ribbon.',
        payload: {
          hotspotType: 'word_ribbon',
          imageAlt: 'Thanh công cụ Home Ribbon trong Microsoft Word',
          hotspotTarget: {
            label: 'Nút Format Painter',
            minX: 11,
            minY: 42,
            maxX: 21,
            maxY: 74,
          },
        },
        explanation: 'Format Painter nằm trong nhóm Clipboard (biểu tượng cây chổi quét).',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_ka_hotspot_excel',
        module: 'key_applications',
        level: 'LV2',
        category: 'GM',
        contentCode: 'GM2',
        topicOrder: 1,
        topic: 'Microsoft Excel — Công thức & Căn chỉnh',
        type: 'hotspot',
        prompt:
          'Trong giao diện Excel Ribbon, hãy nhấp chọn lệnh "Merge & Center" để gộp nhiều ô và căn giữa nội dung tiêu đề.',
        instruction: 'Chọn đúng nút Merge & Center trong nhóm Alignment.',
        payload: {
          hotspotType: 'excel_ribbon',
          imageAlt: 'Thanh công cụ Home Ribbon trong Microsoft Excel',
          hotspotTarget: {
            label: 'Nút Merge & Center',
            minX: 46,
            minY: 48,
            maxX: 63,
            maxY: 76,
          },
        },
        explanation: 'Merge & Center nằm trong nhóm Alignment trên thẻ Home của Excel.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_ka_single_01',
        module: 'key_applications',
        level: 'LV2',
        category: 'GM',
        contentCode: 'GM2',
        topicOrder: 2,
        topic: 'Microsoft Excel — Hàm tính toán',
        type: 'single',
        prompt:
          'Trong Excel, công thức nào đếm số lượng ô có chứa GIÁ TRỊ SỐ trong vùng từ A1 đến A10?',
        payload: {
          options: [
            { id: 'opt_1', text: '=COUNTA(A1:A10)' },
            { id: 'opt_2', text: '=COUNT(A1:A10)' },
            { id: 'opt_3', text: '=SUM(A1:A10)' },
            { id: 'opt_4', text: '=COUNTBLANK(A1:A10)' },
          ],
          correctOptionId: 'opt_2',
        },
        explanation: 'COUNT chỉ đếm ô chứa số; COUNTA đếm mọi ô không trống.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_ka_tf_01',
        module: 'key_applications',
        level: 'LV2',
        category: 'OT',
        contentCode: 'OT1',
        topicOrder: 1,
        topic: 'Microsoft PowerPoint — Trình chiếu',
        type: 'true_false',
        prompt: 'Đánh giá các phát biểu sau về thiết kế bài thuyết trình PowerPoint:',
        payload: {
          statements: [
            {
              id: 's1',
              text: 'Phím F5 dùng để bắt đầu trình chiếu ngay từ slide đầu tiên.',
              isTrue: true,
            },
            {
              id: 's2',
              text: 'Slide Master giúp thay đổi phông chữ hoặc logo đồng loạt cho toàn bộ slide.',
              isTrue: true,
            },
            {
              id: 's3',
              text: 'Hiệu ứng Transition áp dụng cho từng đối tượng chữ bên trong một slide.',
              isTrue: false,
            },
          ],
        },
        explanation: 'Transition là hiệu ứng chuyển trang slide; Animation mới dành cho đối tượng.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_lo_hotspot_browser',
        module: 'living_online',
        level: 'LV3',
        category: 'GM',
        contentCode: 'GM1',
        topicOrder: 1,
        topic: 'An toàn Trình duyệt Web',
        type: 'hotspot',
        prompt:
          'Trên thanh địa chỉ trình duyệt web, hãy nhấp vào biểu tượng chứng chỉ kết nối an toàn HTTPS (ổ khóa bảo mật).',
        payload: {
          hotspotType: 'browser_security',
          imageAlt: 'Thanh địa chỉ và chứng chỉ HTTPS của trình duyệt',
          hotspotTarget: {
            label: 'Biểu tượng ổ khóa HTTPS',
            minX: 21,
            minY: 32,
            maxX: 29,
            maxY: 66,
          },
        },
        explanation: 'Biểu tượng ổ khóa bên trái URL xác nhận trang dùng giao thức mã hóa HTTPS.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_lo_single_01',
        module: 'living_online',
        level: 'LV3',
        category: 'GM',
        contentCode: 'GM2',
        topicOrder: 1,
        topic: 'Thư điện tử (Email)',
        type: 'single',
        prompt:
          'Khi gửi thư mời cho 30 phụ huynh mà không muốn người nhận nhìn thấy địa chỉ email của nhau, giáo viên nên nhập danh sách vào trường nào?',
        payload: {
          options: [
            { id: 'opt_1', text: 'To' },
            { id: 'opt_2', text: 'Cc (Carbon Copy)' },
            { id: 'opt_3', text: 'Bcc (Blind Carbon Copy)' },
            { id: 'opt_4', text: 'Subject' },
          ],
          correctOptionId: 'opt_3',
        },
        explanation: 'Bcc ẩn danh sách địa chỉ người nhận khỏi những người nhận khác.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'q_lo_multi_01',
        module: 'living_online',
        level: 'LV3',
        category: 'OT',
        contentCode: 'OT1',
        topicOrder: 1,
        topic: 'An toàn & Công dân số',
        type: 'multiple',
        prompt: 'Những dấu hiệu nào cảnh báo một email có nguy cơ lừa đảo (Phishing)?',
        payload: {
          options: [
            { id: 'opt_1', text: 'Thúc giục xác minh mật khẩu gấp trong 2 giờ nếu không sẽ khóa tài khoản' },
            { id: 'opt_2', text: 'Địa chỉ tên miền người gửi sai chính tả (vd: g00gle-support.xyz)' },
            { id: 'opt_3', text: 'Email sử dụng chữ ký điện tử nội bộ trường học hợp lệ' },
            { id: 'opt_4', text: 'Chứa liên kết rút gọn lạ yêu cầu đăng nhập tài khoản ngân hàng' },
          ],
          correctOptionIds: ['opt_1', 'opt_2', 'opt_4'],
        },
        explanation: 'Email phishing thường tạo tâm lý khẩn cấp, giả mạo tên miền và dẫn link lạ.',
        createdAt: now,
        updatedAt: now,
      },
    ],
    questionSets: [
      {
        id: 'set_lv1_gm1',
        title: 'LV1 — GMetrix Nền tảng Phần cứng & Hệ điều hành',
        description: 'Tổng hợp 5 dạng câu hỏi trọng tâm Máy tính căn bản chuẩn GMetrix.',
        level: 'LV1',
        category: 'GM',
        contentCode: 'GM1',
        questionIds: [
          'q_cf_single_01',
          'q_cf_multi_01',
          'q_cf_tf_01',
          'q_cf_match_01',
          'q_cf_hotspot_01',
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'set_lv2_gm1',
        title: 'LV2 — GMetrix Word, Excel & PowerPoint',
        description: 'Thực hành thao tác Ribbon Hotspot và hàm xử lý bảng tính.',
        level: 'LV2',
        category: 'GM',
        contentCode: 'GM2',
        questionIds: [
          'q_ka_hotspot_word',
          'q_ka_hotspot_excel',
          'q_ka_single_01',
          'q_ka_tf_01',
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'set_lv3_ot1',
        title: 'LV3 — An toàn mạng & Giao tiếp trực tuyến',
        description: 'Chuyên đề nhận diện Phishing, HTTPS và quy tắc Email.',
        level: 'LV3',
        category: 'OT',
        contentCode: 'OT1',
        questionIds: ['q_lo_hotspot_browser', 'q_lo_single_01', 'q_lo_multi_01'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'set_battle_all',
        title: 'Bộ đề Thi đấu Tổng hợp IC3 (10 câu)',
        description: 'Phối hợp đều LV1 – LV2 – LV3 với đủ 5 dạng câu hỏi tốc độ cao.',
        level: 'LV1',
        category: 'OT',
        contentCode: 'Tổng hợp',
        questionIds: [
          'q_cf_single_01',
          'q_cf_multi_01',
          'q_cf_tf_01',
          'q_cf_match_01',
          'q_cf_hotspot_01',
          'q_ka_hotspot_word',
          'q_ka_hotspot_excel',
          'q_ka_single_01',
          'q_lo_hotspot_browser',
          'q_lo_single_01',
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    classTaskConfigs: [
      {
        classId: 'class_nd_6a1',
        assignmentTitle: 'Nhiệm vụ Tuần 12 — Ôn tập Phần cứng & Word Ribbon',
        teacherName: 'Cô Trần Thanh Hà',
        breakRewardMinutes: 15,
        updatedAt: now,
        tasks: [
          {
            id: 'task_6a1_1',
            classId: 'class_nd_6a1',
            orderIndex: 1,
            title: 'Luyện tập Máy tính căn bản (GM1)',
            description: 'Hoàn thành 2 lượt đạt từ 700 điểm trở lên để nắm chắc phần cứng.',
            level: 'LV1',
            category: 'GM',
            contentCode: 'GM1',
            moduleFilter: 'computing_fundamentals',
            quizMode: 'practice',
            questionIds: [
              'q_cf_single_01',
              'q_cf_multi_01',
              'q_cf_tf_01',
              'q_cf_match_01',
              'q_cf_hotspot_01',
            ],
            estimatedMinutes: 10,
            requiredAttempts: 2,
            minScore: 700,
          },
          {
            id: 'task_6a1_2',
            classId: 'class_nd_6a1',
            orderIndex: 2,
            title: 'Thi thử Ứng dụng chủ chốt (Word & Excel)',
            description: 'Làm bài chế độ thi thử không gợi ý, đạt tối thiểu 750 điểm.',
            level: 'LV2',
            category: 'GM',
            contentCode: 'GM2',
            moduleFilter: 'key_applications',
            quizMode: 'exam',
            questionIds: [
              'q_ka_hotspot_word',
              'q_ka_hotspot_excel',
              'q_ka_single_01',
              'q_ka_tf_01',
            ],
            estimatedMinutes: 12,
            requiredAttempts: 1,
            minScore: 750,
          },
        ],
      },
      {
        classId: 'class_nd_6a2',
        assignmentTitle: 'Nhiệm vụ Tuần 12 — Khởi động LV1',
        teacherName: 'Cô Trần Thanh Hà',
        breakRewardMinutes: 10,
        updatedAt: now,
        tasks: [
          {
            id: 'task_6a2_1',
            classId: 'class_nd_6a2',
            orderIndex: 1,
            title: 'Nhận diện cổng kết nối & Bộ nhớ',
            description: 'Làm quen dạng câu hỏi Hotspot và Ghép nối.',
            level: 'LV1',
            category: 'GM',
            contentCode: 'GM1',
            moduleFilter: 'computing_fundamentals',
            quizMode: 'practice',
            questionIds: ['q_cf_single_01', 'q_cf_match_01', 'q_cf_hotspot_01'],
            estimatedMinutes: 8,
            requiredAttempts: 1,
            minScore: 700,
          },
        ],
      },
    ],
    submissions: [
      {
        id: 'sub_01',
        studentId: 'st_6a1_01',
        studentName: 'Đỗ Gia Huy',
        studentCode: '6A1-01',
        schoolId: 'school_nd',
        classId: 'class_nd_6a1',
        taskId: 'task_6a1_1',
        taskTitle: 'Luyện tập Máy tính căn bản (GM1)',
        score: 600,
        correctCount: 3,
        totalCount: 5,
        durationSeconds: 184,
        completedAt: '2026-11-14T09:15:00.000Z',
        attemptNumber: 1,
        requiredAttempts: 2,
        minScore: 700,
        metMinScore: false,
      },
      {
        id: 'sub_02',
        studentId: 'st_6a1_01',
        studentName: 'Đỗ Gia Huy',
        studentCode: '6A1-01',
        schoolId: 'school_nd',
        classId: 'class_nd_6a1',
        taskId: 'task_6a1_1',
        taskTitle: 'Luyện tập Máy tính căn bản (GM1)',
        score: 800,
        correctCount: 4,
        totalCount: 5,
        durationSeconds: 142,
        completedAt: '2026-11-14T09:24:00.000Z',
        attemptNumber: 2,
        requiredAttempts: 2,
        minScore: 700,
        metMinScore: true,
      },
      {
        id: 'sub_03',
        studentId: 'st_6a1_01',
        studentName: 'Đỗ Gia Huy',
        studentCode: '6A1-01',
        schoolId: 'school_nd',
        classId: 'class_nd_6a1',
        taskId: 'task_6a1_1',
        taskTitle: 'Luyện tập Máy tính căn bản (GM1)',
        score: 1000,
        correctCount: 5,
        totalCount: 5,
        durationSeconds: 118,
        completedAt: '2026-11-14T09:31:00.000Z',
        attemptNumber: 3,
        requiredAttempts: 2,
        minScore: 700,
        metMinScore: true,
      },
      {
        id: 'sub_04',
        studentId: 'st_6a1_01',
        studentName: 'Đỗ Gia Huy',
        studentCode: '6A1-01',
        schoolId: 'school_nd',
        classId: 'class_nd_6a1',
        taskId: 'task_6a1_2',
        taskTitle: 'Thi thử Ứng dụng chủ chốt (Word & Excel)',
        score: 750,
        correctCount: 3,
        totalCount: 4,
        durationSeconds: 215,
        completedAt: '2026-11-14T10:05:00.000Z',
        attemptNumber: 1,
        requiredAttempts: 1,
        minScore: 750,
        metMinScore: true,
      },
      {
        id: 'sub_05',
        studentId: 'st_6a1_02',
        studentName: 'Nguyễn Văn An',
        studentCode: '6A1-02',
        schoolId: 'school_nd',
        classId: 'class_nd_6a1',
        taskId: 'task_6a1_1',
        taskTitle: 'Luyện tập Máy tính căn bản (GM1)',
        score: 800,
        correctCount: 4,
        totalCount: 5,
        durationSeconds: 165,
        completedAt: '2026-11-14T14:10:00.000Z',
        attemptNumber: 1,
        requiredAttempts: 2,
        minScore: 700,
        metMinScore: true,
      },
      {
        id: 'sub_06',
        studentId: 'st_6a1_03',
        studentName: 'Trần Minh Thư',
        studentCode: '6A1-03',
        schoolId: 'school_nd',
        classId: 'class_nd_6a1',
        taskId: 'task_6a1_1',
        taskTitle: 'Luyện tập Máy tính căn bản (GM1)',
        score: 1000,
        correctCount: 5,
        totalCount: 5,
        durationSeconds: 98,
        completedAt: '2026-11-14T15:02:00.000Z',
        attemptNumber: 1,
        requiredAttempts: 2,
        minScore: 700,
        metMinScore: true,
      },
      {
        id: 'sub_07',
        studentId: 'st_6a2_01',
        studentName: 'Võ Quốc Khánh',
        studentCode: '6A2-01',
        schoolId: 'school_nd',
        classId: 'class_nd_6a2',
        taskId: 'task_6a2_1',
        taskTitle: 'Nhận diện cổng kết nối & Bộ nhớ',
        score: 667,
        correctCount: 2,
        totalCount: 3,
        durationSeconds: 150,
        completedAt: '2026-11-14T16:20:00.000Z',
        attemptNumber: 1,
        requiredAttempts: 1,
        minScore: 700,
        metMinScore: false,
      },
    ],
    breakStates: [
      {
        studentId: 'st_6a1_01',
        status: 'active',
        totalGrantedSeconds: 900,
        remainingSeconds: 640,
        unlockedAt: '2026-11-14T10:05:00.000Z',
        updatedAt: now,
      },
      {
        studentId: 'st_6a1_02',
        status: 'locked',
        totalGrantedSeconds: 0,
        remainingSeconds: 0,
        updatedAt: now,
      },
      {
        studentId: 'st_6a1_demo',
        status: 'active',
        totalGrantedSeconds: 3600,
        remainingSeconds: 3600,
        unlockedAt: now,
        updatedAt: now,
      },
    ],
    battleConfigs: [
      {
        classId: 'class_nd_6a1',
        isEnabled: true,
        title: 'Đấu trường Tốc độ IC3 — Lớp 6A1',
        questionSetId: 'set_battle_all',
        questionSetName: 'Bộ đề Thi đấu Tổng hợp IC3 (10 câu)',
        teacherName: 'Cô Trần Thanh Hà',
        moduleFilter: 'all',
        questionIds: [
          'q_cf_single_01',
          'q_cf_multi_01',
          'q_cf_tf_01',
          'q_cf_match_01',
          'q_cf_hotspot_01',
          'q_ka_hotspot_word',
          'q_ka_hotspot_excel',
          'q_ka_single_01',
          'q_lo_hotspot_browser',
          'q_lo_single_01',
        ],
        fastComboWindowSeconds: 15,
        topRewardCount: 3,
        breakRewardMinutes: 10,
        timeLimitSeconds: 300,
        updatedAt: now,
      },
      {
        classId: 'class_nd_6a2',
        isEnabled: false,
        title: 'Đấu trường IC3 — Lớp 6A2',
        questionSetId: 'set_lv1_gm1',
        questionSetName: 'LV1 — GMetrix Nền tảng Phần cứng & Hệ điều hành',
        teacherName: 'Cô Trần Thanh Hà',
        moduleFilter: 'computing_fundamentals',
        questionIds: [
          'q_cf_single_01',
          'q_cf_multi_01',
          'q_cf_tf_01',
          'q_cf_match_01',
          'q_cf_hotspot_01',
        ],
        fastComboWindowSeconds: 20,
        topRewardCount: 3,
        breakRewardMinutes: 10,
        timeLimitSeconds: 240,
        updatedAt: now,
      },
    ],
    battleRooms: [
      {
        id: 'room_6a1_live',
        classId: 'class_nd_6a1',
        status: 'lobby',
        questionIds: [
          'q_cf_single_01',
          'q_cf_multi_01',
          'q_cf_tf_01',
          'q_cf_match_01',
          'q_cf_hotspot_01',
          'q_ka_hotspot_word',
          'q_ka_hotspot_excel',
          'q_ka_single_01',
          'q_lo_hotspot_browser',
          'q_lo_single_01',
        ],
        configSnapshot: {
          classId: 'class_nd_6a1',
          isEnabled: true,
          title: 'Đấu trường Tốc độ IC3 — Lớp 6A1',
          questionSetId: 'set_battle_all',
          questionSetName: 'Bộ đề Thi đấu Tổng hợp IC3 (10 câu)',
          teacherName: 'Cô Trần Thanh Hà',
          moduleFilter: 'all',
          questionIds: [
            'q_cf_single_01',
            'q_cf_multi_01',
            'q_cf_tf_01',
            'q_cf_match_01',
            'q_cf_hotspot_01',
            'q_ka_hotspot_word',
            'q_ka_hotspot_excel',
            'q_ka_single_01',
            'q_lo_hotspot_browser',
            'q_lo_single_01',
          ],
          fastComboWindowSeconds: 15,
          topRewardCount: 3,
          breakRewardMinutes: 10,
          timeLimitSeconds: 300,
          updatedAt: now,
        },
        participants: [
          {
            roomId: 'room_6a1_live',
            studentId: 'st_6a1_01',
            studentName: 'Đỗ Gia Huy',
            studentCode: '6A1-01',
            connected: true,
            answeredCount: 0,
            correctCount: 0,
            score: 0,
            durationSeconds: 0,
            finished: false,
            shieldCharges: 0,
            pendingCardChoices: 0,
            attacksUsed: 0,
            defensesUsed: 0,
            attacksBlocked: 0,
            activeDebuffs: [],
            currentPairCount: 0,
            currentPairElapsedSeconds: 0,
            joinedAt: '2026-11-15T07:55:00.000Z',
          },
          {
            roomId: 'room_6a1_live',
            studentId: 'st_6a1_02',
            studentName: 'Nguyễn Văn An',
            studentCode: '6A1-02',
            connected: true,
            answeredCount: 0,
            correctCount: 0,
            score: 0,
            durationSeconds: 0,
            finished: false,
            shieldCharges: 0,
            pendingCardChoices: 0,
            attacksUsed: 0,
            defensesUsed: 0,
            attacksBlocked: 0,
            activeDebuffs: [],
            currentPairCount: 0,
            currentPairElapsedSeconds: 0,
            joinedAt: '2026-11-15T07:56:00.000Z',
          },
          {
            roomId: 'room_6a1_live',
            studentId: 'st_6a1_03',
            studentName: 'Trần Minh Thư',
            studentCode: '6A1-03',
            connected: true,
            answeredCount: 0,
            correctCount: 0,
            score: 0,
            durationSeconds: 0,
            finished: false,
            shieldCharges: 0,
            pendingCardChoices: 0,
            attacksUsed: 0,
            defensesUsed: 0,
            attacksBlocked: 0,
            activeDebuffs: [],
            currentPairCount: 0,
            currentPairElapsedSeconds: 0,
            joinedAt: '2026-11-15T07:57:00.000Z',
          },
          {
            roomId: 'room_6a1_live',
            studentId: 'st_6a1_04',
            studentName: 'Lê Hoàng Phúc',
            studentCode: '6A1-04',
            connected: true,
            answeredCount: 0,
            correctCount: 0,
            score: 0,
            durationSeconds: 0,
            finished: false,
            shieldCharges: 0,
            pendingCardChoices: 0,
            attacksUsed: 0,
            defensesUsed: 0,
            attacksBlocked: 0,
            activeDebuffs: [],
            currentPairCount: 0,
            currentPairElapsedSeconds: 0,
            joinedAt: '2026-11-15T07:58:00.000Z',
          },
        ],
        events: [
          {
            id: 'ev_1',
            roomId: 'room_6a1_live',
            type: 'join',
            message: 'Đỗ Gia Huy (6A1-01) đã vào phòng chờ thi đấu.',
            actorStudentId: 'st_6a1_01',
            actorStudentName: 'Đỗ Gia Huy',
            createdAt: '2026-11-15T07:55:00.000Z',
          },
          {
            id: 'ev_2',
            roomId: 'room_6a1_live',
            type: 'join',
            message: 'Nguyễn Văn An (6A1-02) đã vào phòng chờ thi đấu.',
            actorStudentId: 'st_6a1_02',
            actorStudentName: 'Nguyễn Văn An',
            createdAt: '2026-11-15T07:56:00.000Z',
          },
          {
            id: 'ev_3',
            roomId: 'room_6a1_live',
            type: 'join',
            message: 'Trần Minh Thư (6A1-03) đã vào phòng chờ thi đấu.',
            actorStudentId: 'st_6a1_03',
            actorStudentName: 'Trần Minh Thư',
            createdAt: '2026-11-15T07:57:00.000Z',
          },
          {
            id: 'ev_4',
            roomId: 'room_6a1_live',
            type: 'join',
            message: 'Lê Hoàng Phúc (6A1-04) đã vào phòng chờ thi đấu.',
            actorStudentId: 'st_6a1_04',
            actorStudentName: 'Lê Hoàng Phúc',
            createdAt: '2026-11-15T07:58:00.000Z',
          },
        ],
        createdAt: '2026-11-15T07:54:00.000Z',
      },
      {
        id: 'room_6a1_history_01',
        classId: 'class_nd_6a1',
        status: 'finished',
        questionIds: [
          'q_cf_single_01',
          'q_cf_multi_01',
          'q_cf_tf_01',
          'q_cf_match_01',
          'q_cf_hotspot_01',
        ],
        configSnapshot: {
          classId: 'class_nd_6a1',
          isEnabled: true,
          title: 'Giải đấu Khởi động LV1 — Tuần 11',
          questionSetId: 'set_lv1_gm1',
          questionSetName: 'LV1 — GMetrix Nền tảng Phần cứng & Hệ điều hành',
          teacherName: 'Cô Trần Thanh Hà',
          moduleFilter: 'computing_fundamentals',
          questionIds: [
            'q_cf_single_01',
            'q_cf_multi_01',
            'q_cf_tf_01',
            'q_cf_match_01',
            'q_cf_hotspot_01',
          ],
          fastComboWindowSeconds: 15,
          topRewardCount: 2,
          breakRewardMinutes: 10,
          timeLimitSeconds: 180,
          updatedAt: '2026-11-08T09:00:00.000Z',
        },
        startedAt: '2026-11-08T09:00:00.000Z',
        finishedAt: '2026-11-08T09:03:00.000Z',
        rankedResults: [
          {
            rank: 1,
            studentId: 'st_6a1_03',
            studentName: 'Trần Minh Thư',
            studentCode: '6A1-03',
            score: 1000,
            correctCount: 5,
            totalQuestions: 5,
            durationSeconds: 78,
            rewardedBreakMinutes: 10,
          },
          {
            rank: 2,
            studentId: 'st_6a1_01',
            studentName: 'Đỗ Gia Huy',
            studentCode: '6A1-01',
            score: 800,
            correctCount: 4,
            totalQuestions: 5,
            durationSeconds: 92,
            rewardedBreakMinutes: 10,
          },
          {
            rank: 3,
            studentId: 'st_6a1_02',
            studentName: 'Nguyễn Văn An',
            studentCode: '6A1-02',
            score: 800,
            correctCount: 4,
            totalQuestions: 5,
            durationSeconds: 114,
            rewardedBreakMinutes: 0,
          },
        ],
        participants: [],
        events: [
          {
            id: 'ev_hist_1',
            roomId: 'room_6a1_history_01',
            type: 'finish',
            message: 'Trận đấu kết thúc. Trần Minh Thư giành hạng 1 với 1000 điểm (78s).',
            createdAt: '2026-11-08T09:03:00.000Z',
          },
        ],
        createdAt: '2026-11-08T08:55:00.000Z',
      },
    ],
  };
}
