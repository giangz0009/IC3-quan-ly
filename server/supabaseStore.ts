import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminDatabase,
  AdminTaskStatRecord,
  AdminTeacher,
  BattleDebuffType,
  BattleEvent,
  BattleParticipant,
  BattleRoomState,
  ClassBattleConfig,
  ClassTaskConfig,
  IC3ModuleRecord,
  KnowledgeCategoryRecord,
  KnowledgePart,
  Question,
  QuestionSet,
  School,
  SchoolClass,
  StudentBreakState,
  StudentProfile,
} from '../src/types/ic3.js';
import {
  buildAdminTeachersSupabasePayload,
  buildQuestionBankSupabasePayload,
  calculateIC3Score,
  collectHotspotStoragePathsToDelete,
  getDefaultInstructionForQuestionType,
  getNextTopicOrder,
  getObsoleteHotspotStoragePath,
  isStudentBreakUnlocked,
  normalizeAdminRole,
  normalizeTeacherStatus,
  normalizeVietnamesePassword,
  rankBattleParticipants,
} from '../src/utils/ic3Rules.js';
import {
  buildFullDatabaseSupabasePayload,
  ensureSupabaseUuid,
  mapBattleConfigRowToDomain,
  mapBattleConfigToRow,
  mapBattleEventToRow,
  mapBattleParticipantToRow,
  mapBattleRoomsFromRows,
  mapBattleRoomToRow,
  mapBreakStateRowToDomain,
  mapBreakStateToRow,
  mapClassRowToDomain,
  mapClassTaskConfigToRow,
  mapClassTaskConfigsFromRows,
  mapClassTaskItemToRow,
  mapClassToRow,
  mapQuestionBankRowsToDomain,
  mapSchoolRowToDomain,
  mapSchoolToRow,
  mapStudentRowToDomain,
  mapStudentToRow,
  mapSubmissionToRow,
  mapSubmissionsFromRows,
  mapTeacherRowToDomain,
} from '../src/utils/supabaseMappers.js';
import { hashTeacherPassword, makeId, makeUuid } from './security.js';

export const HOTSPOT_STORAGE_BUCKET = 'hotspot-images';

export class SupabaseStoreError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SupabaseStoreError';
    this.status = status;
  }
}

export interface SupabaseSyncStatus {
  configured: boolean;
  ok: boolean;
  error?: string;
  count?: number;
}

export interface ServerTableCheck {
  table: string;
  label: string;
  ok: boolean;
  remoteCount: number | null;
  localCount: number | null;
  error?: string;
}

export interface ServerConnectionReport {
  ok: boolean;
  message: string;
  latencyMs?: number;
  tablesChecked: number;
  readyTables: number;
  tableChecks: ServerTableCheck[];
}

function assertNoError(
  error: { message: string; code?: string } | null | undefined,
  context: string
): void {
  if (error) {
    throw new SupabaseStoreError(502, `${context}: ${error.message}`);
  }
}

// =========================================================================
// Auth & Teachers
// =========================================================================

function isMissingColumnError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  if (!error) return false;
  const msg = String(error.message ?? '').toLowerCase();
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    msg.includes('could not find the')
  );
}

const TEACHER_SELECT_COLUMNS =
  'user_id, full_name, email, password_hash, role, status, created_at';

export async function findAdminTeacherInSupabaseByEmail(
  client: SupabaseClient,
  email: string
): Promise<{
  row: Record<string, unknown> | null;
  tableHasRows: boolean;
}> {
  const cleanEmail = email.trim().toLowerCase();
  const escapedPattern = cleanEmail.replace(/[\\%_]/g, '\\$&');

  let { data: rows, error: rowErr } = await client
    .from('admin_teachers')
    .select(TEACHER_SELECT_COLUMNS)
    .ilike('email', escapedPattern)
    .limit(1);

  if (isMissingColumnError(rowErr)) {
    const retry = await client
      .from('admin_teachers')
      .select('*')
      .ilike('email', escapedPattern)
      .limit(1);
    rows = retry.data;
    rowErr = retry.error;
  }

  let { count, error: countErr } = await client
    .from('admin_teachers')
    .select('user_id', { count: 'exact', head: true });

  if (isMissingColumnError(countErr)) {
    const retryCount = await client
      .from('admin_teachers')
      .select('*', { count: 'exact', head: true });
    count = retryCount.count;
    countErr = retryCount.error;
  }

  assertNoError(rowErr, 'Lỗi truy vấn tài khoản giáo viên trên Supabase');
  assertNoError(countErr, 'Lỗi kiểm tra bảng admin_teachers trên Supabase');

  const row =
    Array.isArray(rows) && rows.length > 0
      ? (rows[0] as Record<string, unknown>)
      : null;

  return {
    row,
    tableHasRows: (count ?? 0) > 0,
  };
}

export async function getTeacherFromSupabaseById(
  client: SupabaseClient,
  userId: string,
  emailHint?: string
): Promise<{ teacher: AdminTeacher | null; tableHasRows: boolean }> {
  let { data: rows, error: rowErr } = await client
    .from('admin_teachers')
    .select(TEACHER_SELECT_COLUMNS)
    .eq('user_id', userId)
    .limit(1);

  if (isMissingColumnError(rowErr)) {
    const retry = await client
      .from('admin_teachers')
      .select('*')
      .eq('user_id', userId)
      .limit(1);
    rows = retry.data;
    rowErr = retry.error;
  }

  let matchedRow =
    Array.isArray(rows) && rows.length > 0
      ? (rows[0] as Record<string, unknown>)
      : null;

  if (!matchedRow && emailHint?.trim()) {
    const escaped = emailHint.trim().toLowerCase().replace(/[\\%_]/g, '\\$&');
    let byEmail = await client
      .from('admin_teachers')
      .select(TEACHER_SELECT_COLUMNS)
      .ilike('email', escaped)
      .limit(1);
    if (isMissingColumnError(byEmail.error)) {
      byEmail = await client
        .from('admin_teachers')
        .select('*')
        .ilike('email', escaped)
        .limit(1);
    }
    if (!byEmail.error && Array.isArray(byEmail.data) && byEmail.data.length > 0) {
      matchedRow = byEmail.data[0] as Record<string, unknown>;
    }
  }

  let { count, error: countErr } = await client
    .from('admin_teachers')
    .select('user_id', { count: 'exact', head: true });

  if (isMissingColumnError(countErr)) {
    const retryCount = await client
      .from('admin_teachers')
      .select('*', { count: 'exact', head: true });
    count = retryCount.count;
    countErr = retryCount.error;
  }

  assertNoError(rowErr, 'Lỗi truy vấn tài khoản giáo viên trên Supabase');
  assertNoError(countErr, 'Lỗi kiểm tra bảng admin_teachers trên Supabase');

  return {
    teacher: matchedRow ? mapTeacherRowToDomain(matchedRow) : null,
    tableHasRows: (count ?? 0) > 0,
  };
}

export async function listTeachersFromSupabase(
  client: SupabaseClient
): Promise<AdminTeacher[]> {
  let { data, error } = await client
    .from('admin_teachers')
    .select(TEACHER_SELECT_COLUMNS)
    .order('created_at', { ascending: true });
  if (isMissingColumnError(error)) {
    const retry = await client
      .from('admin_teachers')
      .select('*');
    data = retry.data;
    error = retry.error;
  }
  assertNoError(error, 'Không thể đọc danh sách giáo viên từ Supabase');
  return (data ?? []).map((row) =>
    mapTeacherRowToDomain(row as Record<string, unknown>)
  );
}

export async function syncTeachersToSupabaseServer(
  client: SupabaseClient,
  teachers: AdminTeacher[]
): Promise<SupabaseSyncStatus> {
  const payload = buildAdminTeachersSupabasePayload(teachers);
  if (payload.length === 0) {
    return { configured: true, ok: true, count: 0 };
  }
  try {
    const { data: existingRows, error: selectErr } = await client
      .from('admin_teachers')
      .select('user_id, email');
    if (selectErr) {
      return { configured: true, ok: false, error: selectErr.message };
    }

    const existingByUserId = new Map<string, string>();
    const existingByEmail = new Map<string, string>();
    for (const row of existingRows ?? []) {
      const uid = String(row.user_id ?? '').trim();
      const em = String(row.email ?? '').trim().toLowerCase();
      if (uid) existingByUserId.set(uid, em);
      if (em && uid) existingByEmail.set(em, uid);
    }

    const usedTargetIds = new Set<string>();
    const alignedPayload = payload.map((item) => {
      let targetUserId = item.user_id;
      const emailOwnerId = existingByEmail.get(item.email);
      if (
        emailOwnerId &&
        !existingByUserId.has(item.user_id) &&
        !usedTargetIds.has(emailOwnerId)
      ) {
        targetUserId = emailOwnerId;
      }
      usedTargetIds.add(targetUserId);
      return {
        ...item,
        user_id: targetUserId,
      };
    });

    const { error: upsertErr } = await client
      .from('admin_teachers')
      .upsert(alignedPayload, { onConflict: 'user_id' });
    if (upsertErr) {
      return { configured: true, ok: false, error: upsertErr.message };
    }
    return { configured: true, ok: true, count: alignedPayload.length };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Lỗi đồng bộ giáo viên lên Supabase.',
    };
  }
}

export async function upsertSingleTeacherOnSupabaseServer(
  client: SupabaseClient,
  teacher: AdminTeacher,
  previousEmail?: string
): Promise<SupabaseSyncStatus> {
  try {
    const { data: existingRows, error: selectErr } = await client
      .from('admin_teachers')
      .select('user_id, email');
    if (selectErr) {
      return { configured: true, ok: false, error: selectErr.message };
    }

    const cleanEmail = teacher.email.trim().toLowerCase();
    const prevCleanEmail = previousEmail?.trim().toLowerCase();

    const matchedById = (existingRows ?? []).find(
      (r) => String(r.user_id ?? '').trim() === teacher.userId
    );
    const matchedByPrevEmail = prevCleanEmail
      ? (existingRows ?? []).find(
          (r) => String(r.email ?? '').trim().toLowerCase() === prevCleanEmail
        )
      : undefined;
    const matchedByEmail = (existingRows ?? []).find(
      (r) => String(r.email ?? '').trim().toLowerCase() === cleanEmail
    );

    const targetUserId = String(
      matchedById?.user_id ??
        matchedByPrevEmail?.user_id ??
        matchedByEmail?.user_id ??
        teacher.userId
    ).trim();

    if (
      matchedByEmail &&
      String(matchedByEmail.user_id ?? '').trim() !== targetUserId
    ) {
      return {
        configured: true,
        ok: false,
        error: `Email ${cleanEmail} đã thuộc tài khoản khác trên Supabase.`,
      };
    }

    const row = buildAdminTeachersSupabasePayload([teacher])[0];
    if (!row) {
      return {
        configured: true,
        ok: false,
        error: 'Dữ liệu giáo viên không hợp lệ.',
      };
    }

    const { error: upsertErr } = await client
      .from('admin_teachers')
      .upsert({ ...row, user_id: targetUserId }, { onConflict: 'user_id' });
    if (upsertErr) {
      return { configured: true, ok: false, error: upsertErr.message };
    }
    return { configured: true, ok: true, count: 1 };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Lỗi cập nhật giáo viên trên Supabase.',
    };
  }
}

export async function deleteTeacherOnSupabaseServer(
  client: SupabaseClient,
  teacher: Pick<AdminTeacher, 'userId' | 'email'>
): Promise<SupabaseSyncStatus> {
  try {
    const { error: idErr } = await client
      .from('admin_teachers')
      .delete()
      .eq('user_id', teacher.userId);
    if (idErr) {
      return { configured: true, ok: false, error: idErr.message };
    }
    const cleanEmail = teacher.email.trim().toLowerCase();
    if (cleanEmail) {
      const { error: emailErr } = await client
        .from('admin_teachers')
        .delete()
        .eq('email', cleanEmail);
      if (emailErr) {
        return { configured: true, ok: false, error: emailErr.message };
      }
    }
    return { configured: true, ok: true, count: 1 };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error:
        err instanceof Error ? err.message : 'Lỗi xóa giáo viên trên Supabase.',
    };
  }
}

// =========================================================================
// Full Bootstrap Read (17 Tables)
// =========================================================================

export async function fetchAdminDatabaseFromSupabase(
  client: SupabaseClient,
  options?: { includeTeachers?: boolean; seedFallbackTeachers?: AdminTeacher[] }
): Promise<AdminDatabase> {
  const [
    schoolsRes,
    classesRes,
    studentsRes,
    teachersRes,
    modulesRes,
    categoriesRes,
    partsRes,
    questionsRes,
    setsRes,
    taskConfigsRes,
    tasksRes,
    submissionsRes,
    breakStatesRes,
    battleConfigsRes,
    battleRoomsRes,
    battleParticipantsRes,
    battleEventsRes,
  ] = await Promise.all([
    client.from('schools').select('*').order('created_at', { ascending: true }),
    client.from('classes').select('*').order('created_at', { ascending: true }),
    client.from('students').select('*').order('created_at', { ascending: true }),
    options?.includeTeachers
      ? client
          .from('admin_teachers')
          .select('user_id, full_name, email, password_hash, role, status, created_at')
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    client
      .from('ic3_modules')
      .select('*')
      .order('order_index', { ascending: true }),
    client
      .from('knowledge_categories')
      .select('*')
      .order('module', { ascending: true })
      .order('order_index', { ascending: true }),
    client
      .from('knowledge_parts')
      .select('*')
      .order('level', { ascending: true })
      .order('category', { ascending: true })
      .order('order_index', { ascending: true }),
    client
      .from('questions')
      .select('*')
      .order('level', { ascending: true })
      .order('category', { ascending: true })
      .order('content_code', { ascending: true })
      .order('topic_order', { ascending: true }),
    client
      .from('question_sets')
      .select('*')
      .order('created_at', { ascending: false }),
    client.from('class_task_configs').select('*'),
    client
      .from('class_tasks')
      .select('*')
      .order('order_index', { ascending: true }),
    client
      .from('student_task_submissions')
      .select('*')
      .order('completed_at', { ascending: false }),
    client.from('student_break_states').select('*'),
    client.from('class_battle_configs').select('*'),
    client
      .from('battle_rooms')
      .select('*')
      .order('created_at', { ascending: false }),
    client.from('battle_participants').select('*'),
    client
      .from('battle_events')
      .select('*')
      .order('created_at', { ascending: false }),
  ]);

  assertNoError(schoolsRes.error, 'Lỗi đọc bảng schools');
  assertNoError(classesRes.error, 'Lỗi đọc bảng classes');
  assertNoError(studentsRes.error, 'Lỗi đọc bảng students');
  assertNoError(teachersRes.error, 'Lỗi đọc bảng admin_teachers');
  assertNoError(modulesRes.error, 'Lỗi đọc bảng ic3_modules');
  assertNoError(categoriesRes.error, 'Lỗi đọc bảng knowledge_categories');
  assertNoError(partsRes.error, 'Lỗi đọc bảng knowledge_parts');
  assertNoError(questionsRes.error, 'Lỗi đọc bảng questions');
  assertNoError(setsRes.error, 'Lỗi đọc bảng question_sets');
  assertNoError(taskConfigsRes.error, 'Lỗi đọc bảng class_task_configs');
  assertNoError(tasksRes.error, 'Lỗi đọc bảng class_tasks');
  assertNoError(submissionsRes.error, 'Lỗi đọc bảng student_task_submissions');
  assertNoError(breakStatesRes.error, 'Lỗi đọc bảng student_break_states');
  assertNoError(battleConfigsRes.error, 'Lỗi đọc bảng class_battle_configs');
  assertNoError(battleRoomsRes.error, 'Lỗi đọc bảng battle_rooms');
  assertNoError(battleParticipantsRes.error, 'Lỗi đọc bảng battle_participants');
  assertNoError(battleEventsRes.error, 'Lỗi đọc bảng battle_events');

  const schools = (schoolsRes.data ?? []).map((r) =>
    mapSchoolRowToDomain(r as Record<string, unknown>)
  );
  const classes = (classesRes.data ?? []).map((r) =>
    mapClassRowToDomain(r as Record<string, unknown>)
  );
  const students = (studentsRes.data ?? []).map((r) =>
    mapStudentRowToDomain(r as Record<string, unknown>)
  );
  let teachers = (teachersRes.data ?? []).map((r) =>
    mapTeacherRowToDomain(r as Record<string, unknown>)
  );
  if (
    options?.includeTeachers &&
    teachers.length === 0 &&
    options.seedFallbackTeachers?.length
  ) {
    teachers = options.seedFallbackTeachers;
  }

  const qb = mapQuestionBankRowsToDomain({
    moduleRows: (modulesRes.data ?? []) as Array<Record<string, unknown>>,
    categoryRows: (categoriesRes.data ?? []) as Array<Record<string, unknown>>,
    partRows: (partsRes.data ?? []) as Array<Record<string, unknown>>,
    questionRows: (questionsRes.data ?? []) as Array<Record<string, unknown>>,
    setRows: (setsRes.data ?? []) as Array<Record<string, unknown>>,
  });

  const classTaskConfigs = mapClassTaskConfigsFromRows(
    (taskConfigsRes.data ?? []) as Array<Record<string, unknown>>,
    (tasksRes.data ?? []) as Array<Record<string, unknown>>
  );

  const submissions = mapSubmissionsFromRows(
    (submissionsRes.data ?? []) as Array<Record<string, unknown>>,
    students,
    classTaskConfigs
  );

  const breakStates = (breakStatesRes.data ?? []).map((r) =>
    mapBreakStateRowToDomain(r as Record<string, unknown>)
  );

  const battleConfigs = (battleConfigsRes.data ?? []).map((r) =>
    mapBattleConfigRowToDomain(r as Record<string, unknown>)
  );

  const battleRooms = mapBattleRoomsFromRows(
    (battleRoomsRes.data ?? []) as Array<Record<string, unknown>>,
    (battleParticipantsRes.data ?? []) as Array<Record<string, unknown>>,
    (battleEventsRes.data ?? []) as Array<Record<string, unknown>>
  );

  return {
    schools,
    classes,
    students,
    teachers,
    modules: qb.modules,
    knowledgeCategories: qb.knowledgeCategories,
    knowledgeParts: qb.knowledgeParts,
    questions: qb.questions,
    questionSets: qb.questionSets,
    classTaskConfigs,
    submissions,
    breakStates,
    battleConfigs,
    battleRooms,
  };
}

// =========================================================================
// Schools, Classes & Students
// =========================================================================

export async function createSchoolOnSupabase(
  client: SupabaseClient,
  input: { name: string; district: string }
): Promise<School> {
  const school: School = {
    id: makeId('school'),
    name: input.name.trim(),
    district: input.district.trim(),
    createdAt: new Date().toISOString(),
  };
  const { error } = await client.from('schools').insert(mapSchoolToRow(school));
  assertNoError(error, 'Lỗi tạo trường học trên Supabase');
  return school;
}

export async function updateSchoolOnSupabase(
  client: SupabaseClient,
  id: string,
  input: { name?: string; district?: string }
): Promise<School> {
  const { data: existing, error: fetchErr } = await client
    .from('schools')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm trường học trên Supabase');
  if (!existing) {
    throw new SupabaseStoreError(404, 'Không tìm thấy trường.');
  }
  const current = mapSchoolRowToDomain(existing as Record<string, unknown>);
  const next: School = {
    ...current,
    name: input.name?.trim() || current.name,
    district: input.district?.trim() || current.district,
  };
  const { error: updErr } = await client
    .from('schools')
    .update({ name: next.name, district: next.district })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi cập nhật trường học trên Supabase');
  return next;
}

export async function deleteSchoolOnSupabase(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from('schools').delete().eq('id', id);
  assertNoError(error, 'Lỗi xóa trường học trên Supabase');
}

export async function createClassOnSupabase(
  client: SupabaseClient,
  input: { schoolId: string; name: string; grade: string }
): Promise<SchoolClass> {
  const { data: schoolRow, error: sErr } = await client
    .from('schools')
    .select('id')
    .eq('id', input.schoolId)
    .maybeSingle();
  assertNoError(sErr, 'Lỗi kiểm tra trường học trên Supabase');
  if (!schoolRow) {
    throw new SupabaseStoreError(404, 'Trường học không tồn tại.');
  }
  const cls: SchoolClass = {
    id: makeId('class'),
    schoolId: input.schoolId,
    name: input.name.trim(),
    grade: input.grade.trim(),
    createdAt: new Date().toISOString(),
  };
  const { error } = await client.from('classes').insert(mapClassToRow(cls));
  assertNoError(error, 'Lỗi tạo lớp học trên Supabase');
  return cls;
}

export async function updateClassOnSupabase(
  client: SupabaseClient,
  id: string,
  input: { name?: string; grade?: string }
): Promise<SchoolClass> {
  const { data: existing, error: fetchErr } = await client
    .from('classes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm lớp học trên Supabase');
  if (!existing) {
    throw new SupabaseStoreError(404, 'Không tìm thấy lớp.');
  }
  const current = mapClassRowToDomain(existing as Record<string, unknown>);
  const next: SchoolClass = {
    ...current,
    name: input.name?.trim() || current.name,
    grade: input.grade?.trim() || current.grade,
  };
  const { error: updErr } = await client
    .from('classes')
    .update({ name: next.name, grade: next.grade })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi cập nhật lớp học trên Supabase');
  return next;
}

export async function deleteClassOnSupabase(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from('classes').delete().eq('id', id);
  assertNoError(error, 'Lỗi xóa lớp học trên Supabase');
}

export async function createStudentOnSupabase(
  client: SupabaseClient,
  input: {
    classId: string;
    fullName: string;
    studentCode: string;
    alwaysBreakReady?: boolean;
  }
): Promise<StudentProfile> {
  const { data: clsRow, error: clsErr } = await client
    .from('classes')
    .select('id')
    .eq('id', input.classId)
    .maybeSingle();
  assertNoError(clsErr, 'Lỗi kiểm tra lớp học trên Supabase');
  if (!clsRow) {
    throw new SupabaseStoreError(404, 'Lớp học không tồn tại.');
  }

  const trimmedCode = input.studentCode.trim().toUpperCase();
  const { data: existingStudents, error: stErr } = await client
    .from('students')
    .select('id, student_code')
    .eq('class_id', input.classId);
  assertNoError(stErr, 'Lỗi kiểm tra mã học sinh trên Supabase');

  if (
    (existingStudents ?? []).some(
      (s) => String(s.student_code ?? '').toUpperCase() === trimmedCode
    )
  ) {
    throw new SupabaseStoreError(
      409,
      `Mã học sinh ${trimmedCode} đã tồn tại trong lớp.`
    );
  }

  const trimmedName = input.fullName.trim();
  const student: StudentProfile = {
    id: makeId('st'),
    classId: input.classId,
    fullName: trimmedName,
    studentCode: trimmedCode,
    passwordHash: normalizeVietnamesePassword(trimmedName),
    isCustomPassword: false,
    alwaysBreakReady: Boolean(input.alwaysBreakReady),
    createdAt: new Date().toISOString(),
  };

  const { error: insErr } = await client
    .from('students')
    .insert(mapStudentToRow(student));
  assertNoError(insErr, 'Lỗi thêm học sinh lên Supabase');
  return student;
}

export async function batchCreateStudentsOnSupabase(
  client: SupabaseClient,
  classId: string,
  rows: Array<{ fullName?: unknown; studentCode?: unknown }>
): Promise<{ created: StudentProfile[]; skipped: string[] }> {
  const { data: clsRow, error: clsErr } = await client
    .from('classes')
    .select('id')
    .eq('id', classId)
    .maybeSingle();
  assertNoError(clsErr, 'Lỗi kiểm tra lớp học trên Supabase');
  if (!clsRow) {
    throw new SupabaseStoreError(404, 'Lớp học không tồn tại.');
  }

  const { data: existingRows, error: stErr } = await client
    .from('students')
    .select('student_code')
    .eq('class_id', classId);
  assertNoError(stErr, 'Lỗi đọc danh sách học sinh lớp trên Supabase');

  const existingCodes = new Set(
    (existingRows ?? []).map((r) => String(r.student_code ?? '').toUpperCase())
  );

  const created: StudentProfile[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const fullName = String(row.fullName ?? '').trim();
    const studentCode = String(row.studentCode ?? '').trim().toUpperCase();
    if (!fullName || !studentCode) continue;

    if (existingCodes.has(studentCode)) {
      skipped.push(studentCode);
      continue;
    }
    existingCodes.add(studentCode);
    created.push({
      id: makeId('st'),
      classId,
      fullName,
      studentCode,
      passwordHash: normalizeVietnamesePassword(fullName),
      isCustomPassword: false,
      alwaysBreakReady: false,
      createdAt: new Date().toISOString(),
    });
  }

  if (created.length > 0) {
    const { error: insErr } = await client
      .from('students')
      .insert(created.map(mapStudentToRow));
    assertNoError(insErr, 'Lỗi nhập hàng loạt học sinh lên Supabase');
  }

  return { created, skipped };
}

export async function updateStudentOnSupabase(
  client: SupabaseClient,
  id: string,
  input: {
    fullName?: string;
    studentCode?: string;
    alwaysBreakReady?: boolean;
  }
): Promise<StudentProfile> {
  const { data: existing, error: fetchErr } = await client
    .from('students')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm học sinh trên Supabase');
  if (!existing) {
    throw new SupabaseStoreError(404, 'Không tìm thấy học sinh.');
  }

  const student = mapStudentRowToDomain(existing as Record<string, unknown>);
  if (input.fullName && input.fullName.trim()) {
    student.fullName = input.fullName.trim();
    if (!student.isCustomPassword) {
      student.passwordHash = normalizeVietnamesePassword(student.fullName);
    }
  }
  if (input.studentCode && input.studentCode.trim()) {
    student.studentCode = input.studentCode.trim().toUpperCase();
  }
  if (typeof input.alwaysBreakReady === 'boolean') {
    student.alwaysBreakReady = input.alwaysBreakReady;
  }

  const { error: updErr } = await client
    .from('students')
    .update({
      full_name: student.fullName,
      student_code: student.studentCode,
      password_hash: student.passwordHash,
      always_break_ready: student.alwaysBreakReady,
    })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi cập nhật học sinh trên Supabase');
  return student;
}

export async function deleteStudentOnSupabase(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from('students').delete().eq('id', id);
  assertNoError(error, 'Lỗi xóa học sinh trên Supabase');
}

export async function resetStudentPasswordOnSupabase(
  client: SupabaseClient,
  id: string
): Promise<StudentProfile> {
  const { data: existing, error: fetchErr } = await client
    .from('students')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm học sinh trên Supabase');
  if (!existing) {
    throw new SupabaseStoreError(404, 'Không tìm thấy học sinh.');
  }
  const student = mapStudentRowToDomain(existing as Record<string, unknown>);
  student.passwordHash = normalizeVietnamesePassword(student.fullName);
  student.isCustomPassword = false;

  const { error: updErr } = await client
    .from('students')
    .update({
      password_hash: student.passwordHash,
      is_custom_password: false,
    })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi đặt lại mật khẩu học sinh trên Supabase');
  return student;
}

export async function resetClassPasswordsOnSupabase(
  client: SupabaseClient,
  classId: string
): Promise<number> {
  const { data: rows, error: fetchErr } = await client
    .from('students')
    .select('*')
    .eq('class_id', classId);
  assertNoError(fetchErr, 'Lỗi đọc danh sách học sinh lớp trên Supabase');

  const students = (rows ?? []).map((r) =>
    mapStudentRowToDomain(r as Record<string, unknown>)
  );
  if (students.length === 0) return 0;

  await Promise.all(
    students.map(async (st) => {
      const nextHash = normalizeVietnamesePassword(st.fullName);
      const { error } = await client
        .from('students')
        .update({ password_hash: nextHash, is_custom_password: false })
        .eq('id', st.id);
      assertNoError(error, `Lỗi đặt lại mật khẩu cho học sinh ${st.studentCode}`);
    })
  );
  return students.length;
}

// =========================================================================
// Question Bank (4-Tier Hierarchy + Sets + Storage)
// =========================================================================

async function ensureModuleParentRaw(
  client: SupabaseClient,
  moduleCode: string,
  level: string
): Promise<void> {
  const { data: existing, error: fetchErr } = await client
    .from('ic3_modules')
    .select('id, code')
    .eq('code', moduleCode)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi kiểm tra Mô-đun trên Supabase');
  if (existing) return;

  const { count } = await client
    .from('ic3_modules')
    .select('id', { count: 'exact', head: true });
  const cleanLevel = level.trim().toUpperCase() || moduleCode.toUpperCase();
  const { error } = await client.from('ic3_modules').upsert(
    {
      id: makeId('mod'),
      code: moduleCode,
      level: cleanLevel,
      title: `Mô-đun ${cleanLevel}`,
      description: '',
      order_index: (count ?? 0) + 1,
    },
    { onConflict: 'code', ignoreDuplicates: true }
  );
  assertNoError(error, 'Lỗi tự tạo Mô-đun cha trên Supabase');
}

async function ensureCategoryParentRaw(
  client: SupabaseClient,
  moduleCode: string,
  level: string,
  categoryCode: string
): Promise<void> {
  await ensureModuleParentRaw(client, moduleCode, level);
  const cleanCat = categoryCode.trim().toUpperCase();
  const { data: existing, error: fetchErr } = await client
    .from('knowledge_categories')
    .select('id')
    .eq('module', moduleCode)
    .eq('code', cleanCat)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi kiểm tra Nhóm kiến thức trên Supabase');
  if (existing) return;

  const { count } = await client
    .from('knowledge_categories')
    .select('id', { count: 'exact', head: true })
    .eq('module', moduleCode);
  const { error } = await client.from('knowledge_categories').upsert(
    {
      id: makeId('cat'),
      module: moduleCode,
      code: cleanCat,
      title: `Nhóm ${cleanCat}`,
      description: '',
      order_index: (count ?? 0) + 1,
    },
    { onConflict: 'module,code', ignoreDuplicates: true }
  );
  assertNoError(error, 'Lỗi tự tạo Nhóm kiến thức cha trên Supabase');
}

async function ensureQuestionParentsOnSupabase(
  client: SupabaseClient,
  moduleCode: string,
  level: string,
  categoryCode: string,
  contentCode: string,
  topic: string
): Promise<void> {
  await ensureCategoryParentRaw(client, moduleCode, level, categoryCode);
  const cleanCat = categoryCode.trim().toUpperCase();
  const cleanPart = contentCode.trim().toUpperCase();
  const { data: existing, error: fetchErr } = await client
    .from('knowledge_parts')
    .select('id')
    .eq('module', moduleCode)
    .eq('category', cleanCat)
    .eq('code', cleanPart)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi kiểm tra Phần kiến thức trên Supabase');
  if (existing) return;

  const { count } = await client
    .from('knowledge_parts')
    .select('id', { count: 'exact', head: true })
    .eq('module', moduleCode)
    .eq('category', cleanCat);

  const { error } = await client.from('knowledge_parts').upsert(
    {
      id: makeId('part'),
      module: moduleCode,
      level: level.trim().toUpperCase() || moduleCode.toUpperCase(),
      category: cleanCat,
      code: cleanPart,
      title: topic.trim() || `Chuyên đề ${cleanPart}`,
      description: '',
      order_index: (count ?? 0) + 1,
    },
    { onConflict: 'module,category,code', ignoreDuplicates: true }
  );
  assertNoError(error, 'Lỗi tự tạo Phần kiến thức cha trên Supabase');
}

export async function createModuleOnSupabase(
  client: SupabaseClient,
  input: Partial<IC3ModuleRecord>
): Promise<IC3ModuleRecord> {
  const level = String(input.level ?? '').trim().toUpperCase();
  const title = String(input.title ?? '').trim();
  const rawCode = String(input.code ?? level)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!level || !title || !rawCode) {
    throw new SupabaseStoreError(400, 'Thiếu Level, mã hoặc tên Mô-đun.');
  }

  const { data: existingRows, error: fetchErr } = await client
    .from('ic3_modules')
    .select('id, code, level');
  assertNoError(fetchErr, 'Lỗi kiểm tra Mô-đun trên Supabase');

  if (
    (existingRows ?? []).some(
      (m) =>
        String(m.code ?? '').toLowerCase() === rawCode ||
        String(m.level ?? '').toUpperCase() === level
    )
  ) {
    throw new SupabaseStoreError(
      409,
      `Mô-đun ${level} (${rawCode}) đã tồn tại trong CSDL.`
    );
  }

  const created: IC3ModuleRecord = {
    id: makeId('mod'),
    code: rawCode,
    level,
    title,
    description: String(input.description ?? '').trim(),
    orderIndex: (existingRows ?? []).length + 1,
  };

  const { error: insErr } = await client.from('ic3_modules').insert({
    id: created.id,
    code: created.code,
    level: created.level,
    title: created.title,
    description: created.description,
    order_index: created.orderIndex,
  });
  assertNoError(insErr, 'Lỗi thêm Mô-đun lên Supabase');
  return created;
}

export async function updateModuleOnSupabase(
  client: SupabaseClient,
  id: string,
  input: Partial<IC3ModuleRecord>
): Promise<IC3ModuleRecord> {
  const { data: allRows, error: fetchErr } = await client
    .from('ic3_modules')
    .select('*');
  assertNoError(fetchErr, 'Lỗi đọc danh sách Mô-đun trên Supabase');

  const existingRow = (allRows ?? []).find((r) => String(r.id) === id);
  if (!existingRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy Mô-đun.');
  }

  const mod: IC3ModuleRecord = {
    id: String(existingRow.id),
    code: String(existingRow.code),
    level: String(existingRow.level),
    title: String(existingRow.title),
    description: String(existingRow.description ?? ''),
    orderIndex: Number(existingRow.order_index ?? 1),
  };

  const nextLevel =
    input.level !== undefined ? String(input.level).trim().toUpperCase() : mod.level;
  const nextTitle =
    input.title !== undefined ? String(input.title).trim() : mod.title;
  if (!nextLevel || !nextTitle) {
    throw new SupabaseStoreError(400, 'Level và tên Mô-đun không được để trống.');
  }
  if (
    nextLevel !== mod.level &&
    (allRows ?? []).some(
      (m) =>
        String(m.id) !== mod.id &&
        String(m.level ?? '').toUpperCase() === nextLevel
    )
  ) {
    throw new SupabaseStoreError(409, `Level ${nextLevel} đã tồn tại ở mô-đun khác.`);
  }

  const levelChanged = nextLevel !== mod.level;
  const updated: IC3ModuleRecord = {
    ...mod,
    level: nextLevel,
    title: nextTitle,
    description:
      input.description !== undefined
        ? String(input.description).trim()
        : mod.description,
  };

  const { error: updErr } = await client
    .from('ic3_modules')
    .update({
      level: updated.level,
      title: updated.title,
      description: updated.description,
    })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi cập nhật Mô-đun trên Supabase');

  if (levelChanged) {
    const [{ error: partsErr }, { error: qErr }] = await Promise.all([
      client
        .from('knowledge_parts')
        .update({ level: updated.level })
        .eq('module', updated.code),
      client
        .from('questions')
        .update({ level: updated.level })
        .eq('module', updated.code),
    ]);
    assertNoError(partsErr, 'Lỗi cập nhật level cho Phần kiến thức');
    assertNoError(qErr, 'Lỗi cập nhật level cho Câu hỏi');
  }

  return updated;
}

export async function deleteModuleOnSupabase(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { data: modRow, error: fetchErr } = await client
    .from('ic3_modules')
    .select('id, code')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm Mô-đun trên Supabase');
  if (!modRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy Mô-đun.');
  }
  const modCode = String(modRow.code);
  const [catsRes, partsRes, qsRes] = await Promise.all([
    client
      .from('knowledge_categories')
      .select('id', { count: 'exact', head: true })
      .eq('module', modCode),
    client
      .from('knowledge_parts')
      .select('id', { count: 'exact', head: true })
      .eq('module', modCode),
    client
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('module', modCode),
  ]);
  assertNoError(catsRes.error, 'Lỗi kiểm tra nhóm thuộc Mô-đun');
  assertNoError(partsRes.error, 'Lỗi kiểm tra phần thuộc Mô-đun');
  assertNoError(qsRes.error, 'Lỗi kiểm tra câu hỏi thuộc Mô-đun');

  if ((catsRes.count ?? 0) > 0 || (partsRes.count ?? 0) > 0 || (qsRes.count ?? 0) > 0) {
    throw new SupabaseStoreError(
      400,
      'Mô-đun vẫn còn nhóm kiến thức, phần kiến thức hoặc câu hỏi. Vui lòng xóa dữ liệu bên trong trước.'
    );
  }

  const { error: delErr } = await client.from('ic3_modules').delete().eq('id', id);
  assertNoError(delErr, 'Lỗi xóa Mô-đun trên Supabase');
}

export async function createCategoryOnSupabase(
  client: SupabaseClient,
  input: Partial<KnowledgeCategoryRecord>
): Promise<KnowledgeCategoryRecord> {
  const modCode = String(input.module ?? '').trim();
  const cleanCode = String(input.code ?? '').trim().toUpperCase();
  const title = String(input.title ?? '').trim();
  if (!modCode || !cleanCode || !title) {
    throw new SupabaseStoreError(
      400,
      'Thiếu thông tin Mô-đun, mã hoặc tên nhóm kiến thức.'
    );
  }

  await ensureModuleParentRaw(client, modCode, modCode);

  const { data: siblings, error: fetchErr } = await client
    .from('knowledge_categories')
    .select('id, code')
    .eq('module', modCode);
  assertNoError(fetchErr, 'Lỗi kiểm tra nhóm kiến thức trên Supabase');

  if ((siblings ?? []).some((c) => String(c.code ?? '').toUpperCase() === cleanCode)) {
    throw new SupabaseStoreError(
      409,
      `Nhóm ${cleanCode} đã tồn tại trong mô-đun này.`
    );
  }

  const created: KnowledgeCategoryRecord = {
    id: makeId('cat'),
    module: modCode,
    code: cleanCode,
    title,
    description: String(input.description ?? '').trim(),
    orderIndex: (siblings ?? []).length + 1,
  };

  const { error: insErr } = await client.from('knowledge_categories').insert({
    id: created.id,
    module: created.module,
    code: created.code,
    title: created.title,
    description: created.description,
    order_index: created.orderIndex,
  });
  assertNoError(insErr, 'Lỗi thêm nhóm kiến thức lên Supabase');
  return created;
}

export async function updateCategoryOnSupabase(
  client: SupabaseClient,
  id: string,
  input: Partial<KnowledgeCategoryRecord>
): Promise<KnowledgeCategoryRecord> {
  const { data: existing, error: fetchErr } = await client
    .from('knowledge_categories')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm nhóm kiến thức trên Supabase');
  if (!existing) {
    throw new SupabaseStoreError(404, 'Không tìm thấy nhóm kiến thức.');
  }

  const nextTitle =
    input.title !== undefined
      ? String(input.title).trim()
      : String(existing.title ?? '');
  if (!nextTitle) {
    throw new SupabaseStoreError(400, 'Tên nhóm kiến thức không được để trống.');
  }
  const nextDesc =
    input.description !== undefined
      ? String(input.description).trim()
      : String(existing.description ?? '');

  const { error: updErr } = await client
    .from('knowledge_categories')
    .update({ title: nextTitle, description: nextDesc })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi cập nhật nhóm kiến thức trên Supabase');

  return {
    id: String(existing.id),
    module: String(existing.module),
    code: String(existing.code),
    title: nextTitle,
    description: nextDesc,
    orderIndex: Number(existing.order_index ?? 1),
  };
}

export async function deleteCategoryOnSupabase(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { data: catRow, error: fetchErr } = await client
    .from('knowledge_categories')
    .select('id, module, code')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm nhóm kiến thức trên Supabase');
  if (!catRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy nhóm kiến thức.');
  }

  const modCode = String(catRow.module);
  const catCode = String(catRow.code).toUpperCase();
  const [partsRes, qsRes] = await Promise.all([
    client
      .from('knowledge_parts')
      .select('id', { count: 'exact', head: true })
      .eq('module', modCode)
      .eq('category', catCode),
    client
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('module', modCode)
      .eq('category', catCode),
  ]);
  assertNoError(partsRes.error, 'Lỗi kiểm tra phần thuộc nhóm');
  assertNoError(qsRes.error, 'Lỗi kiểm tra câu hỏi thuộc nhóm');

  if ((partsRes.count ?? 0) > 0 || (qsRes.count ?? 0) > 0) {
    throw new SupabaseStoreError(
      400,
      'Nhóm này vẫn còn phần kiến thức hoặc câu hỏi. Vui lòng xóa bên trong trước.'
    );
  }

  const { error: delErr } = await client
    .from('knowledge_categories')
    .delete()
    .eq('id', id);
  assertNoError(delErr, 'Lỗi xóa nhóm kiến thức trên Supabase');
}

export async function createPartOnSupabase(
  client: SupabaseClient,
  input: Partial<KnowledgePart>
): Promise<KnowledgePart> {
  if (!input.module || !input.level || !input.category || !input.code || !input.title) {
    throw new SupabaseStoreError(400, 'Thiếu thông tin phần kiến thức.');
  }
  const cleanCat = input.category.trim().toUpperCase();
  const cleanCode = input.code.trim().toUpperCase();

  await ensureCategoryParentRaw(client, input.module, input.level, cleanCat);

  const { data: siblings, error: fetchErr } = await client
    .from('knowledge_parts')
    .select('id, code')
    .eq('module', input.module)
    .eq('category', cleanCat);
  assertNoError(fetchErr, 'Lỗi kiểm tra phần kiến thức trên Supabase');

  if ((siblings ?? []).some((p) => String(p.code ?? '').toUpperCase() === cleanCode)) {
    throw new SupabaseStoreError(409, `Phần ${cleanCode} đã tồn tại trong nhóm này.`);
  }

  const created: KnowledgePart = {
    id: makeId('part'),
    module: input.module,
    level: input.level,
    category: cleanCat,
    code: cleanCode,
    title: input.title.trim(),
    description: (input.description || '').trim(),
    orderIndex: (siblings ?? []).length + 1,
  };

  const { error: insErr } = await client.from('knowledge_parts').insert({
    id: created.id,
    module: created.module,
    level: created.level,
    category: created.category,
    code: created.code,
    title: created.title,
    description: created.description,
    order_index: created.orderIndex,
  });
  assertNoError(insErr, 'Lỗi thêm phần kiến thức lên Supabase');
  return created;
}

export async function updatePartOnSupabase(
  client: SupabaseClient,
  id: string,
  input: Partial<KnowledgePart>
): Promise<KnowledgePart> {
  const { data: existing, error: fetchErr } = await client
    .from('knowledge_parts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm phần kiến thức trên Supabase');
  if (!existing) {
    throw new SupabaseStoreError(404, 'Không tìm thấy phần kiến thức.');
  }

  const nextTitle =
    input.title !== undefined
      ? String(input.title).trim()
      : String(existing.title ?? '');
  if (!nextTitle) {
    throw new SupabaseStoreError(400, 'Tên phần kiến thức không được để trống.');
  }
  const nextDesc =
    input.description !== undefined
      ? String(input.description).trim()
      : String(existing.description ?? '');

  const { error: updErr } = await client
    .from('knowledge_parts')
    .update({ title: nextTitle, description: nextDesc })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi cập nhật phần kiến thức trên Supabase');

  return {
    id: String(existing.id),
    module: String(existing.module),
    level: String(existing.level),
    category: String(existing.category),
    code: String(existing.code),
    title: nextTitle,
    description: nextDesc,
    orderIndex: Number(existing.order_index ?? 1),
  };
}

export async function deletePartOnSupabase(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { data: partRow, error: fetchErr } = await client
    .from('knowledge_parts')
    .select('id, module, category, code')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm phần kiến thức trên Supabase');
  if (!partRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy phần kiến thức.');
  }

  const { count, error: qErr } = await client
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('module', String(partRow.module))
    .eq('category', String(partRow.category))
    .eq('content_code', String(partRow.code).toUpperCase());
  assertNoError(qErr, 'Lỗi kiểm tra câu hỏi thuộc phần kiến thức');

  if ((count ?? 0) > 0) {
    throw new SupabaseStoreError(
      400,
      'Phần này vẫn còn câu hỏi. Vui lòng xóa hoặc chuyển câu hỏi trước khi xóa phần.'
    );
  }

  const { error: delErr } = await client
    .from('knowledge_parts')
    .delete()
    .eq('id', id);
  assertNoError(delErr, 'Lỗi xóa phần kiến thức trên Supabase');
}

export async function createQuestionOnSupabase(
  client: SupabaseClient,
  input: Partial<Question>
): Promise<Question> {
  if (
    !input.prompt ||
    !input.type ||
    !input.module ||
    !input.level ||
    !input.category ||
    !input.payload
  ) {
    throw new SupabaseStoreError(400, 'Thiếu dữ liệu câu hỏi bắt buộc.');
  }

  const cleanCategory = input.category.trim().toUpperCase();
  const contentCode = (input.contentCode || `${cleanCategory}1`)
    .trim()
    .toUpperCase();

  const [{ data: partRow }, { data: siblingQuestionRows, error: qErr }] =
    await Promise.all([
      client
        .from('knowledge_parts')
        .select('title')
        .eq('module', input.module)
        .eq('category', cleanCategory)
        .eq('code', contentCode)
        .maybeSingle(),
      client
        .from('questions')
        .select('id, module, category, content_code, topic_order, created_at')
        .eq('module', input.module)
        .eq('category', cleanCategory)
        .eq('content_code', contentCode),
    ]);
  assertNoError(qErr, 'Lỗi đọc thứ tự câu hỏi trên Supabase');

  const topicText = (
    input.topic ||
    (partRow?.title ? String(partRow.title) : '') ||
    'Tổng hợp'
  ).trim();

  await ensureQuestionParentsOnSupabase(
    client,
    input.module,
    input.level,
    cleanCategory,
    contentCode,
    topicText
  );

  const existingSiblings: Question[] = (siblingQuestionRows ?? []).map((r) => ({
    id: String(r.id),
    module: String(r.module),
    level: input.level!,
    category: String(r.category),
    contentCode: String(r.content_code),
    topicOrder: Number(r.topic_order ?? 1),
    topic: '',
    type: 'single',
    prompt: '',
    payload: { options: [], correctOptionId: '' },
    explanation: '',
    createdAt: String(r.created_at ?? ''),
    updatedAt: '',
  }));

  const topicOrder =
    typeof input.topicOrder === 'number' && input.topicOrder >= 1
      ? Math.round(input.topicOrder)
      : getNextTopicOrder(
          existingSiblings,
          input.module,
          cleanCategory,
          contentCode
        );

  const now = new Date().toISOString();
  const created: Question = {
    id: input.id || makeId('q'),
    module: input.module,
    level: input.level,
    category: cleanCategory,
    contentCode,
    topicOrder,
    topic: topicText,
    type: input.type,
    prompt: input.prompt.trim(),
    instruction:
      input.instruction?.trim() || getDefaultInstructionForQuestionType(input.type),
    payload: input.payload,
    explanation: (input.explanation || '').trim(),
    tips: input.tips?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  const { error: insErr } = await client.from('questions').insert({
    id: created.id,
    module: created.module,
    level: created.level,
    category: created.category,
    content_code: created.contentCode,
    topic_order: created.topicOrder,
    topic: created.topic,
    type: created.type,
    prompt: created.prompt,
    instruction: created.instruction ?? null,
    payload: created.payload,
    explanation: created.explanation,
    tips: created.tips ?? null,
    created_at: created.createdAt,
    updated_at: created.updatedAt,
  });
  assertNoError(insErr, 'Lỗi thêm câu hỏi lên Supabase');
  return created;
}

export async function updateQuestionOnSupabase(
  client: SupabaseClient,
  id: string,
  body: Record<string, unknown>
): Promise<Question> {
  const { data: allRows, error: fetchErr } = await client
    .from('questions')
    .select('*');
  assertNoError(fetchErr, 'Lỗi đọc danh sách câu hỏi trên Supabase');

  const qbMapped = mapQuestionBankRowsToDomain({
    moduleRows: [],
    categoryRows: [],
    partRows: [],
    questionRows: (allRows ?? []) as Array<Record<string, unknown>>,
    setRows: [],
  });
  const existing = qbMapped.questions.find((q) => q.id === id);
  if (!existing) {
    throw new SupabaseStoreError(404, 'Không tìm thấy câu hỏi.');
  }

  const nextCategory = String(body.category || existing.category)
    .trim()
    .toUpperCase();
  const nextContentCode = String(body.contentCode || existing.contentCode)
    .trim()
    .toUpperCase();
  const nextModule = String(body.module || existing.module);
  const nextLevel = String(body.level || existing.level);
  const nextType = (body.type || existing.type) as Question['type'];

  const { data: partRow } = await client
    .from('knowledge_parts')
    .select('title')
    .eq('module', nextModule)
    .eq('category', nextCategory)
    .eq('code', nextContentCode)
    .maybeSingle();

  const nextTopic =
    String(
      body.topic ||
        (partRow?.title ? String(partRow.title) : '') ||
        existing.topic
    ).trim() || 'Tổng hợp';

  await ensureQuestionParentsOnSupabase(
    client,
    nextModule,
    nextLevel,
    nextCategory,
    nextContentCode,
    nextTopic
  );

  const { difficulty: _dropExistingDiff, ...cleanExisting } =
    existing as Question & { difficulty?: unknown };
  const { difficulty: _dropBodyDiff, ...cleanBody } = body;

  const updated: Question = {
    ...cleanExisting,
    ...cleanBody,
    id: existing.id,
    module: nextModule,
    level: nextLevel,
    category: nextCategory,
    contentCode: nextContentCode,
    topic: nextTopic,
    type: nextType,
    instruction:
      typeof body.instruction === 'string' && body.instruction.trim()
        ? body.instruction.trim()
        : getDefaultInstructionForQuestionType(nextType),
    topicOrder:
      typeof body.topicOrder === 'number' && body.topicOrder >= 1
        ? Math.round(body.topicOrder)
        : existing.topicOrder,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const { error: updErr } = await client
    .from('questions')
    .update({
      module: updated.module,
      level: updated.level,
      category: updated.category,
      content_code: updated.contentCode,
      topic_order: updated.topicOrder,
      topic: updated.topic,
      type: updated.type,
      prompt: updated.prompt,
      instruction: updated.instruction ?? null,
      payload: updated.payload,
      explanation: updated.explanation,
      tips: updated.tips ?? null,
      updated_at: updated.updatedAt,
    })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi cập nhật câu hỏi trên Supabase');

  // Best-effort cleanup of replaced hotspot image in Storage
  const oldImageUrl =
    'imageUrl' in existing.payload ? existing.payload.imageUrl : undefined;
  const newImageUrl =
    'imageUrl' in updated.payload ? updated.payload.imageUrl : undefined;
  const otherQuestions = qbMapped.questions.filter((q) => q.id !== updated.id);
  const obsoletePath = getObsoleteHotspotStoragePath(
    oldImageUrl,
    newImageUrl,
    otherQuestions,
    HOTSPOT_STORAGE_BUCKET
  );
  if (obsoletePath) {
    await client.storage
      .from(HOTSPOT_STORAGE_BUCKET)
      .remove([obsoletePath])
      .catch(() => {});
  }

  return updated;
}

export async function reorderQuestionsOnSupabaseServer(
  client: SupabaseClient,
  updates: Array<{ id: string; topicOrder: number }>
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all(
    updates.map(async (u) => {
      const { error } = await client
        .from('questions')
        .update({ topic_order: u.topicOrder, updated_at: now })
        .eq('id', u.id);
      assertNoError(error, 'Lỗi sắp xếp thứ tự câu hỏi trên Supabase');
    })
  );
}

async function cleanupQuestionReferencesAndStorage(
  client: SupabaseClient,
  deletedIdSet: Set<string>,
  remainingQuestions: Question[],
  deletedQuestions: Question[]
): Promise<void> {
  const now = new Date().toISOString();
  const [setsRes, tasksRes] = await Promise.all([
    client.from('question_sets').select('id, question_ids'),
    client.from('class_tasks').select('id, question_ids'),
  ]);
  assertNoError(setsRes.error, 'Lỗi đọc question_sets khi xóa câu hỏi');
  assertNoError(tasksRes.error, 'Lỗi đọc class_tasks khi xóa câu hỏi');

  const setUpdates = (setsRes.data ?? [])
    .filter((s) =>
      Array.isArray(s.question_ids) &&
      s.question_ids.some((id: unknown) => deletedIdSet.has(String(id)))
    )
    .map((s) =>
      client
        .from('question_sets')
        .update({
          question_ids: (s.question_ids as unknown[])
            .map((id) => String(id))
            .filter((id) => !deletedIdSet.has(id)),
          updated_at: now,
        })
        .eq('id', String(s.id))
    );

  const taskUpdates = (tasksRes.data ?? [])
    .filter((t) =>
      Array.isArray(t.question_ids) &&
      t.question_ids.some((id: unknown) => deletedIdSet.has(String(id)))
    )
    .map((t) =>
      client
        .from('class_tasks')
        .update({
          question_ids: (t.question_ids as unknown[])
            .map((id) => String(id))
            .filter((id) => !deletedIdSet.has(id)),
        })
        .eq('id', String(t.id))
    );

  const results = await Promise.all([...setUpdates, ...taskUpdates]);
  for (const r of results) {
    assertNoError(r.error, 'Lỗi cập nhật bộ đề/bài tập liên quan');
  }

  const paths = collectHotspotStoragePathsToDelete(
    deletedQuestions,
    remainingQuestions,
    HOTSPOT_STORAGE_BUCKET
  );
  if (paths.length > 0) {
    await client.storage
      .from(HOTSPOT_STORAGE_BUCKET)
      .remove(paths)
      .catch(() => {});
  }
}

export async function deleteQuestionOnSupabaseServer(
  client: SupabaseClient,
  qId: string
): Promise<void> {
  const { data: allRows, error: fetchErr } = await client
    .from('questions')
    .select('*');
  assertNoError(fetchErr, 'Lỗi đọc câu hỏi trên Supabase');

  const allQuestions = mapQuestionBankRowsToDomain({
    moduleRows: [],
    categoryRows: [],
    partRows: [],
    questionRows: (allRows ?? []) as Array<Record<string, unknown>>,
    setRows: [],
  }).questions;

  const target = allQuestions.filter((q) => q.id === qId);
  const remaining = allQuestions.filter((q) => q.id !== qId);

  const { error: delErr } = await client.from('questions').delete().eq('id', qId);
  assertNoError(delErr, 'Lỗi xóa câu hỏi trên Supabase');

  await cleanupQuestionReferencesAndStorage(
    client,
    new Set([qId]),
    remaining,
    target
  );
}

export async function batchDeleteQuestionsOnSupabaseServer(
  client: SupabaseClient,
  ids: string[]
): Promise<number> {
  const idSet = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (idSet.size === 0) return 0;

  const { data: allRows, error: fetchErr } = await client
    .from('questions')
    .select('*');
  assertNoError(fetchErr, 'Lỗi đọc danh sách câu hỏi trên Supabase');

  const allQuestions = mapQuestionBankRowsToDomain({
    moduleRows: [],
    categoryRows: [],
    partRows: [],
    questionRows: (allRows ?? []) as Array<Record<string, unknown>>,
    setRows: [],
  }).questions;

  const deletedQuestions = allQuestions.filter((q) => idSet.has(q.id));
  const remaining = allQuestions.filter((q) => !idSet.has(q.id));

  const { error: delErr } = await client
    .from('questions')
    .delete()
    .in('id', Array.from(idSet));
  assertNoError(delErr, 'Lỗi xóa hàng loạt câu hỏi trên Supabase');

  await cleanupQuestionReferencesAndStorage(
    client,
    idSet,
    remaining,
    deletedQuestions
  );
  return deletedQuestions.length;
}

export async function createQuestionSetOnSupabase(
  client: SupabaseClient,
  input: Partial<QuestionSet>
): Promise<QuestionSet> {
  if (!input.title || !input.title.trim()) {
    throw new SupabaseStoreError(400, 'Thiếu tiêu đề bộ đề.');
  }
  const now = new Date().toISOString();
  const created: QuestionSet = {
    id: input.id || makeId('set'),
    title: input.title.trim(),
    description: (input.description || '').trim(),
    level: input.level,
    category: input.category,
    contentCode: input.contentCode?.trim(),
    questionIds: Array.isArray(input.questionIds) ? input.questionIds : [],
    createdAt: now,
    updatedAt: now,
  };

  const { error } = await client.from('question_sets').insert({
    id: created.id,
    title: created.title,
    description: created.description,
    level: created.level ?? null,
    category: created.category ?? null,
    content_code: created.contentCode ?? null,
    question_ids: created.questionIds,
    created_at: created.createdAt,
    updated_at: created.updatedAt,
  });
  assertNoError(error, 'Lỗi tạo bộ đề trên Supabase');
  return created;
}

export async function updateQuestionSetOnSupabase(
  client: SupabaseClient,
  id: string,
  body: Partial<QuestionSet>
): Promise<QuestionSet> {
  const { data: existingRow, error: fetchErr } = await client
    .from('question_sets')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  assertNoError(fetchErr, 'Lỗi tìm bộ đề trên Supabase');
  if (!existingRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy bộ đề.');
  }

  const existing = mapQuestionBankRowsToDomain({
    moduleRows: [],
    categoryRows: [],
    partRows: [],
    questionRows: [],
    setRows: [existingRow as Record<string, unknown>],
  }).questionSets[0];

  const updated: QuestionSet = {
    ...existing,
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const { error: updErr } = await client
    .from('question_sets')
    .update({
      title: updated.title,
      description: updated.description,
      level: updated.level ?? null,
      category: updated.category ?? null,
      content_code: updated.contentCode ?? null,
      question_ids: updated.questionIds,
      updated_at: updated.updatedAt,
    })
    .eq('id', id);
  assertNoError(updErr, 'Lỗi cập nhật bộ đề trên Supabase');
  return updated;
}

export async function deleteQuestionSetOnSupabaseServer(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from('question_sets').delete().eq('id', id);
  assertNoError(error, 'Lỗi xóa bộ đề trên Supabase');
}

export async function importQuestionBankToSupabase(
  client: SupabaseClient,
  input: {
    modules?: IC3ModuleRecord[];
    knowledgeCategories?: KnowledgeCategoryRecord[];
    knowledgeParts?: KnowledgePart[];
    questions: Question[];
    questionSets?: QuestionSet[];
  }
) {
  const payload = buildQuestionBankSupabasePayload({
    modules: input.modules,
    knowledgeCategories: input.knowledgeCategories,
    knowledgeParts: input.knowledgeParts,
    questions: input.questions,
    questionSets: input.questionSets ?? [],
  });

  if (payload.modules.length > 0) {
    const { error } = await client
      .from('ic3_modules')
      .upsert(payload.modules, { onConflict: 'code' });
    assertNoError(error, 'Lỗi nhập ic3_modules lên Supabase');
  }
  if (payload.categories.length > 0) {
    const { error } = await client
      .from('knowledge_categories')
      .upsert(payload.categories, { onConflict: 'module,code' });
    assertNoError(error, 'Lỗi nhập knowledge_categories lên Supabase');
  }
  if (payload.parts.length > 0) {
    const { error } = await client
      .from('knowledge_parts')
      .upsert(payload.parts, { onConflict: 'module,category,code' });
    assertNoError(error, 'Lỗi nhập knowledge_parts lên Supabase');
  }
  if (payload.questions.length > 0) {
    const { error } = await client
      .from('questions')
      .upsert(payload.questions, { onConflict: 'id' });
    assertNoError(error, 'Lỗi nhập questions lên Supabase');
  }
  if (payload.questionSets.length > 0) {
    const { error } = await client
      .from('question_sets')
      .upsert(payload.questionSets, { onConflict: 'id' });
    assertNoError(error, 'Lỗi nhập question_sets lên Supabase');
  }

  return {
    modules: payload.modules.length,
    knowledgeCategories: payload.categories.length,
    knowledgeParts: payload.parts.length,
    questions: payload.questions.length,
    questionSets: payload.questionSets.length,
  };
}

// =========================================================================
// Class Tasks, Submissions & Break States
// =========================================================================

export async function saveClassTaskConfigOnSupabase(
  client: SupabaseClient,
  classId: string,
  body: Partial<ClassTaskConfig>
): Promise<ClassTaskConfig> {
  const { data: clsRow, error: clsErr } = await client
    .from('classes')
    .select('id, name')
    .eq('id', classId)
    .maybeSingle();
  assertNoError(clsErr, 'Lỗi kiểm tra lớp học trên Supabase');
  if (!clsRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy lớp học.');
  }

  const normalizedTasks = (body.tasks ?? []).map((t, index) => ({
    ...t,
    id: t.id || makeId('task'),
    classId,
    orderIndex: index + 1,
    requiredAttempts: Math.max(1, Number(t.requiredAttempts ?? 1)),
    minScore: Math.min(1000, Math.max(0, Number(t.minScore ?? 0))),
    estimatedMinutes: Math.max(1, Number(t.estimatedMinutes ?? 10)),
    questionIds: Array.isArray(t.questionIds) ? t.questionIds : [],
  }));

  const config: ClassTaskConfig = {
    classId,
    assignmentTitle: (
      body.assignmentTitle || `Bài tập lớp ${String(clsRow.name)}`
    ).trim(),
    teacherName: (body.teacherName || 'Giáo viên bộ môn').trim(),
    breakRewardMinutes: Math.max(0, Number(body.breakRewardMinutes ?? 10)),
    updatedAt: new Date().toISOString(),
    tasks: normalizedTasks,
  };

  const { error: cfgErr } = await client
    .from('class_task_configs')
    .upsert(mapClassTaskConfigToRow(config), { onConflict: 'class_id' });
  assertNoError(cfgErr, 'Lỗi lưu cấu hình bài tập lớp lên Supabase');

  const { data: existingTasks, error: existingErr } = await client
    .from('class_tasks')
    .select('id')
    .eq('class_id', classId);
  assertNoError(existingErr, 'Lỗi kiểm tra bài tập hiện có trên Supabase');

  const keepIds = new Set(config.tasks.map((t) => t.id));
  const toDeleteIds = (existingTasks ?? [])
    .map((r) => String(r.id))
    .filter((id) => !keepIds.has(id));

  if (toDeleteIds.length > 0) {
    const { error: delErr } = await client
      .from('class_tasks')
      .delete()
      .in('id', toDeleteIds);
    assertNoError(delErr, 'Lỗi xóa bài tập cũ trên Supabase');
  }

  if (config.tasks.length > 0) {
    const { error: tasksErr } = await client
      .from('class_tasks')
      .upsert(config.tasks.map(mapClassTaskItemToRow), { onConflict: 'id' });
    assertNoError(tasksErr, 'Lỗi lưu danh sách bài tập lớp lên Supabase');
  }

  return config;
}

export async function createSubmissionOnSupabase(
  client: SupabaseClient,
  input: {
    studentId?: unknown;
    taskId?: unknown;
    correctCount?: unknown;
    totalCount?: unknown;
    durationSeconds?: unknown;
  }
): Promise<AdminTaskStatRecord> {
  const studentId = String(input.studentId ?? '');
  const taskId = String(input.taskId ?? '');

  const { data: studentRow, error: stErr } = await client
    .from('students')
    .select('*')
    .eq('id', studentId)
    .maybeSingle();
  assertNoError(stErr, 'Lỗi tìm học sinh trên Supabase');
  if (!studentRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy học sinh.');
  }
  const student = mapStudentRowToDomain(studentRow as Record<string, unknown>);

  const { data: clsRow, error: clsErr } = await client
    .from('classes')
    .select('*')
    .eq('id', student.classId)
    .maybeSingle();
  assertNoError(clsErr, 'Lỗi tìm lớp học trên Supabase');
  if (!clsRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy lớp.');
  }
  const cls = mapClassRowToDomain(clsRow as Record<string, unknown>);

  const [cfgRes, tasksRes, prevSubsRes] = await Promise.all([
    client
      .from('class_task_configs')
      .select('*')
      .eq('class_id', cls.id)
      .maybeSingle(),
    client
      .from('class_tasks')
      .select('*')
      .eq('class_id', cls.id)
      .order('order_index', { ascending: true }),
    client
      .from('student_task_submissions')
      .select('*')
      .eq('student_id', student.id),
  ]);
  assertNoError(cfgRes.error, 'Lỗi đọc cấu hình nhiệm vụ lớp');
  assertNoError(tasksRes.error, 'Lỗi đọc nhiệm vụ lớp');
  assertNoError(prevSubsRes.error, 'Lỗi đọc lịch sử nộp bài học sinh');

  if (!cfgRes.data) {
    throw new SupabaseStoreError(404, 'Không tìm thấy nhiệm vụ lớp.');
  }
  const taskConfigs = mapClassTaskConfigsFromRows(
    [cfgRes.data as Record<string, unknown>],
    (tasksRes.data ?? []) as Array<Record<string, unknown>>
  );
  const taskCfg = taskConfigs[0];
  const task = taskCfg?.tasks.find((t) => t.id === taskId);
  if (!taskCfg || !task) {
    throw new SupabaseStoreError(404, 'Không tìm thấy nhiệm vụ lớp.');
  }

  const prevSubs = mapSubmissionsFromRows(
    (prevSubsRes.data ?? []) as Array<Record<string, unknown>>,
    [student],
    taskConfigs
  );
  const prevAttempts = prevSubs.filter((s) => s.taskId === task.id).length;

  const total = Math.max(
    1,
    Number(input.totalCount ?? task.questionIds.length ?? 5)
  );
  const correct = Math.min(total, Math.max(0, Number(input.correctCount ?? 0)));
  const score = calculateIC3Score(correct, total);

  const record: AdminTaskStatRecord = {
    id: makeUuid(),
    studentId: student.id,
    studentName: student.fullName,
    studentCode: student.studentCode,
    schoolId: cls.schoolId,
    classId: cls.id,
    taskId: task.id,
    taskTitle: task.title,
    score,
    correctCount: correct,
    totalCount: total,
    durationSeconds: Math.max(1, Number(input.durationSeconds ?? 90)),
    completedAt: new Date().toISOString(),
    attemptNumber: prevAttempts + 1,
    requiredAttempts: task.requiredAttempts,
    minScore: task.minScore,
    metMinScore: score >= task.minScore,
  };

  const { error: insErr } = await client
    .from('student_task_submissions')
    .insert(mapSubmissionToRow(record));
  assertNoError(insErr, 'Lỗi lưu bài nộp lên Supabase');

  const allSubs = [record, ...prevSubs];
  if (isStudentBreakUnlocked(taskCfg.tasks, allSubs, student.id)) {
    const grantedSeconds = taskCfg.breakRewardMinutes * 60;
    const now = new Date().toISOString();
    const breakRow: StudentBreakState = {
      studentId: student.id,
      status: 'active',
      totalGrantedSeconds: grantedSeconds,
      remainingSeconds: grantedSeconds,
      unlockedAt: now,
      updatedAt: now,
    };
    const { error: breakErr } = await client
      .from('student_break_states')
      .upsert(mapBreakStateToRow(breakRow), { onConflict: 'student_id' });
    assertNoError(breakErr, 'Lỗi mở khóa giờ giải lao trên Supabase');
  }

  return record;
}

// =========================================================================
// Battle Configs & Rooms
// =========================================================================

async function fetchBattleRoomById(
  client: SupabaseClient,
  roomId: string
): Promise<BattleRoomState> {
  const normalizedId = ensureSupabaseUuid(roomId);
  const [roomRes, partRes, eventRes] = await Promise.all([
    client.from('battle_rooms').select('*').eq('id', normalizedId).maybeSingle(),
    client.from('battle_participants').select('*').eq('room_id', normalizedId),
    client
      .from('battle_events')
      .select('*')
      .eq('room_id', normalizedId)
      .order('created_at', { ascending: false }),
  ]);
  assertNoError(roomRes.error, 'Lỗi đọc phòng thi đấu trên Supabase');
  assertNoError(partRes.error, 'Lỗi đọc thí sinh phòng thi đấu');
  assertNoError(eventRes.error, 'Lỗi đọc diễn biến phòng thi đấu');

  if (!roomRes.data) {
    throw new SupabaseStoreError(404, 'Không tìm thấy phòng.');
  }

  return mapBattleRoomsFromRows(
    [roomRes.data as Record<string, unknown>],
    (partRes.data ?? []) as Array<Record<string, unknown>>,
    (eventRes.data ?? []) as Array<Record<string, unknown>>
  )[0];
}

export async function saveBattleConfigOnSupabase(
  client: SupabaseClient,
  classId: string,
  body: Partial<ClassBattleConfig>
): Promise<ClassBattleConfig> {
  const { data: clsRow, error: clsErr } = await client
    .from('classes')
    .select('id, name')
    .eq('id', classId)
    .maybeSingle();
  assertNoError(clsErr, 'Lỗi kiểm tra lớp học trên Supabase');
  if (!clsRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy lớp học.');
  }

  let selectedSet: QuestionSet | undefined;
  if (body.questionSetId) {
    const { data: setRow, error: setErr } = await client
      .from('question_sets')
      .select('*')
      .eq('id', body.questionSetId)
      .maybeSingle();
    assertNoError(setErr, 'Lỗi đọc bộ đề thi đấu');
    if (setRow) {
      selectedSet = mapQuestionBankRowsToDomain({
        moduleRows: [],
        categoryRows: [],
        partRows: [],
        questionRows: [],
        setRows: [setRow as Record<string, unknown>],
      }).questionSets[0];
    }
  }

  const config: ClassBattleConfig = {
    classId,
    isEnabled: Boolean(body.isEnabled),
    title: (
      body.title || `Đấu trường IC3 — Lớp ${String(clsRow.name)}`
    ).trim(),
    questionSetId: selectedSet?.id ?? null,
    questionSetName:
      selectedSet?.title || body.questionSetName || 'Bộ đề tổng hợp',
    teacherName: (body.teacherName || 'Giáo viên điều phối').trim(),
    moduleFilter: body.moduleFilter || 'all',
    questionIds:
      selectedSet?.questionIds ??
      (Array.isArray(body.questionIds) ? body.questionIds : []),
    fastComboWindowSeconds: Math.max(
      5,
      Number(body.fastComboWindowSeconds ?? 15)
    ),
    topRewardCount: Math.max(1, Number(body.topRewardCount ?? 3)),
    breakRewardMinutes: Math.max(0, Number(body.breakRewardMinutes ?? 10)),
    timeLimitSeconds: Math.max(30, Number(body.timeLimitSeconds ?? 300)),
    updatedAt: new Date().toISOString(),
  };

  const { error: cfgErr } = await client
    .from('class_battle_configs')
    .upsert(mapBattleConfigToRow(config), { onConflict: 'class_id' });
  assertNoError(cfgErr, 'Lỗi lưu cấu hình thi đấu lên Supabase');

  const { error: lobbyErr } = await client
    .from('battle_rooms')
    .update({
      config_snapshot: config,
      question_ids: config.questionIds,
    })
    .eq('class_id', classId)
    .eq('status', 'lobby');
  assertNoError(lobbyErr, 'Lỗi cập nhật phòng chờ thi đấu trên Supabase');

  return config;
}

export async function createBattleRoomOnSupabase(
  client: SupabaseClient,
  classId: string
): Promise<BattleRoomState> {
  const { data: cfgRow, error: cfgErr } = await client
    .from('class_battle_configs')
    .select('*')
    .eq('class_id', classId)
    .maybeSingle();
  assertNoError(cfgErr, 'Lỗi đọc cấu hình thi đấu lớp trên Supabase');
  if (!cfgRow) {
    throw new SupabaseStoreError(
      400,
      'Vui lòng lưu cấu hình Thi đấu cho lớp trước khi mở phòng.'
    );
  }
  const cfg = mapBattleConfigRowToDomain(cfgRow as Record<string, unknown>);

  const { data: studentRows, error: stErr } = await client
    .from('students')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: true })
    .limit(3);
  assertNoError(stErr, 'Lỗi đọc danh sách học sinh vào phòng chờ');

  const classStudents = (studentRows ?? []).map((r) =>
    mapStudentRowToDomain(r as Record<string, unknown>)
  );

  const now = new Date().toISOString();
  const roomId = makeUuid();
  const participants: BattleParticipant[] = classStudents.map((st) => ({
    roomId,
    studentId: st.id,
    studentName: st.fullName,
    studentCode: st.studentCode,
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
    joinedAt: now,
  }));
  const events: BattleEvent[] = classStudents.map((st) => ({
    id: makeUuid(),
    roomId,
    type: 'join',
    message: `${st.fullName} (${st.studentCode}) đã vào phòng chờ.`,
    actorStudentId: st.id,
    actorStudentName: st.fullName,
    createdAt: now,
  }));

  const room: BattleRoomState = {
    id: roomId,
    classId,
    status: 'lobby',
    questionIds: cfg.questionIds,
    configSnapshot: cfg,
    participants,
    events,
    createdAt: now,
  };

  const { error: roomInsErr } = await client
    .from('battle_rooms')
    .insert(mapBattleRoomToRow(room));
  assertNoError(roomInsErr, 'Lỗi mở phòng thi đấu mới trên Supabase');

  if (participants.length > 0) {
    const { error: partInsErr } = await client
      .from('battle_participants')
      .insert(participants.map(mapBattleParticipantToRow));
    assertNoError(partInsErr, 'Lỗi thêm thí sinh vào phòng thi đấu');
  }
  if (events.length > 0) {
    const { error: evInsErr } = await client
      .from('battle_events')
      .insert(events.map(mapBattleEventToRow));
    assertNoError(evInsErr, 'Lỗi ghi diễn biến phòng thi đấu');
  }

  return room;
}

export async function joinBattleRoomOnSupabase(
  client: SupabaseClient,
  roomId: string,
  studentId: string
): Promise<BattleRoomState> {
  const room = await fetchBattleRoomById(client, roomId);
  const { data: studentRow, error: stErr } = await client
    .from('students')
    .select('*')
    .eq('id', studentId)
    .maybeSingle();
  assertNoError(stErr, 'Lỗi tìm học sinh trên Supabase');
  if (!studentRow) {
    throw new SupabaseStoreError(404, 'Không tìm thấy học sinh.');
  }
  const student = mapStudentRowToDomain(studentRow as Record<string, unknown>);

  if (room.participants.some((p) => p.studentId === student.id)) {
    return room;
  }

  const now = new Date().toISOString();
  const participant: BattleParticipant = {
    roomId: room.id,
    studentId: student.id,
    studentName: student.fullName,
    studentCode: student.studentCode,
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
    joinedAt: now,
  };
  const ev: BattleEvent = {
    id: makeUuid(),
    roomId: room.id,
    type: 'join',
    message: `${student.fullName} (${student.studentCode}) vừa tham gia phòng chờ.`,
    actorStudentId: student.id,
    actorStudentName: student.fullName,
    createdAt: now,
  };

  const [{ error: pErr }, { error: eErr }] = await Promise.all([
    client.from('battle_participants').insert(mapBattleParticipantToRow(participant)),
    client.from('battle_events').insert(mapBattleEventToRow(ev)),
  ]);
  assertNoError(pErr, 'Lỗi thêm thí sinh vào phòng trên Supabase');
  assertNoError(eErr, 'Lỗi ghi sự kiện tham gia phòng');

  room.participants.push(participant);
  room.events.unshift(ev);
  return room;
}

export async function startBattleRoomOnSupabase(
  client: SupabaseClient,
  roomId: string
): Promise<BattleRoomState> {
  const room = await fetchBattleRoomById(client, roomId);
  if (room.participants.length === 0) {
    throw new SupabaseStoreError(
      400,
      'Cần ít nhất 1 học sinh trong phòng chờ để bắt đầu.'
    );
  }
  const now = new Date();
  const endsAt = new Date(
    now.getTime() + room.configSnapshot.timeLimitSeconds * 1000
  );
  room.status = 'playing';
  room.startedAt = now.toISOString();
  room.endsAt = endsAt.toISOString();

  const startEvent: BattleEvent = {
    id: makeUuid(),
    roomId: room.id,
    type: 'start',
    message: `Giáo viên đã phát lệnh BẮT ĐẦU trận đấu (${room.questionIds.length} câu hỏi, ${room.configSnapshot.timeLimitSeconds}s).`,
    createdAt: now.toISOString(),
  };

  const [{ error: roomErr }, { error: evErr }] = await Promise.all([
    client
      .from('battle_rooms')
      .update({
        status: room.status,
        started_at: room.startedAt,
        ends_at: room.endsAt,
      })
      .eq('id', ensureSupabaseUuid(room.id)),
    client.from('battle_events').insert(mapBattleEventToRow(startEvent)),
  ]);
  assertNoError(roomErr, 'Lỗi bắt đầu trận đấu trên Supabase');
  assertNoError(evErr, 'Lỗi ghi sự kiện bắt đầu trận đấu');

  room.events.unshift(startEvent);
  return room;
}

export async function simulateBattleStepOnSupabase(
  client: SupabaseClient,
  roomId: string
): Promise<BattleRoomState> {
  const room = await fetchBattleRoomById(client, roomId);
  if (room.status !== 'playing') {
    throw new SupabaseStoreError(
      400,
      'Phòng đấu chưa ở trạng thái đang diễn ra.'
    );
  }

  const totalQuestions = Math.max(1, room.questionIds.length);
  const now = new Date();
  const debuffs: BattleDebuffType[] = ['blur', 'frost', 'reverse', 'shake'];
  const newEvents: BattleEvent[] = [];

  for (const p of room.participants) {
    p.activeDebuffs = p.activeDebuffs.filter(
      (d) => new Date(d.expiresAt).getTime() > now.getTime()
    );
    if (p.finished) continue;

    const stepQuestions = Math.min(totalQuestions - p.answeredCount, 2);
    if (stepQuestions <= 0) {
      p.finished = true;
      p.finishedAt = now.toISOString();
      continue;
    }

    const elapsedDelta = Math.floor(Math.random() * 9) + 6;
    let gainedCorrect = 0;
    for (let i = 0; i < stepQuestions; i++) {
      if (Math.random() > 0.22) gainedCorrect++;
    }

    p.answeredCount += stepQuestions;
    p.correctCount += gainedCorrect;
    p.durationSeconds += elapsedDelta;
    p.score = calculateIC3Score(p.correctCount, totalQuestions);

    if (p.answeredCount >= totalQuestions) {
      p.finished = true;
      p.finishedAt = now.toISOString();
    }

    if (
      gainedCorrect === 2 &&
      elapsedDelta <= room.configSnapshot.fastComboWindowSeconds
    ) {
      const useDefense = p.shieldCharges === 0 && Math.random() < 0.45;
      if (useDefense || room.participants.length < 2) {
        p.shieldCharges += 2;
        p.defensesUsed += 1;
        newEvents.unshift({
          id: makeUuid(),
          roomId: room.id,
          type: 'defense',
          message: `${p.studentName} đạt Combo nhanh (${elapsedDelta}s) và kích hoạt Thẻ Phòng Thủ (+2 Khiên).`,
          actorStudentId: p.studentId,
          actorStudentName: p.studentName,
          createdAt: now.toISOString(),
        });
      } else {
        const opponents = room.participants.filter(
          (o) => o.studentId !== p.studentId && !o.finished
        );
        const target = opponents[Math.floor(Math.random() * opponents.length)];
        if (target) {
          const debuffType = debuffs[Math.floor(Math.random() * debuffs.length)];
          p.attacksUsed += 1;
          if (target.shieldCharges > 0) {
            target.shieldCharges -= 1;
            target.attacksBlocked += 1;
            newEvents.unshift({
              id: makeUuid(),
              roomId: room.id,
              type: 'blocked',
              message: `${p.studentName} tung thẻ [${debuffType}] vào ${target.studentName} nhưng bị Khiên chặn lại!`,
              actorStudentId: p.studentId,
              actorStudentName: p.studentName,
              targetStudentId: target.studentId,
              targetStudentName: target.studentName,
              debuffType,
              createdAt: now.toISOString(),
            });
          } else {
            target.activeDebuffs.push({
              id: makeId('debuff'),
              type: debuffType,
              fromStudentName: p.studentName,
              expiresAt: new Date(now.getTime() + 6000).toISOString(),
            });
            newEvents.unshift({
              id: makeUuid(),
              roomId: room.id,
              type: 'attack',
              message: `${p.studentName} tung thẻ [${debuffType}] gây nhiễu ${target.studentName} trong 6s!`,
              actorStudentId: p.studentId,
              actorStudentName: p.studentName,
              targetStudentId: target.studentId,
              targetStudentName: target.studentName,
              debuffType,
              createdAt: now.toISOString(),
            });
          }
        }
      }
    }
  }

  if (room.participants.length > 0 && room.participants.every((p) => p.finished)) {
    room.status = 'finished';
    room.finishedAt = now.toISOString();
    room.rankedResults = rankBattleParticipants(
      room.participants,
      totalQuestions,
      room.configSnapshot.topRewardCount,
      room.configSnapshot.breakRewardMinutes
    );
    newEvents.unshift({
      id: makeUuid(),
      roomId: room.id,
      type: 'finish',
      message: `Tất cả học sinh đã hoàn thành! Hạng 1: ${room.rankedResults[0]?.studentName} (${room.rankedResults[0]?.score} điểm).`,
      createdAt: now.toISOString(),
    });
  }

  if (room.participants.length > 0) {
    const { error: partUpdErr } = await client
      .from('battle_participants')
      .upsert(room.participants.map(mapBattleParticipantToRow), {
        onConflict: 'room_id,student_id',
      });
    assertNoError(partUpdErr, 'Lỗi cập nhật điểm thí sinh trên Supabase');
  }

  if (newEvents.length > 0) {
    const { error: evInsErr } = await client
      .from('battle_events')
      .insert(newEvents.map(mapBattleEventToRow));
    assertNoError(evInsErr, 'Lỗi lưu diễn biến thi đấu lên Supabase');
  }

  if (room.status === 'finished') {
    const { error: roomUpdErr } = await client
      .from('battle_rooms')
      .update({
        status: room.status,
        finished_at: room.finishedAt ?? null,
        ranked_results: room.rankedResults ?? null,
      })
      .eq('id', ensureSupabaseUuid(room.id));
    assertNoError(roomUpdErr, 'Lỗi cập nhật trạng thái kết thúc phòng đấu');
  }

  room.events = [...newEvents, ...room.events].slice(0, 40);
  return room;
}

export async function finishBattleRoomOnSupabase(
  client: SupabaseClient,
  roomId: string
): Promise<BattleRoomState> {
  const room = await fetchBattleRoomById(client, roomId);
  const now = new Date().toISOString();
  const totalQuestions = Math.max(1, room.questionIds.length);

  for (const p of room.participants) {
    p.finished = true;
    p.finishedAt = p.finishedAt || now;
    p.activeDebuffs = [];
  }
  room.status = 'finished';
  room.finishedAt = now;
  room.rankedResults = rankBattleParticipants(
    room.participants,
    totalQuestions,
    room.configSnapshot.topRewardCount,
    room.configSnapshot.breakRewardMinutes
  );

  // Grant break reward to Top X
  const rewardedIds = room.rankedResults
    .filter((r) => r.rewardedBreakMinutes > 0)
    .map((r) => r.studentId);
  if (rewardedIds.length > 0) {
    const { data: existingBreaks, error: brFetchErr } = await client
      .from('student_break_states')
      .select('*')
      .in('student_id', rewardedIds);
    assertNoError(brFetchErr, 'Lỗi đọc trạng thái giải lao thí sinh Top X');

    const breakMap = new Map(
      (existingBreaks ?? []).map((b) => {
        const mapped = mapBreakStateRowToDomain(b as Record<string, unknown>);
        return [mapped.studentId, mapped] as const;
      })
    );

    const nextBreakRows: StudentBreakState[] = [];
    for (const r of room.rankedResults) {
      if (r.rewardedBreakMinutes <= 0) continue;
      const extraSec = r.rewardedBreakMinutes * 60;
      const existing = breakMap.get(r.studentId);
      if (existing) {
        nextBreakRows.push({
          ...existing,
          status: 'active',
          totalGrantedSeconds: existing.totalGrantedSeconds + extraSec,
          remainingSeconds: existing.remainingSeconds + extraSec,
          unlockedAt: existing.unlockedAt || now,
          updatedAt: now,
        });
      } else {
        nextBreakRows.push({
          studentId: r.studentId,
          status: 'active',
          totalGrantedSeconds: extraSec,
          remainingSeconds: extraSec,
          unlockedAt: now,
          updatedAt: now,
        });
      }
    }
    if (nextBreakRows.length > 0) {
      const { error: brErr } = await client
        .from('student_break_states')
        .upsert(nextBreakRows.map(mapBreakStateToRow), {
          onConflict: 'student_id',
        });
      assertNoError(brErr, 'Lỗi trao thưởng giờ giải lao Top X');
    }
  }

  const finishEvent: BattleEvent = {
    id: makeUuid(),
    roomId: room.id,
    type: 'finish',
    message: `Giáo viên đã kết thúc trận đấu. Trao thưởng Top ${room.configSnapshot.topRewardCount} (+${room.configSnapshot.breakRewardMinutes} phút giải lao).`,
    createdAt: now,
  };

  const ops: Array<PromiseLike<{ error: { message: string } | null }>> = [
    client
      .from('battle_rooms')
      .update({
        status: room.status,
        finished_at: room.finishedAt,
        ranked_results: room.rankedResults,
      })
      .eq('id', ensureSupabaseUuid(room.id)),
    client.from('battle_events').insert(mapBattleEventToRow(finishEvent)),
  ];
  if (room.participants.length > 0) {
    ops.push(
      client
        .from('battle_participants')
        .upsert(room.participants.map(mapBattleParticipantToRow), {
          onConflict: 'room_id,student_id',
        })
    );
  }
  const results = await Promise.all(ops);
  for (const r of results) {
    assertNoError(r.error, 'Lỗi kết thúc phòng đấu trên Supabase');
  }

  room.events.unshift(finishEvent);
  return room;
}

export async function resetBattleRoomOnSupabase(
  client: SupabaseClient,
  roomId: string
): Promise<BattleRoomState> {
  const room = await fetchBattleRoomById(client, roomId);
  const now = new Date().toISOString();
  room.status = 'lobby';
  room.startedAt = undefined;
  room.endsAt = undefined;
  room.finishedAt = undefined;
  room.rankedResults = undefined;

  for (const p of room.participants) {
    p.answeredCount = 0;
    p.correctCount = 0;
    p.score = 0;
    p.durationSeconds = 0;
    p.finished = false;
    p.finishedAt = undefined;
    p.shieldCharges = 0;
    p.pendingCardChoices = 0;
    p.attacksUsed = 0;
    p.defensesUsed = 0;
    p.attacksBlocked = 0;
    p.activeDebuffs = [];
  }

  const resetEvent: BattleEvent = {
    id: makeUuid(),
    roomId: room.id,
    type: 'join',
    message: 'Phòng thi đấu đã được giáo viên đặt lại về trạng thái Phòng chờ.',
    createdAt: now,
  };
  room.events = [resetEvent];

  const normalizedRoomId = ensureSupabaseUuid(room.id);
  const { error: delEvErr } = await client
    .from('battle_events')
    .delete()
    .eq('room_id', normalizedRoomId);
  assertNoError(delEvErr, 'Lỗi xóa nhật ký cũ của phòng thi đấu');

  const ops: Array<PromiseLike<{ error: { message: string } | null }>> = [
    client
      .from('battle_rooms')
      .update({
        status: 'lobby',
        started_at: null,
        ends_at: null,
        finished_at: null,
        ranked_results: null,
      })
      .eq('id', normalizedRoomId),
    client.from('battle_events').insert(mapBattleEventToRow(resetEvent)),
  ];
  if (room.participants.length > 0) {
    ops.push(
      client
        .from('battle_participants')
        .upsert(room.participants.map(mapBattleParticipantToRow), {
          onConflict: 'room_id,student_id',
        })
    );
  }
  const results = await Promise.all(ops);
  for (const r of results) {
    assertNoError(r.error, 'Lỗi đặt lại phòng thi đấu trên Supabase');
  }
  return room;
}

// =========================================================================
// Storage, Schema Diagnostics & Full Database Seed
// =========================================================================

export async function uploadHotspotImageOnSupabaseServer(
  client: SupabaseClient,
  input: { base64DataUrl: string; fileName?: string; mimeType?: string }
): Promise<{ ok: boolean; url?: string; message?: string }> {
  const raw = input.base64DataUrl.trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new SupabaseStoreError(400, 'Định dạng dữ liệu ảnh Base64 không hợp lệ.');
  }
  const mime = (input.mimeType || match[1] || 'image/png').toLowerCase();
  if (!mime.startsWith('image/')) {
    throw new SupabaseStoreError(400, 'Chỉ chấp nhận tải lên tệp hình ảnh.');
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 10 * 1024 * 1024) {
    throw new SupabaseStoreError(400, 'Ảnh tải lên không được vượt quá 10 MB.');
  }

  const extMatch = (input.fileName || '').match(/\.([a-zA-Z0-9]+)$/);
  const mimeExt = mime.split('/')[1]?.split('+')[0]?.toLowerCase();
  const normalizedMimeExt = mimeExt === 'jpeg' ? 'jpg' : mimeExt;
  const ext = extMatch ? extMatch[1].toLowerCase() : normalizedMimeExt || 'png';
  const filePath = `questions/${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  const { error } = await client.storage
    .from(HOTSPOT_STORAGE_BUCKET)
    .upload(filePath, buffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: mime,
    });

  if (error) {
    throw new SupabaseStoreError(502, `Lỗi tải ảnh lên Storage: ${error.message}`);
  }

  const { data } = client.storage
    .from(HOTSPOT_STORAGE_BUCKET)
    .getPublicUrl(filePath);

  return { ok: true, url: data.publicUrl };
}

export async function testSupabaseConnectionOnServer(
  client: SupabaseClient,
  referenceDb?: AdminDatabase
): Promise<ServerConnectionReport> {
  const totalTasks =
    referenceDb?.classTaskConfigs.reduce((sum, cfg) => sum + cfg.tasks.length, 0) ??
    null;

  const specs = [
    {
      table: 'schools',
      label: 'Trường học',
      selectCols: 'id',
      localCount: referenceDb?.schools.length ?? null,
    },
    {
      table: 'classes',
      label: 'Lớp học',
      selectCols: 'id',
      localCount: referenceDb?.classes.length ?? null,
    },
    {
      table: 'students',
      label: 'Học sinh',
      selectCols: 'id',
      localCount: referenceDb?.students.length ?? null,
    },
    {
      table: 'admin_teachers',
      label: 'Giáo viên & Phân quyền',
      selectCols: 'user_id',
      localCount: referenceDb?.teachers.length ?? null,
    },
    {
      table: 'ic3_modules',
      label: 'Mô-đun IC3 (LV1, LV2...)',
      selectCols: 'id, code, level',
      localCount: referenceDb?.modules?.length ?? null,
    },
    {
      table: 'knowledge_categories',
      label: 'Nhóm kiến thức (GM, OT...)',
      selectCols: 'id, module, code',
      localCount: referenceDb?.knowledgeCategories?.length ?? null,
    },
    {
      table: 'knowledge_parts',
      label: 'Phần kiến thức (GM1, OT1...)',
      selectCols: 'id, module, category, code',
      localCount: referenceDb?.knowledgeParts?.length ?? null,
    },
    {
      table: 'questions',
      label: 'Câu hỏi (kèm content_code & topic_order)',
      selectCols: 'id, content_code, topic_order',
      localCount: referenceDb?.questions.length ?? null,
    },
    {
      table: 'question_sets',
      label: 'Bộ đề Luyện & Thi đấu',
      selectCols: 'id',
      localCount: referenceDb?.questionSets.length ?? null,
    },
    {
      table: 'class_task_configs',
      label: 'Cấu hình Bài tập Lớp',
      selectCols: 'class_id',
      localCount: referenceDb?.classTaskConfigs.length ?? null,
    },
    {
      table: 'class_tasks',
      label: 'Danh sách Bài tập Lớp',
      selectCols: 'id',
      localCount: totalTasks,
    },
    {
      table: 'student_task_submissions',
      label: 'Lịch sử Nộp bài',
      selectCols: 'id',
      localCount: referenceDb?.submissions.length ?? null,
    },
    {
      table: 'student_break_states',
      label: 'Trạng thái Giải lao',
      selectCols: 'student_id',
      localCount: referenceDb?.breakStates.length ?? null,
    },
    {
      table: 'class_battle_configs',
      label: 'Cấu hình Thi đấu Lớp',
      selectCols: 'class_id',
      localCount: referenceDb?.battleConfigs.length ?? null,
    },
    {
      table: 'battle_rooms',
      label: 'Phòng Thi đấu Realtime',
      selectCols: 'id',
      localCount: referenceDb?.battleRooms.length ?? null,
    },
  ];

  const t0 = performance.now();
  const tableChecks = await Promise.all(
    specs.map(async (spec): Promise<ServerTableCheck> => {
      try {
        const { count, error } = await client
          .from(spec.table)
          .select(spec.selectCols, { count: 'exact', head: true });
        if (error) {
          return {
            table: spec.table,
            label: spec.label,
            ok: false,
            remoteCount: null,
            localCount: spec.localCount,
            error: error.message,
          };
        }
        return {
          table: spec.table,
          label: spec.label,
          ok: true,
          remoteCount: count ?? 0,
          localCount: spec.localCount,
        };
      } catch (err) {
        return {
          table: spec.table,
          label: spec.label,
          ok: false,
          remoteCount: null,
          localCount: spec.localCount,
          error: err instanceof Error ? err.message : 'Lỗi truy vấn bảng',
        };
      }
    })
  );

  const latencyMs = Math.max(1, Math.round(performance.now() - t0));
  const readyTables = tableChecks.filter((r) => r.ok).length;
  const ok = readyTables === tableChecks.length;

  return {
    ok,
    latencyMs,
    tablesChecked: tableChecks.length,
    readyTables,
    tableChecks,
    message: ok
      ? `Kết nối thành công tới Supabase (${readyTables}/${tableChecks.length} bảng sẵn sàng, độ trễ ${latencyMs}ms).`
      : readyTables > 0
        ? `Kết nối được Supabase nhưng mới có ${readyTables}/${tableChecks.length} bảng sẵn sàng (${latencyMs}ms). Vui lòng chạy kịch bản SQL cập nhật hoặc kiểm tra quyền RLS.`
        : `Không thể truy cập các bảng trên Supabase: ${tableChecks[0]?.error || 'Kiểm tra URL, Anon Key hoặc chạy kịch bản SQL.'}`,
  };
}

export async function fetchSupabaseSampleQuestionsOnServer(client: SupabaseClient) {
  const [partsRes, questionsRes] = await Promise.all([
    client
      .from('knowledge_parts')
      .select('id, level, category, code, title')
      .order('level', { ascending: true })
      .order('category', { ascending: true })
      .order('order_index', { ascending: true })
      .limit(8),
    client
      .from('questions')
      .select('id, level, category, content_code, topic_order, type, prompt')
      .order('level', { ascending: true })
      .order('category', { ascending: true })
      .order('content_code', { ascending: true })
      .order('topic_order', { ascending: true })
      .limit(8),
  ]);

  if (partsRes.error) {
    return {
      ok: false,
      message: `Lỗi đọc knowledge_parts: ${partsRes.error.message}`,
      parts: [],
      questions: [],
    };
  }
  if (questionsRes.error) {
    return {
      ok: false,
      message: `Lỗi đọc questions: ${questionsRes.error.message}`,
      parts: partsRes.data ?? [],
      questions: [],
    };
  }

  const parts = partsRes.data ?? [];
  const questions = questionsRes.data ?? [];
  return {
    ok: true,
    message: `Đọc thử thành công ${parts.length} phần kiến thức và ${questions.length} câu hỏi trực tiếp từ Supabase.`,
    parts,
    questions,
  };
}

export async function seedDatabaseToSupabase(
  client: SupabaseClient,
  sourceDb: AdminDatabase
): Promise<{ ok: boolean; message: string }> {
  const hashedTeachers = sourceDb.teachers.map((t) => ({
    ...t,
    password: hashTeacherPassword(t.password),
    role: normalizeAdminRole(t.role),
    status: normalizeTeacherStatus(t.status),
  }));

  const payload = buildFullDatabaseSupabasePayload({
    ...sourceDb,
    teachers: hashedTeachers,
  });

  if (payload.schools.length > 0) {
    const { error } = await client
      .from('schools')
      .upsert(payload.schools, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed schools');
  }
  if (payload.classes.length > 0) {
    const { error } = await client
      .from('classes')
      .upsert(payload.classes, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed classes');
  }
  if (payload.students.length > 0) {
    const { error } = await client
      .from('students')
      .upsert(payload.students, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed students');
  }

  const teacherSync = await syncTeachersToSupabaseServer(client, hashedTeachers);
  if (!teacherSync.ok) {
    throw new SupabaseStoreError(
      502,
      `Lỗi seed admin_teachers: ${teacherSync.error}`
    );
  }

  if (payload.modules.length > 0) {
    const { error } = await client
      .from('ic3_modules')
      .upsert(payload.modules, { onConflict: 'code' });
    assertNoError(error, 'Lỗi seed ic3_modules');
  }
  if (payload.categories.length > 0) {
    const { error } = await client
      .from('knowledge_categories')
      .upsert(payload.categories, { onConflict: 'module,code' });
    assertNoError(error, 'Lỗi seed knowledge_categories');
  }
  if (payload.parts.length > 0) {
    const { error } = await client
      .from('knowledge_parts')
      .upsert(payload.parts, { onConflict: 'module,category,code' });
    assertNoError(error, 'Lỗi seed knowledge_parts');
  }
  if (payload.questions.length > 0) {
    const { error } = await client
      .from('questions')
      .upsert(payload.questions, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed questions');
  }
  if (payload.questionSets.length > 0) {
    const { error } = await client
      .from('question_sets')
      .upsert(payload.questionSets, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed question_sets');
  }
  if (payload.classTaskConfigs.length > 0) {
    const { error } = await client
      .from('class_task_configs')
      .upsert(payload.classTaskConfigs, { onConflict: 'class_id' });
    assertNoError(error, 'Lỗi seed class_task_configs');
  }
  if (payload.classTasks.length > 0) {
    const { error } = await client
      .from('class_tasks')
      .upsert(payload.classTasks, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed class_tasks');
  }
  if (payload.submissions.length > 0) {
    const { error } = await client
      .from('student_task_submissions')
      .upsert(payload.submissions, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed student_task_submissions');
  }
  if (payload.breakStates.length > 0) {
    const { error } = await client
      .from('student_break_states')
      .upsert(payload.breakStates, { onConflict: 'student_id' });
    assertNoError(error, 'Lỗi seed student_break_states');
  }
  if (payload.battleConfigs.length > 0) {
    const { error } = await client
      .from('class_battle_configs')
      .upsert(payload.battleConfigs, { onConflict: 'class_id' });
    assertNoError(error, 'Lỗi seed class_battle_configs');
  }
  if (payload.battleRooms.length > 0) {
    const { error } = await client
      .from('battle_rooms')
      .upsert(payload.battleRooms, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed battle_rooms');
  }
  if (payload.battleParticipants.length > 0) {
    const { error } = await client
      .from('battle_participants')
      .upsert(payload.battleParticipants, { onConflict: 'room_id,student_id' });
    assertNoError(error, 'Lỗi seed battle_participants');
  }
  if (payload.battleEvents.length > 0) {
    const { error } = await client
      .from('battle_events')
      .upsert(payload.battleEvents, { onConflict: 'id' });
    assertNoError(error, 'Lỗi seed battle_events');
  }

  return {
    ok: true,
    message: `Đã đồng bộ toàn bộ 17 bảng lên Supabase (${payload.schools.length} trường, ${payload.classes.length} lớp, ${payload.students.length} học sinh, ${payload.adminTeachers.length} giáo viên, ${payload.questions.length} câu hỏi, ${payload.questionSets.length} bộ đề, ${payload.classTasks.length} bài tập lớp, ${payload.battleRooms.length} phòng thi đấu).`,
  };
}
