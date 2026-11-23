import {
  CATEGORY_LABELS,
  MODULE_LABELS,
  type AdminDatabase,
  type AdminTaskStatRecord,
  type AdminTeacher,
  type BattleEvent,
  type BattleParticipant,
  type BattleRankedResult,
  type BattleRoomState,
  type ClassBattleConfig,
  type ClassTaskConfig,
  type ClassTaskItem,
  type IC3Level,
  type IC3Module,
  type IC3ModuleRecord,
  type KnowledgeCategory,
  type KnowledgeCategoryRecord,
  type KnowledgePart,
  type Question,
  type QuestionPayload,
  type QuestionSet,
  type QuestionType,
  type School,
  type SchoolClass,
  type StudentBreakState,
  type StudentProfile,
} from '../types/ic3';
import {
  buildAdminTeachersSupabasePayload,
  buildQuestionBankSupabasePayload,
  getDefaultInstructionForQuestionType,
  normalizeAdminRole,
  normalizeTeacherStatus,
} from './ic3Rules';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Đảm bảo ID tương thích với cột `uuid` trên Supabase PostgreSQL.
 * - Nếu đã là UUID chuẩn thì giữ nguyên dạng chữ thường.
 * - Nếu là chuỗi ID tùy biến/seed (vd: `room_6a1_live`, `sub_01`), băm ổn định thành UUIDv4 hợp lệ.
 */
export function ensureSupabaseUuid(rawId: string): string {
  const trimmed = String(rawId || '').trim();
  if (UUID_REGEX.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const input = trimmed || 'default_ic3_id';
  // 128-bit deterministic FNV-1a / Murmur-style 4x32-bit mixing (browser & node safe, no Node crypto needed)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (code * 31 + i), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ (code * 17 + i), 0x27d4eb2f) >>> 0;
  }
  const bytes = new Uint8Array(16);
  const words = [h1, h2, h3, h4];
  for (let w = 0; w < 4; w += 1) {
    bytes[w * 4] = (words[w] >>> 24) & 0xff;
    bytes[w * 4 + 1] = (words[w] >>> 16) & 0xff;
    bytes[w * 4 + 2] = (words[w] >>> 8) & 0xff;
    bytes[w * 4 + 3] = words[w] & 0xff;
  }
  // Set RFC 4122 version 4 & variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function mapSchoolRowToDomain(row: Record<string, unknown>): School {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    district: String(row.district ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function mapSchoolToRow(school: School) {
  return {
    id: school.id,
    name: school.name,
    district: school.district,
    created_at: school.createdAt,
  };
}

export function mapClassRowToDomain(row: Record<string, unknown>): SchoolClass {
  return {
    id: String(row.id),
    schoolId: String(row.school_id ?? ''),
    name: String(row.name ?? ''),
    grade: String(row.grade ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function mapClassToRow(cls: SchoolClass) {
  return {
    id: cls.id,
    school_id: cls.schoolId,
    name: cls.name,
    grade: cls.grade,
    created_at: cls.createdAt,
  };
}

export function mapStudentRowToDomain(row: Record<string, unknown>): StudentProfile {
  return {
    id: String(row.id),
    classId: String(row.class_id ?? ''),
    fullName: String(row.full_name ?? ''),
    studentCode: String(row.student_code ?? ''),
    passwordHash: String(row.password_hash ?? ''),
    isCustomPassword: Boolean(row.is_custom_password),
    alwaysBreakReady: Boolean(row.always_break_ready),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function mapStudentToRow(st: StudentProfile) {
  return {
    id: st.id,
    class_id: st.classId,
    full_name: st.fullName,
    student_code: st.studentCode,
    password_hash: st.passwordHash,
    is_custom_password: st.isCustomPassword,
    always_break_ready: st.alwaysBreakReady,
    created_at: st.createdAt,
  };
}

export function mapTeacherRowToDomain(row: Record<string, unknown>): AdminTeacher {
  return {
    userId: String(row.user_id ?? ''),
    fullName: String(row.full_name ?? ''),
    email: String(row.email ?? '').trim().toLowerCase(),
    password: typeof row.password_hash === 'string' ? row.password_hash : '',
    role: normalizeAdminRole(typeof row.role === 'string' ? row.role : undefined),
    status: normalizeTeacherStatus(
      typeof row.status === 'string' ? row.status : undefined
    ),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function getDefaultLevelForModule(mod: IC3Module): IC3Level {
  if (mod === 'computing_fundamentals') return 'LV1';
  if (mod === 'key_applications') return 'LV2';
  if (mod === 'living_online') return 'LV3';
  return mod.toUpperCase();
}

export function mapQuestionBankRowsToDomain(input: {
  moduleRows: Array<Record<string, unknown>>;
  categoryRows: Array<Record<string, unknown>>;
  partRows: Array<Record<string, unknown>>;
  questionRows: Array<Record<string, unknown>>;
  setRows: Array<Record<string, unknown>>;
}): {
  modules: IC3ModuleRecord[];
  knowledgeCategories: KnowledgeCategoryRecord[];
  knowledgeParts: KnowledgePart[];
  questions: Question[];
  questionSets: QuestionSet[];
} {
  const partCounters = new Map<string, number>();

  const questions: Question[] = input.questionRows.map((row) => {
    const mod = (row.module as IC3Module) || 'computing_fundamentals';
    const cat = ((row.category as KnowledgeCategory) || 'GM').trim().toUpperCase();
    const level = (row.level as IC3Level) || getDefaultLevelForModule(mod);
    const contentCode = String(row.content_code || `${cat}1`).trim().toUpperCase();
    const counterKey = `${mod}:${cat}:${contentCode}`;
    const fallbackOrder = (partCounters.get(counterKey) ?? 0) + 1;
    const topicOrder =
      typeof row.topic_order === 'number' && row.topic_order >= 1
        ? Math.round(row.topic_order)
        : fallbackOrder;
    partCounters.set(counterKey, Math.max(fallbackOrder, topicOrder));

    let parsedPayload = row.payload as QuestionPayload;
    if (typeof row.payload === 'string') {
      try {
        parsedPayload = JSON.parse(row.payload) as QuestionPayload;
      } catch {
        parsedPayload = { options: [], correctOptionId: '' };
      }
    }

    const now = new Date().toISOString();
    const qType = (row.type as QuestionType) || 'single';
    return {
      id: String(row.id),
      module: mod,
      level,
      category: cat,
      contentCode,
      topicOrder,
      topic: String(row.topic || 'Tổng hợp'),
      type: qType,
      prompt: String(row.prompt || ''),
      instruction: row.instruction
        ? String(row.instruction)
        : getDefaultInstructionForQuestionType(qType),
      payload: parsedPayload,
      explanation: String(row.explanation || ''),
      tips: row.tips ? String(row.tips) : undefined,
      createdAt: String(row.created_at || now),
      updatedAt: String(row.updated_at || now),
    };
  });

  const knowledgeParts: KnowledgePart[] = input.partRows.map((p) => {
    const mod = (p.module as IC3Module) || 'computing_fundamentals';
    const cat = ((p.category as KnowledgeCategory) || 'GM').trim().toUpperCase();
    return {
      id: String(p.id),
      module: mod,
      level: (p.level as IC3Level) || getDefaultLevelForModule(mod),
      category: cat,
      code: String(p.code || `${cat}1`).trim().toUpperCase(),
      title: String(p.title || `Chuyên đề ${p.code || cat}`),
      description: String(p.description || ''),
      orderIndex: typeof p.order_index === 'number' ? p.order_index : 1,
    };
  });

  const modules: IC3ModuleRecord[] = input.moduleRows.map((m) => {
    const code = String(m.code || m.id || 'computing_fundamentals');
    const level = String(m.level || getDefaultLevelForModule(code)).toUpperCase();
    return {
      id: String(m.id),
      code,
      level,
      title: String(m.title || MODULE_LABELS[code] || `Mô-đun ${level}`),
      description: String(m.description || ''),
      orderIndex: typeof m.order_index === 'number' ? m.order_index : 1,
    };
  });

  const knowledgeCategories: KnowledgeCategoryRecord[] = input.categoryRows.map((c) => {
    const code = String(c.code || 'GM').trim().toUpperCase();
    return {
      id: String(c.id),
      module: String(c.module || 'computing_fundamentals'),
      code,
      title: String(c.title || CATEGORY_LABELS[code]?.name || `Nhóm ${code}`),
      description: String(c.description ?? CATEGORY_LABELS[code]?.description ?? ''),
      orderIndex: typeof c.order_index === 'number' ? c.order_index : 1,
    };
  });

  const questionSets: QuestionSet[] = input.setRows.map((s) => {
    const now = new Date().toISOString();
    return {
      id: String(s.id),
      title: String(s.title || 'Bộ đề IC3'),
      description: String(s.description || ''),
      level: (s.level as IC3Level | undefined) ?? undefined,
      category: (s.category as KnowledgeCategory | undefined) ?? undefined,
      contentCode: s.content_code ? String(s.content_code) : undefined,
      questionIds: Array.isArray(s.question_ids)
        ? s.question_ids.map((id) => String(id))
        : [],
      createdAt: String(s.created_at || now),
      updatedAt: String(s.updated_at || now),
    };
  });

  return {
    modules,
    knowledgeCategories,
    knowledgeParts,
    questions,
    questionSets,
  };
}

export function mapClassTaskConfigsFromRows(
  configRows: Array<Record<string, unknown>>,
  taskRows: Array<Record<string, unknown>>
): ClassTaskConfig[] {
  const tasksByClass = new Map<string, ClassTaskItem[]>();
  for (const row of taskRows) {
    const classId = String(row.class_id ?? '');
    if (!classId) continue;
    const item: ClassTaskItem = {
      id: String(row.id),
      classId,
      orderIndex: Number(row.order_index ?? 1),
      title: String(row.title ?? ''),
      description: String(row.description ?? ''),
      level: String(row.level ?? 'LV1'),
      category: String(row.category ?? 'GM'),
      contentCode: String(row.content_code ?? 'GM1'),
      moduleFilter: String(row.module_filter ?? 'all'),
      quizMode: row.quiz_mode === 'exam' ? 'exam' : 'practice',
      questionIds: Array.isArray(row.question_ids)
        ? row.question_ids.map((id) => String(id))
        : [],
      estimatedMinutes: Number(row.estimated_minutes ?? 10),
      requiredAttempts: Number(row.required_attempts ?? 1),
      minScore: Number(row.min_score ?? 0),
    };
    const list = tasksByClass.get(classId) ?? [];
    list.push(item);
    tasksByClass.set(classId, list);
  }

  for (const [, list] of tasksByClass) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  return configRows.map((cfg) => {
    const classId = String(cfg.class_id ?? '');
    return {
      classId,
      assignmentTitle: String(cfg.assignment_title ?? ''),
      teacherName: String(cfg.teacher_name ?? ''),
      breakRewardMinutes: Number(cfg.break_reward_minutes ?? 10),
      updatedAt: String(cfg.updated_at ?? new Date().toISOString()),
      tasks: tasksByClass.get(classId) ?? [],
    };
  });
}

export function mapClassTaskConfigToRow(cfg: ClassTaskConfig) {
  return {
    class_id: cfg.classId,
    assignment_title: cfg.assignmentTitle,
    teacher_name: cfg.teacherName,
    break_reward_minutes: cfg.breakRewardMinutes,
    updated_at: cfg.updatedAt,
  };
}

export function mapClassTaskItemToRow(task: ClassTaskItem) {
  return {
    id: task.id,
    class_id: task.classId,
    order_index: task.orderIndex,
    title: task.title,
    description: task.description,
    level: task.level,
    category: task.category,
    content_code: task.contentCode,
    module_filter: task.moduleFilter,
    quiz_mode: task.quizMode,
    question_ids: task.questionIds,
    estimated_minutes: task.estimatedMinutes,
    required_attempts: task.requiredAttempts,
    min_score: task.minScore,
  };
}

export function mapSubmissionsFromRows(
  subRows: Array<Record<string, unknown>>,
  students: StudentProfile[],
  classTaskConfigs: ClassTaskConfig[]
): AdminTaskStatRecord[] {
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const taskMap = new Map<string, ClassTaskItem>();
  for (const cfg of classTaskConfigs) {
    for (const t of cfg.tasks) {
      taskMap.set(t.id, t);
    }
  }

  return subRows.map((row) => {
    const studentId = String(row.student_id ?? '');
    const taskId = String(row.task_id ?? '');
    const st = studentMap.get(studentId);
    const task = taskMap.get(taskId);
    return {
      id: String(row.id),
      studentId,
      studentName: st?.fullName ?? studentId,
      studentCode: st?.studentCode ?? '',
      schoolId: String(row.school_id ?? ''),
      classId: String(row.class_id ?? ''),
      taskId,
      taskTitle: task?.title ?? taskId,
      score: Number(row.score ?? 0),
      correctCount: Number(row.correct_count ?? 0),
      totalCount: Number(row.total_count ?? 0),
      durationSeconds: Number(row.duration_seconds ?? 0),
      completedAt: String(row.completed_at ?? new Date().toISOString()),
      attemptNumber: Number(row.attempt_number ?? 1),
      requiredAttempts: Number(row.required_attempts ?? 1),
      minScore: Number(row.min_score ?? 0),
      metMinScore: Boolean(row.met_min_score),
    };
  });
}

export function mapSubmissionToRow(sub: AdminTaskStatRecord) {
  return {
    id: ensureSupabaseUuid(sub.id),
    school_id: sub.schoolId,
    class_id: sub.classId,
    student_id: sub.studentId,
    task_id: sub.taskId,
    score: sub.score,
    correct_count: sub.correctCount,
    total_count: sub.totalCount,
    duration_seconds: sub.durationSeconds,
    attempt_number: sub.attemptNumber,
    required_attempts: sub.requiredAttempts,
    min_score: sub.minScore,
    met_min_score: sub.metMinScore,
    completed_at: sub.completedAt,
  };
}

export function mapBreakStateRowToDomain(
  row: Record<string, unknown>
): StudentBreakState {
  const rawStatus = String(row.status ?? 'locked');
  const status: StudentBreakState['status'] =
    rawStatus === 'active' || rawStatus === 'expired' ? rawStatus : 'locked';
  return {
    studentId: String(row.student_id ?? ''),
    status,
    totalGrantedSeconds: Number(row.total_granted_seconds ?? 0),
    remainingSeconds: Number(row.remaining_seconds ?? 0),
    unlockedAt: row.unlocked_at ? String(row.unlocked_at) : undefined,
    expiredAt: row.expired_at ? String(row.expired_at) : undefined,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

export function mapBreakStateToRow(b: StudentBreakState) {
  return {
    student_id: b.studentId,
    status: b.status,
    total_granted_seconds: b.totalGrantedSeconds,
    remaining_seconds: b.remainingSeconds,
    unlocked_at: b.unlockedAt ?? null,
    expired_at: b.expiredAt ?? null,
    updated_at: b.updatedAt,
  };
}

export function mapBattleConfigRowToDomain(
  row: Record<string, unknown>
): ClassBattleConfig {
  return {
    classId: String(row.class_id ?? ''),
    isEnabled: Boolean(row.is_enabled),
    title: String(row.title ?? 'Đấu trường IC3'),
    questionSetId: row.question_set_id ? String(row.question_set_id) : null,
    questionSetName: String(row.question_set_name ?? 'Bộ đề tổng hợp'),
    teacherName: String(row.teacher_name ?? 'Giáo viên điều phối'),
    moduleFilter: String(row.module_filter ?? 'all'),
    questionIds: Array.isArray(row.question_ids)
      ? row.question_ids.map((id) => String(id))
      : [],
    fastComboWindowSeconds: Number(row.fast_combo_window_seconds ?? 15),
    topRewardCount: Number(row.top_reward_count ?? 3),
    breakRewardMinutes: Number(row.break_reward_minutes ?? 10),
    timeLimitSeconds: Number(row.time_limit_seconds ?? 300),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

export function mapBattleConfigToRow(bc: ClassBattleConfig) {
  return {
    class_id: bc.classId,
    is_enabled: bc.isEnabled,
    title: bc.title,
    question_set_id: bc.questionSetId,
    question_set_name: bc.questionSetName,
    teacher_name: bc.teacherName,
    module_filter: bc.moduleFilter,
    question_ids: bc.questionIds,
    fast_combo_window_seconds: bc.fastComboWindowSeconds,
    top_reward_count: bc.topRewardCount,
    break_reward_minutes: bc.breakRewardMinutes,
    time_limit_seconds: bc.timeLimitSeconds,
    updated_at: bc.updatedAt,
  };
}

export function mapBattleParticipantRowToDomain(
  row: Record<string, unknown>
): BattleParticipant {
  return {
    roomId: String(row.room_id ?? ''),
    studentId: String(row.student_id ?? ''),
    studentName: String(row.student_name ?? ''),
    studentCode: String(row.student_code ?? ''),
    connected: Boolean(row.connected),
    answeredCount: Number(row.answered_count ?? 0),
    correctCount: Number(row.correct_count ?? 0),
    score: Number(row.score ?? 0),
    durationSeconds: Number(row.duration_seconds ?? 0),
    finished: Boolean(row.finished),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    shieldCharges: Number(row.shield_charges ?? 0),
    pendingCardChoices: Number(row.pending_card_choices ?? 0),
    attacksUsed: Number(row.attacks_used ?? 0),
    defensesUsed: Number(row.defenses_used ?? 0),
    attacksBlocked: Number(row.attacks_blocked ?? 0),
    activeDebuffs: Array.isArray(row.active_debuffs)
      ? (row.active_debuffs as BattleParticipant['activeDebuffs'])
      : [],
    currentPairCount: Number(row.current_pair_count ?? 0),
    currentPairElapsedSeconds: Number(row.current_pair_elapsed_seconds ?? 0),
    joinedAt: String(row.joined_at ?? new Date().toISOString()),
  };
}

export function mapBattleParticipantToRow(p: BattleParticipant) {
  return {
    room_id: ensureSupabaseUuid(p.roomId),
    student_id: p.studentId,
    student_name: p.studentName,
    student_code: p.studentCode,
    connected: p.connected,
    answered_count: p.answeredCount,
    correct_count: p.correctCount,
    score: p.score,
    duration_seconds: p.durationSeconds,
    finished: p.finished,
    finished_at: p.finishedAt ?? null,
    shield_charges: p.shieldCharges,
    pending_card_choices: p.pendingCardChoices,
    attacks_used: p.attacksUsed,
    defenses_used: p.defensesUsed,
    attacks_blocked: p.attacksBlocked,
    active_debuffs: p.activeDebuffs,
    current_pair_count: p.currentPairCount,
    current_pair_elapsed_seconds: p.currentPairElapsedSeconds,
    joined_at: p.joinedAt,
  };
}

export function mapBattleEventRowToDomain(
  row: Record<string, unknown>
): BattleEvent {
  const rawType = String(row.type ?? 'join');
  const type: BattleEvent['type'] =
    rawType === 'start' ||
    rawType === 'combo' ||
    rawType === 'attack' ||
    rawType === 'blocked' ||
    rawType === 'defense' ||
    rawType === 'finish'
      ? rawType
      : 'join';
  const rawDebuff = row.debuff_type ? String(row.debuff_type) : undefined;
  const debuffType: BattleEvent['debuffType'] =
    rawDebuff === 'blur' ||
    rawDebuff === 'frost' ||
    rawDebuff === 'reverse' ||
    rawDebuff === 'shake'
      ? rawDebuff
      : undefined;

  return {
    id: String(row.id),
    roomId: String(row.room_id ?? ''),
    type,
    message: String(row.message ?? ''),
    actorStudentId: row.actor_student_id
      ? String(row.actor_student_id)
      : undefined,
    actorStudentName: row.actor_student_name
      ? String(row.actor_student_name)
      : undefined,
    targetStudentId: row.target_student_id
      ? String(row.target_student_id)
      : undefined,
    targetStudentName: row.target_student_name
      ? String(row.target_student_name)
      : undefined,
    debuffType,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function mapBattleEventToRow(ev: BattleEvent) {
  return {
    id: ensureSupabaseUuid(ev.id),
    room_id: ensureSupabaseUuid(ev.roomId),
    type: ev.type,
    message: ev.message,
    actor_student_id: ev.actorStudentId ?? null,
    actor_student_name: ev.actorStudentName ?? null,
    target_student_id: ev.targetStudentId ?? null,
    target_student_name: ev.targetStudentName ?? null,
    debuff_type: ev.debuffType ?? null,
    created_at: ev.createdAt,
  };
}

export function mapBattleRoomToRow(room: BattleRoomState) {
  return {
    id: ensureSupabaseUuid(room.id),
    class_id: room.classId,
    status: room.status,
    question_ids: room.questionIds,
    config_snapshot: room.configSnapshot,
    started_at: room.startedAt ?? null,
    ends_at: room.endsAt ?? null,
    finished_at: room.finishedAt ?? null,
    ranked_results: room.rankedResults ?? null,
    created_at: room.createdAt,
  };
}

export function mapBattleRoomsFromRows(
  roomRows: Array<Record<string, unknown>>,
  participantRows: Array<Record<string, unknown>>,
  eventRows: Array<Record<string, unknown>>
): BattleRoomState[] {
  const partsByRoom = new Map<string, BattleParticipant[]>();
  for (const row of participantRows) {
    const mapped = mapBattleParticipantRowToDomain(row);
    const list = partsByRoom.get(mapped.roomId) ?? [];
    list.push(mapped);
    partsByRoom.set(mapped.roomId, list);
  }

  const eventsByRoom = new Map<string, BattleEvent[]>();
  for (const row of eventRows) {
    const mapped = mapBattleEventRowToDomain(row);
    const list = eventsByRoom.get(mapped.roomId) ?? [];
    list.push(mapped);
    eventsByRoom.set(mapped.roomId, list);
  }
  for (const [, list] of eventsByRoom) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return roomRows.map((r) => {
    const id = String(r.id);
    const rawStatus = String(r.status ?? 'lobby');
    const status: BattleRoomState['status'] =
      rawStatus === 'playing' || rawStatus === 'finished' ? rawStatus : 'lobby';
    return {
      id,
      classId: String(r.class_id ?? ''),
      status,
      questionIds: Array.isArray(r.question_ids)
        ? r.question_ids.map((qid) => String(qid))
        : [],
      configSnapshot: r.config_snapshot as ClassBattleConfig,
      startedAt: r.started_at ? String(r.started_at) : undefined,
      endsAt: r.ends_at ? String(r.ends_at) : undefined,
      finishedAt: r.finished_at ? String(r.finished_at) : undefined,
      rankedResults: Array.isArray(r.ranked_results)
        ? (r.ranked_results as BattleRankedResult[])
        : undefined,
      participants: partsByRoom.get(id) ?? [],
      events: eventsByRoom.get(id) ?? [],
      createdAt: String(r.created_at ?? new Date().toISOString()),
    };
  });
}

/**
 * Chuẩn hóa toàn bộ AdminDatabase thành payload 17 bảng để đẩy/seed lên Supabase theo đúng thứ tự khóa ngoại.
 */
export function buildFullDatabaseSupabasePayload(db: AdminDatabase) {
  const qb = buildQuestionBankSupabasePayload({
    modules: db.modules,
    knowledgeCategories: db.knowledgeCategories,
    knowledgeParts: db.knowledgeParts,
    questions: db.questions,
    questionSets: db.questionSets,
  });

  const knownQuestionSetIds = new Set(qb.questionSets.map((s) => s.id));
  const knownClassIds = new Set(db.classes.map((c) => c.id));
  const knownStudentIds = new Set(db.students.map((s) => s.id));
  const knownTaskIds = new Set(
    db.classTaskConfigs.flatMap((cfg) => cfg.tasks.map((t) => t.id))
  );

  const classTaskConfigs = db.classTaskConfigs
    .filter((cfg) => knownClassIds.has(cfg.classId))
    .map(mapClassTaskConfigToRow);

  const classTasks = db.classTaskConfigs
    .filter((cfg) => knownClassIds.has(cfg.classId))
    .flatMap((cfg) => cfg.tasks.map(mapClassTaskItemToRow));

  const submissions = db.submissions
    .filter(
      (sub) =>
        knownStudentIds.has(sub.studentId) &&
        knownClassIds.has(sub.classId) &&
        knownTaskIds.has(sub.taskId)
    )
    .map(mapSubmissionToRow);

  const breakStates = db.breakStates
    .filter((b) => knownStudentIds.has(b.studentId))
    .map(mapBreakStateToRow);

  const battleConfigs = db.battleConfigs
    .filter((bc) => knownClassIds.has(bc.classId))
    .map((bc) => ({
      ...mapBattleConfigToRow(bc),
      question_set_id:
        bc.questionSetId && knownQuestionSetIds.has(bc.questionSetId)
          ? bc.questionSetId
          : null,
    }));

  const validRooms = db.battleRooms.filter((r) => knownClassIds.has(r.classId));
  const battleRooms = validRooms.map(mapBattleRoomToRow);
  const battleParticipants = validRooms.flatMap((r) =>
    r.participants
      .filter((p) => knownStudentIds.has(p.studentId))
      .map((p) => mapBattleParticipantToRow({ ...p, roomId: r.id }))
  );
  const battleEvents = validRooms.flatMap((r) =>
    r.events.map((ev) => mapBattleEventToRow({ ...ev, roomId: r.id }))
  );

  return {
    schools: db.schools.map(mapSchoolToRow),
    classes: db.classes.map(mapClassToRow),
    students: db.students.map(mapStudentToRow),
    adminTeachers: buildAdminTeachersSupabasePayload(db.teachers),
    modules: qb.modules,
    categories: qb.categories,
    parts: qb.parts,
    questions: qb.questions,
    questionSets: qb.questionSets,
    classTaskConfigs,
    classTasks,
    submissions,
    breakStates,
    battleConfigs,
    battleRooms,
    battleParticipants,
    battleEvents,
  };
}
