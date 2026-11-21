import {
  CATEGORY_LABELS,
  MODULE_LABELS,
  QUESTION_DEFAULT_INSTRUCTIONS,
  type AdminTaskStatRecord,
  type BattleParticipant,
  type BattleRankedResult,
  type ClassTaskItem,
  type HotspotTarget,
  type IC3Level,
  type IC3Module,
  type IC3ModuleRecord,
  type KnowledgeCategory,
  type KnowledgeCategoryRecord,
  type KnowledgePart,
  type Question,
  type QuestionSet,
  type QuestionType,
  type SchoolClass,
  type StudentProfile,
} from '../types/ic3';

/**
 * Lấy câu hướng dẫn ngắn mặc định tương ứng với từng dạng câu hỏi IC3.
 */
export function getDefaultInstructionForQuestionType(type: QuestionType): string {
  return QUESTION_DEFAULT_INSTRUCTIONS[type] ?? QUESTION_DEFAULT_INSTRUCTIONS.single;
}

/**
 * Chuẩn hóa mật khẩu mặc định học sinh từ họ tên tiếng Việt:
 * Viết thường, bỏ toàn bộ dấu tiếng Việt (kể cả đ/Đ -> d), xóa toàn bộ khoảng trắng.
 * Ví dụ: "Đỗ Gia Huy" -> "dogiahuy", "Nguyễn Văn An" -> "nguyenvanan".
 */
export function normalizeVietnamesePassword(fullName: string): string {
  return fullName
    .trim()
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Kiểm tra mật khẩu tự đổi của học sinh:
 * Tối thiểu 4 ký tự, không chứa khoảng trắng, khác mật khẩu hiện tại.
 */
export function validateStudentPassword(
  newPassword: string,
  currentPassword?: string
): { valid: boolean; error?: string } {
  if (!newPassword || newPassword.length < 4) {
    return { valid: false, error: 'Mật khẩu phải có ít nhất 4 ký tự.' };
  }
  if (/\s/.test(newPassword)) {
    return { valid: false, error: 'Mật khẩu không được chứa khoảng trắng.' };
  }
  if (currentPassword && newPassword === currentPassword) {
    return { valid: false, error: 'Mật khẩu mới phải khác mật khẩu hiện tại.' };
  }
  return { valid: true };
}

/**
 * Quy tắc chấm điểm chuẩn IC3 thang 0 - 1000.
 */
export function calculateIC3Score(correctCount: number, totalCount: number): number {
  if (totalCount <= 0 || correctCount <= 0) return 0;
  const clamped = Math.min(correctCount, totalCount);
  return Math.round((clamped / totalCount) * 1000);
}

/**
 * Ngưỡng đạt chuẩn thi thử IC3: score >= 700.
 */
export function isPassingIC3Score(score: number): boolean {
  return score >= 700;
}

/**
 * Chấm điểm cho cả 5 dạng câu hỏi IC3:
 * single, multiple, true_false, matching, hotspot (dung sai ±1.5%).
 */
export function gradeQuestion(question: Question, answer: unknown): boolean {
  if (answer == null) return false;
  const payload = question.payload;

  switch (question.type) {
    case 'single': {
      if (!('correctOptionId' in payload)) return false;
      return typeof answer === 'string' && answer === payload.correctOptionId;
    }
    case 'multiple': {
      if (!('correctOptionIds' in payload)) return false;
      if (!Array.isArray(answer)) return false;
      const expected = new Set(payload.correctOptionIds);
      const selected = new Set(answer.filter((x): x is string => typeof x === 'string'));
      if (expected.size === 0 || selected.size !== expected.size) return false;
      for (const id of expected) {
        if (!selected.has(id)) return false;
      }
      return true;
    }
    case 'true_false': {
      if (!('statements' in payload)) return false;
      if (typeof answer !== 'object' || Array.isArray(answer)) return false;
      const map = answer as Record<string, unknown>;
      if (payload.statements.length === 0) return false;
      return payload.statements.every((stmt) => map[stmt.id] === stmt.isTrue);
    }
    case 'matching': {
      if (!('correctPairs' in payload)) return false;
      if (typeof answer !== 'object' || Array.isArray(answer)) return false;
      const map = answer as Record<string, unknown>;
      if (payload.correctPairs.length === 0) return false;
      return payload.correctPairs.every((pair) => map[pair.leftId] === pair.rightId);
    }
    case 'hotspot': {
      if (!('hotspotTarget' in payload)) return false;
      if (typeof answer !== 'object' || Array.isArray(answer)) return false;
      const point = answer as { x?: unknown; y?: unknown };
      if (typeof point.x !== 'number' || typeof point.y !== 'number') return false;
      const tolerance = 1.5;
      const t = payload.hotspotTarget;
      return (
        point.x >= t.minX - tolerance &&
        point.x <= t.maxX + tolerance &&
        point.y >= t.minY - tolerance &&
        point.y <= t.maxY + tolerance
      );
    }
    default:
      return false;
  }
}

/**
 * Tính tọa độ tâm (%) của vùng đáp án Hotspot.
 */
export function getHotspotTargetCenter(target: HotspotTarget): { x: number; y: number } {
  return {
    x: Number(((target.minX + target.maxX) / 2).toFixed(1)),
    y: Number(((target.minY + target.maxY) / 2).toFixed(1)),
  };
}

/**
 * Tạo HotspotTarget từ thao tác nhấp 1 điểm (tạo vùng ±4% x ±6% quanh tâm)
 * hoặc kéo chuột khoanh vùng trên ảnh.
 */
export function buildHotspotTargetFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  label: string
): HotspotTarget {
  const clamp = (val: number) => Number(Math.min(100, Math.max(0, val)).toFixed(1));
  const minX = clamp(Math.min(start.x, end.x));
  const maxX = clamp(Math.max(start.x, end.x));
  const minY = clamp(Math.min(start.y, end.y));
  const maxY = clamp(Math.max(start.y, end.y));

  if (maxX - minX < 2 || maxY - minY < 2) {
    const cx = clamp((start.x + end.x) / 2);
    const cy = clamp((start.y + end.y) / 2);
    return {
      label: label.trim() || 'Điểm đáp án đúng',
      minX: clamp(cx - 4),
      maxX: clamp(cx + 4),
      minY: clamp(cy - 6),
      maxY: clamp(cy + 6),
    };
  }

  return {
    label: label.trim() || 'Điểm đáp án đúng',
    minX,
    minY,
    maxX,
    maxY,
  };
}

export interface TaskCompletionSummary {
  qualifyingAttempts: number;
  totalAttempts: number;
  bestScore: number;
  completed: boolean;
}

/**
 * Đánh giá tiến độ hoàn thành một nhiệm vụ lớp của học sinh.
 */
export function evaluateTaskCompletion(
  submissions: AdminTaskStatRecord[],
  studentId: string,
  task: Pick<ClassTaskItem, 'id' | 'requiredAttempts' | 'minScore'>
): TaskCompletionSummary {
  const relevant = submissions.filter(
    (s) => s.studentId === studentId && s.taskId === task.id
  );
  const qualifyingAttempts = relevant.filter((s) => s.score >= task.minScore).length;
  const bestScore = relevant.reduce((max, s) => Math.max(max, s.score), 0);
  return {
    qualifyingAttempts,
    totalAttempts: relevant.length,
    bestScore,
    completed: qualifyingAttempts >= task.requiredAttempts,
  };
}

/**
 * Kiểm tra học sinh đã hoàn thành 100% nhiệm vụ của lớp để mở khóa giờ giải lao chưa.
 */
export function isStudentBreakUnlocked(
  tasks: ClassTaskItem[],
  submissions: AdminTaskStatRecord[],
  studentId: string
): boolean {
  if (tasks.length === 0) return false;
  return tasks.every(
    (t) => evaluateTaskCompletion(submissions, studentId, t).completed
  );
}

/**
 * Xếp hạng người chơi trong phòng thi đấu Realtime:
 * Ưu tiên Điểm (score) giảm dần -> Thời gian làm (durationSeconds) tăng dần.
 */
export function rankBattleParticipants(
  participants: BattleParticipant[],
  totalQuestions: number,
  topRewardCount: number,
  breakRewardMinutes: number
): BattleRankedResult[] {
  const sorted = [...participants].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.durationSeconds !== b.durationSeconds) {
      return a.durationSeconds - b.durationSeconds;
    }
    return b.correctCount - a.correctCount;
  });

  return sorted.map((p, index) => {
    const rank = index + 1;
    return {
      rank,
      studentId: p.studentId,
      studentName: p.studentName,
      studentCode: p.studentCode,
      score: p.score,
      correctCount: p.correctCount,
      totalQuestions,
      durationSeconds: p.durationSeconds,
      rewardedBreakMinutes: rank <= topRewardCount ? breakRewardMinutes : 0,
    };
  });
}

export interface ParsedStudentRow {
  fullName: string;
  studentCode: string;
  defaultPassword: string;
}

/**
 * Phân tích danh sách học sinh từ CSV/Excel (hỗ trợ dấu phẩy hoặc chấm phẩy, bỏ dòng tiêu đề).
 * Tự sinh mã học sinh nếu thiếu và tạo mật khẩu mặc định chuẩn không dấu.
 */
export function parseStudentsCsv(
  csvText: string,
  classPrefix = 'HS'
): { rows: ParsedStudentRow[]; errors: string[] } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: ParsedStudentRow[] = [];
  const errors: string[] = [];

  lines.forEach((line, idx) => {
    const delimiter = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
    const cols = line
      .split(delimiter)
      .map((c) => c.trim().replace(/^["']|["']$/g, ''));

    const firstLower = (cols[0] ?? '').toLowerCase();
    if (
      idx === 0 &&
      (firstLower.includes('họ') ||
        firstLower.includes('full_name') ||
        firstLower.includes('name') ||
        firstLower.includes('mã'))
    ) {
      return;
    }

    let fullName = '';
    let studentCode = '';

    if (cols.length >= 2 && cols[0] && cols[1]) {
      // Hỗ trợ cả "Mã, Họ tên" hoặc "Họ tên, Mã"
      if (/^[A-Za-z0-9_-]{3,16}$/.test(cols[0]) && !/\s/.test(cols[0])) {
        studentCode = cols[0].toUpperCase();
        fullName = cols[1];
      } else {
        fullName = cols[0];
        studentCode = cols[1].toUpperCase();
      }
    } else if (cols[0]) {
      fullName = cols[0];
      studentCode = `${classPrefix}${String(rows.length + 1).padStart(3, '0')}`;
    }

    if (!fullName) {
      errors.push(`Dòng ${idx + 1}: Thiếu họ tên học sinh.`);
      return;
    }

    const defaultPassword = normalizeVietnamesePassword(fullName);
    if (!defaultPassword) {
      errors.push(`Dòng ${idx + 1}: Họ tên "${fullName}" không hợp lệ.`);
      return;
    }

    rows.push({ fullName, studentCode, defaultPassword });
  });

  return { rows, errors };
}

function escapeCsvCell(value: string | number | boolean): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Xuất bảng thống kê nộp bài ra chuỗi CSV (có UTF-8 BOM để mở chuẩn tiếng Việt trong Excel).
 */
export function formatSubmissionsToCsv(
  records: AdminTaskStatRecord[],
  classes: SchoolClass[],
  students: StudentProfile[]
): string {
  const classMap = new Map(classes.map((c) => [c.id, c.name]));
  const studentMap = new Map(students.map((s) => [s.id, s]));

  const headers = [
    'Mã học sinh',
    'Họ và tên',
    'Lớp',
    'Nhiệm vụ',
    'Lần làm',
    'Điểm (1000)',
    'Số câu đúng',
    'Tổng số câu',
    'Điểm sàn',
    'Đạt chuẩn',
    'Thời gian (giây)',
    'Thời điểm nộp',
  ];

  const lines = [headers.map(escapeCsvCell).join(',')];

  for (const r of records) {
    const className = classMap.get(r.classId) ?? r.classId;
    const st = studentMap.get(r.studentId);
    const row = [
      st?.studentCode ?? r.studentCode,
      st?.fullName ?? r.studentName,
      className,
      r.taskTitle,
      `${r.attemptNumber}/${r.requiredAttempts}`,
      r.score,
      r.correctCount,
      r.totalCount,
      r.minScore,
      r.metMinScore ? 'Đạt' : 'Chưa đạt',
      r.durationSeconds,
      r.completedAt,
    ];
    lines.push(row.map(escapeCsvCell).join(','));
  }

  return '\uFEFF' + lines.join('\r\n');
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.round(seconds % 60));
  if (mins === 0) return `${secs}s`;
  return `${mins}p ${String(secs).padStart(2, '0')}s`;
}

/**
 * Lấy danh sách câu hỏi thuộc 1 Phần kiến thức (Module + Category + ContentCode),
 * sắp xếp theo số thứ tự câu hỏi trong chủ đề (topicOrder) tăng dần.
 */
export function getPartQuestionsSorted(
  questions: Question[],
  module: IC3Module,
  category: KnowledgeCategory,
  contentCode: string
): Question[] {
  const normalizedCode = contentCode.trim().toLowerCase();
  return questions
    .filter(
      (q) =>
        q.module === module &&
        q.category === category &&
        (q.contentCode || '').trim().toLowerCase() === normalizedCode
    )
    .sort((a, b) => {
      if ((a.topicOrder ?? 0) !== (b.topicOrder ?? 0)) {
        return (a.topicOrder ?? 0) - (b.topicOrder ?? 0);
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
}

/**
 * Tính số thứ tự (topicOrder) tiếp theo khi thêm câu hỏi mới vào Phần kiến thức.
 */
export function getNextTopicOrder(
  questions: Question[],
  module: IC3Module,
  category: KnowledgeCategory,
  contentCode: string
): number {
  const list = getPartQuestionsSorted(questions, module, category, contentCode);
  if (list.length === 0) return 1;
  const maxOrder = list.reduce((max, q) => Math.max(max, q.topicOrder ?? 0), 0);
  return maxOrder + 1;
}

/**
 * Lấy danh sách câu hỏi theo khoảng số thứ tự (từ câu ... đến câu ...) trong một Phần kiến thức.
 */
export function sliceQuestionsByOrderRange(
  questions: Question[],
  module: IC3Module,
  category: KnowledgeCategory,
  contentCode: string,
  fromOrder: number,
  toOrder: number
): Question[] {
  const minO = Math.min(fromOrder, toOrder);
  const maxO = Math.max(fromOrder, toOrder);
  return getPartQuestionsSorted(questions, module, category, contentCode).filter(
    (q) => q.topicOrder >= minO && q.topicOrder <= maxO
  );
}

/**
 * Đổi vị trí lên/xuống của một câu hỏi trong cùng Phần kiến thức và chuẩn hóa lại số thứ tự 1..N.
 */
export function buildReorderedPartUpdates(
  questions: Question[],
  module: IC3Module,
  category: KnowledgeCategory,
  contentCode: string,
  questionId: string,
  direction: -1 | 1
): Array<{ id: string; topicOrder: number }> {
  const sorted = getPartQuestionsSorted(questions, module, category, contentCode);
  const idx = sorted.findIndex((q) => q.id === questionId);
  const targetIdx = idx + direction;
  if (idx === -1 || targetIdx < 0 || targetIdx >= sorted.length) {
    return sorted.map((q, i) => ({ id: q.id, topicOrder: i + 1 }));
  }
  const reordered = [...sorted];
  [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
  return reordered.map((q, i) => ({ id: q.id, topicOrder: i + 1 }));
}

export interface QuestionBankSupabasePayload {
  modules: Array<{
    id: string;
    code: string;
    level: string;
    title: string;
    description: string;
    order_index: number;
  }>;
  categories: Array<{
    id: string;
    module: string;
    code: string;
    title: string;
    description: string;
    order_index: number;
  }>;
  parts: Array<{
    id: string;
    module: string;
    level: string;
    category: string;
    code: string;
    title: string;
    description: string;
    order_index: number;
  }>;
  questions: Array<{
    id: string;
    module: string;
    level: string;
    category: string;
    content_code: string;
    topic_order: number;
    topic: string;
    type: Question['type'];
    prompt: string;
    instruction: string | null;
    payload: Question['payload'];
    explanation: string;
    tips: string | null;
    created_at: string;
    updated_at: string;
  }>;
  questionSets: Array<{
    id: string;
    title: string;
    description: string;
    level: string | null;
    category: string | null;
    content_code: string | null;
    question_ids: string[];
    created_at: string;
    updated_at: string;
  }>;
}

function defaultLevelForModule(modCode: string): IC3Level {
  if (modCode === 'computing_fundamentals') return 'LV1';
  if (modCode === 'key_applications') return 'LV2';
  if (modCode === 'living_online') return 'LV3';
  return modCode.toUpperCase();
}

function slugKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Chuẩn hóa toàn bộ dữ liệu Ngân hàng Câu hỏi theo thứ tự cha -> con
 * và tự bù các bản ghi cha còn thiếu để đảm bảo không lỗi Khóa ngoại khi đồng bộ Supabase.
 */
export function buildQuestionBankSupabasePayload(input: {
  modules?: IC3ModuleRecord[];
  knowledgeCategories?: KnowledgeCategoryRecord[];
  knowledgeParts?: KnowledgePart[];
  questions: Question[];
  questionSets: QuestionSet[];
}): QuestionBankSupabasePayload {
  const modulesMap = new Map<string, QuestionBankSupabasePayload['modules'][number]>();
  for (const m of input.modules ?? []) {
    const code = m.code.trim();
    if (!code || modulesMap.has(code)) continue;
    modulesMap.set(code, {
      id: m.id,
      code,
      level: m.level.trim().toUpperCase() || defaultLevelForModule(code),
      title: m.title.trim() || MODULE_LABELS[code] || `Mô-đun ${code}`,
      description: m.description ?? '',
      order_index: typeof m.orderIndex === 'number' ? m.orderIndex : modulesMap.size + 1,
    });
  }

  const ensureModule = (modCode: string, levelHint?: string) => {
    const code = modCode.trim();
    if (!code || modulesMap.has(code)) return;
    const lv = (levelHint ?? '').trim().toUpperCase() || defaultLevelForModule(code);
    modulesMap.set(code, {
      id: `mod_${slugKey(code) || 'custom'}`,
      code,
      level: lv,
      title: MODULE_LABELS[code] || `${lv} — ${code}`,
      description: '',
      order_index: modulesMap.size + 1,
    });
  };

  const categoriesMap = new Map<
    string,
    QuestionBankSupabasePayload['categories'][number]
  >();
  for (const c of input.knowledgeCategories ?? []) {
    const mod = c.module.trim();
    const code = c.code.trim().toUpperCase();
    if (!mod || !code) continue;
    ensureModule(mod);
    const key = `${mod}::${code}`;
    if (categoriesMap.has(key)) continue;
    categoriesMap.set(key, {
      id: c.id,
      module: mod,
      code,
      title: c.title.trim() || CATEGORY_LABELS[code]?.name || `Nhóm ${code}`,
      description: c.description ?? '',
      order_index:
        typeof c.orderIndex === 'number' ? c.orderIndex : categoriesMap.size + 1,
    });
  }

  const ensureCategory = (modCode: string, catCode: string, levelHint?: string) => {
    const mod = modCode.trim();
    const code = catCode.trim().toUpperCase();
    if (!mod || !code) return;
    ensureModule(mod, levelHint);
    const key = `${mod}::${code}`;
    if (categoriesMap.has(key)) return;
    categoriesMap.set(key, {
      id: `cat_${slugKey(`${mod}_${code}`)}`,
      module: mod,
      code,
      title: CATEGORY_LABELS[code]?.name || `Nhóm ${code}`,
      description: CATEGORY_LABELS[code]?.description || '',
      order_index: categoriesMap.size + 1,
    });
  };

  const partsMap = new Map<string, QuestionBankSupabasePayload['parts'][number]>();
  for (const p of input.knowledgeParts ?? []) {
    const mod = p.module.trim();
    const cat = p.category.trim().toUpperCase();
    const code = p.code.trim().toUpperCase();
    if (!mod || !cat || !code) continue;
    const level =
      p.level.trim().toUpperCase() ||
      modulesMap.get(mod)?.level ||
      defaultLevelForModule(mod);
    ensureCategory(mod, cat, level);
    const key = `${mod}::${cat}::${code}`;
    if (partsMap.has(key)) continue;
    partsMap.set(key, {
      id: p.id,
      module: mod,
      level,
      category: cat,
      code,
      title: p.title.trim() || `Chuyên đề ${code}`,
      description: p.description ?? '',
      order_index: typeof p.orderIndex === 'number' ? p.orderIndex : partsMap.size + 1,
    });
  }

  const questions: QuestionBankSupabasePayload['questions'] = input.questions.map((q) => {
    const mod = q.module.trim();
    const cat = q.category.trim().toUpperCase();
    const contentCode = (q.contentCode || `${cat}1`).trim().toUpperCase();
    const level =
      q.level.trim().toUpperCase() ||
      modulesMap.get(mod)?.level ||
      defaultLevelForModule(mod);
    ensureCategory(mod, cat, level);
    const partKey = `${mod}::${cat}::${contentCode}`;
    if (!partsMap.has(partKey)) {
      partsMap.set(partKey, {
        id: `part_${slugKey(`${mod}_${cat}_${contentCode}`)}`,
        module: mod,
        level,
        category: cat,
        code: contentCode,
        title: q.topic?.trim() || `Chuyên đề ${contentCode}`,
        description: '',
        order_index: partsMap.size + 1,
      });
    }
    return {
      id: q.id,
      module: mod,
      level,
      category: cat,
      content_code: contentCode,
      topic_order:
        typeof q.topicOrder === 'number' && q.topicOrder >= 1
          ? Math.round(q.topicOrder)
          : 1,
      topic: (q.topic || 'Tổng hợp').trim(),
      type: q.type,
      prompt: q.prompt,
      instruction: q.instruction ?? getDefaultInstructionForQuestionType(q.type),
      payload: q.payload,
      explanation: q.explanation ?? '',
      tips: q.tips ?? null,
      created_at: q.createdAt,
      updated_at: q.updatedAt,
    };
  });

  const questionSets: QuestionBankSupabasePayload['questionSets'] =
    input.questionSets.map((qs) => ({
      id: qs.id,
      title: qs.title,
      description: qs.description ?? '',
      level: qs.level ?? null,
      category: qs.category ? qs.category.trim().toUpperCase() : null,
      content_code: qs.contentCode ? qs.contentCode.trim() : null,
      question_ids: qs.questionIds,
      created_at: qs.createdAt,
      updated_at: qs.updatedAt,
    }));

  return {
    modules: Array.from(modulesMap.values()),
    categories: Array.from(categoriesMap.values()),
    parts: Array.from(partsMap.values()),
    questions,
    questionSets,
  };
}

/**
 * Bật/tắt chọn tất cả các câu hỏi đang hiển thị (giữ lại lựa chọn ngoài bộ lọc nếu có).
 */
export function toggleSelectAllVisibleIds(
  currentSelectedIds: string[],
  visibleIds: string[]
): string[] {
  if (visibleIds.length === 0) return currentSelectedIds;
  const selectedSet = new Set(currentSelectedIds);
  const allVisibleSelected = visibleIds.every((id) => selectedSet.has(id));
  if (allVisibleSelected) {
    const visibleSet = new Set(visibleIds);
    return currentSelectedIds.filter((id) => !visibleSet.has(id));
  }
  const merged = [...currentSelectedIds];
  for (const id of visibleIds) {
    if (!selectedSet.has(id)) {
      selectedSet.add(id);
      merged.push(id);
    }
  }
  return merged;
}

/**
 * Lọc danh sách câu hỏi theo các ID đã chọn, giữ nguyên thứ tự chuẩn (VD: topicOrder tăng dần).
 */
export function pickQuestionsBySelectedIds(
  orderedQuestions: Question[],
  selectedIds: string[]
): Question[] {
  if (selectedIds.length === 0) return [];
  const selectedSet = new Set(selectedIds);
  return orderedQuestions.filter((q) => selectedSet.has(q.id));
}

/**
 * Tạo chuỗi tóm tắt thứ tự các câu hỏi đã chọn (VD: "Câu 1, Câu 3, Câu 5").
 */
export function formatQuestionOrderSummary(
  questions: Question[],
  maxPreview = 6
): string {
  if (questions.length === 0) return '';
  const labels = questions.map((q) => `Câu ${q.topicOrder}`);
  if (labels.length <= maxPreview) {
    return labels.join(', ');
  }
  return `${labels.slice(0, maxPreview).join(', ')} (+${labels.length - maxPreview} câu)`;
}

export interface SupabasePendingTask {
  id: number;
  label: string;
}

/**
 * Định dạng thông báo trạng thái khi có một hoặc nhiều tác vụ đang chờ phản hồi từ Supabase.
 */
export function formatSupabaseLoadingStatus(
  tasks: SupabasePendingTask[]
): string | null {
  if (tasks.length === 0) return null;
  const latest = tasks[tasks.length - 1];
  if (tasks.length === 1) return latest.label;
  return `${latest.label} (${tasks.length} tác vụ đang chờ Supabase...)`;
}

export interface ClipboardImageSource {
  items?: ArrayLike<{
    kind?: string;
    type?: string;
    getAsFile?: () => File | null;
  }> | null;
  files?: ArrayLike<File> | null;
}

/**
 * Trích xuất tệp hình ảnh đầu tiên từ dữ liệu Clipboard (hỗ trợ Ctrl + V ảnh chụp màn hình hoặc tệp ảnh).
 */
export function extractImageFileFromClipboardData(
  clipboardData: ClipboardImageSource | null | undefined
): File | null {
  if (!clipboardData) return null;

  if (clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i += 1) {
      const item = clipboardData.items[i];
      if (!item) continue;
      const isImage =
        (!item.kind || item.kind === 'file') &&
        typeof item.type === 'string' &&
        item.type.toLowerCase().startsWith('image/');
      if (isImage && typeof item.getAsFile === 'function') {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }

  if (clipboardData.files) {
    for (let i = 0; i < clipboardData.files.length; i += 1) {
      const file = clipboardData.files[i];
      if (
        file &&
        typeof file.type === 'string' &&
        file.type.toLowerCase().startsWith('image/')
      ) {
        return file;
      }
    }
  }

  return null;
}

/**
 * Chỉ cho phép tải tệp ảnh Hotspot lên Storage bucket khi giáo viên bấm "Lưu Câu hỏi"
 * và toàn bộ dữ liệu câu hỏi (đề bài, ảnh, điểm đúng) đã hợp lệ.
 */
export function shouldUploadHotspotFileOnSave(input: {
  questionType: QuestionType;
  hasPendingFile: boolean;
  supabaseConfigured: boolean;
  promptValid: boolean;
  hotspotImageReady: boolean;
  hotspotTargetReady: boolean;
}): boolean {
  if (input.questionType !== 'hotspot') return false;
  if (!input.hasPendingFile || !input.supabaseConfigured) return false;
  return input.promptValid && input.hotspotImageReady && input.hotspotTargetReady;
}

/**
 * Tách đường dẫn file trong Supabase Storage bucket từ URL công khai (hoặc signed URL).
 * Trả về null nếu URL là Data URL, Blob URL, rỗng hoặc không thuộc bucket chỉ định.
 */
export function extractHotspotStoragePathFromUrl(
  imageUrl: string | null | undefined,
  bucketName = 'hotspot-images'
): string | null {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const trimmed = imageUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return null;
  }

  const escapedBucket = bucketName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `/storage/v1/object/(?:public/|authenticated/|sign/)?${escapedBucket}/([^?#]+)`
  );
  const match = trimmed.match(pattern);
  if (!match || !match[1]) return null;

  try {
    return decodeURIComponent(match[1]).replace(/^\/+/, '') || null;
  } catch {
    return match[1].replace(/^\/+/, '') || null;
  }
}

/**
 * Xác định đường dẫn ảnh cũ trên Storage cần xóa khi giáo viên sửa câu hỏi (đổi sang ảnh khác hoặc đổi dạng câu hỏi).
 */
export function getObsoleteHotspotStoragePath(
  oldImageUrl: string | null | undefined,
  newImageUrl: string | null | undefined,
  remainingQuestions: Question[] = [],
  bucketName = 'hotspot-images'
): string | null {
  const oldPath = extractHotspotStoragePathFromUrl(oldImageUrl, bucketName);
  if (!oldPath) return null;

  const newPath = extractHotspotStoragePathFromUrl(newImageUrl, bucketName);
  if (newPath && newPath === oldPath) return null;

  const stillReferenced = remainingQuestions.some((q) => {
    const url = 'imageUrl' in q.payload ? q.payload.imageUrl : undefined;
    return extractHotspotStoragePathFromUrl(url, bucketName) === oldPath;
  });
  return stillReferenced ? null : oldPath;
}

/**
 * Thu thập danh sách đường dẫn ảnh trên Storage cần xóa khi xóa 1 hoặc nhiều câu hỏi Hotspot.
 */
export function collectHotspotStoragePathsToDelete(
  deletedQuestions: Question[],
  remainingQuestions: Question[] = [],
  bucketName = 'hotspot-images'
): string[] {
  const remainingPaths = new Set<string>();
  for (const q of remainingQuestions) {
    const url = 'imageUrl' in q.payload ? q.payload.imageUrl : undefined;
    const path = extractHotspotStoragePathFromUrl(url, bucketName);
    if (path) remainingPaths.add(path);
  }

  const toDelete = new Set<string>();
  for (const q of deletedQuestions) {
    const url = 'imageUrl' in q.payload ? q.payload.imageUrl : undefined;
    const path = extractHotspotStoragePathFromUrl(url, bucketName);
    if (path && !remainingPaths.has(path)) {
      toDelete.add(path);
    }
  }
  return Array.from(toDelete);
}

export type ToastVariant = 'success' | 'warning' | 'error' | 'info';

export const TOAST_VARIANT_TITLES: Record<ToastVariant, string> = {
  success: 'THÀNH CÔNG!',
  warning: 'CẢNH BÁO!',
  error: 'LỖI THAO TÁC!',
  info: 'THÔNG BÁO!',
};

/**
 * Tự động phân loại mức độ thông báo (success / warning / error / info) từ cờ lỗi hoặc nội dung thông điệp.
 */
export function resolveToastVariant(
  msg: string,
  variantOrIsError: boolean | ToastVariant = false
): ToastVariant {
  if (typeof variantOrIsError === 'string') {
    return variantOrIsError;
  }
  const lower = msg.trim().toLowerCase();
  if (variantOrIsError) {
    const isWarningMessage =
      lower.includes('nhưng') ||
      lower.startsWith('vui lòng') ||
      lower.includes('cảnh báo') ||
      lower.includes('chưa cấu hình') ||
      lower.includes('không đọc được dòng dữ liệu nào');
    return isWarningMessage ? 'warning' : 'error';
  }
  const isInfoMessage =
    lower.includes('đã tạm tắt') ||
    lower.includes('sao chép') ||
    lower.startsWith('thông báo') ||
    lower.startsWith('đang ');
  return isInfoMessage ? 'info' : 'success';
}




