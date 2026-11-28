import {
  CATEGORY_LABELS,
  MODULE_LABELS,
  QUESTION_DEFAULT_INSTRUCTIONS,
  type AdminRole,
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
  type QuestionPayload,
  type QuestionSet,
  type QuestionType,
  type School,
  type SchoolClass,
  type StudentProfile,
  type TeacherAccountStatus,
} from '../types/ic3.js';

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
 * Chấm điểm cho cả 6 dạng câu hỏi IC3:
 * single, multiple, true_false, matching, matrix_choice, hotspot (dung sai ±1.5%).
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
    case 'matrix_choice': {
      if (!('slots' in payload)) return false;
      if (typeof answer !== 'object' || Array.isArray(answer)) return false;
      const map = answer as Record<string, unknown>;
      if (payload.slots.length === 0) return false;
      return payload.slots.every((slot) => map[slot.id] === slot.correctOptionId);
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
  alwaysBreakReady?: boolean;
}

export interface ParsedClassRow {
  name: string;
  grade: string;
}

/**
 * Sinh mã học sinh nối tiếp theo tên lớp (VD: 6A1-01, 6A1-02... hoặc tiếp theo mã lớn nhất hiện có như 6A1-06).
 */
export function generateNextStudentCode(
  classPrefix: string,
  existingCodes: string[] = []
): string {
  const cleanPrefix =
    classPrefix.trim().toUpperCase().replace(/\s+/g, '') || 'HS';
  const used = new Set(
    existingCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)
  );
  const escapedPrefix = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seqPattern = new RegExp(`^${escapedPrefix}-(\\d+)$`, 'i');

  let maxSeq = 0;
  for (const code of used) {
    const match = code.match(seqPattern);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxSeq) {
        maxSeq = n;
      }
    }
  }

  let seq = maxSeq + 1;
  let candidate = `${cleanPrefix}-${String(seq).padStart(2, '0')}`;
  while (used.has(candidate)) {
    seq += 1;
    candidate = `${cleanPrefix}-${String(seq).padStart(2, '0')}`;
  }
  return candidate;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells.map((c) => c.replace(/^["']|["']$/g, '').trim());
}

/**
 * Chuẩn hóa tên khối lớp (VD: "6", "k6", "khoi 6" -> "Khối 6"; hoặc suy luận từ tên lớp như "7A1" -> "Khối 7").
 */
export function normalizeSchoolClassGrade(
  raw: string,
  fallbackClassName = ''
): string {
  const cleaned = String(raw ?? '').trim();
  if (cleaned) {
    const numMatch = cleaned.match(/^(?:kh[oôố]i|k|grade|gr)?\s*(\d{1,2})$/i);
    if (numMatch) {
      return `Khối ${Number(numMatch[1])}`;
    }
    const embeddedMatch = cleaned.match(/^kh[oôố]i\s*(\d{1,2})$/i);
    if (embeddedMatch) {
      return `Khối ${Number(embeddedMatch[1])}`;
    }
    return cleaned;
  }
  const fromName = String(fallbackClassName ?? '').trim().match(/^(\d{1,2})/);
  if (fromName) {
    return `Khối ${Number(fromName[1])}`;
  }
  return 'Khối 6';
}

/**
 * Phân tích bảng dữ liệu (Excel / CSV) danh sách học sinh.
 * Giáo viên chỉ cần cung cấp Họ và tên; Mã HS luôn được hệ thống tự động đánh nối tiếp theo lớp và Giải lao demo mặc định là false.
 */
export function parseStudentsTabularRows(
  tabularRows: unknown[][],
  classPrefix = 'HS',
  existingCodes: string[] = []
): { rows: ParsedStudentRow[]; warnings: string[]; errors: string[] } {
  const cleanedRows = tabularRows
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []))
    .filter((r) => r.some((c) => c.length > 0));

  if (cleanedRows.length === 0) {
    return {
      rows: [],
      warnings: [],
      errors: ['Không có dòng dữ liệu học sinh nào.'],
    };
  }

  const HEADER_ALIASES = {
    studentCode: new Set(['mahs', 'mahocsinh', 'masv', 'studentcode', 'code', 'ma']),
    fullName: new Set(['hoten', 'hovaten', 'fullname', 'name', 'ten', 'hocsinh', 'tenhocsinh']),
    stt: new Set(['stt', 'tt', 'sothutu', 'no', 'index']),
    alwaysBreakReady: new Set([
      'giailaodemo',
      'giailao',
      'alwaysbreakready',
      'breakready',
      'mokhoagiailao',
      'demo',
    ]),
  };

  const firstRowKeys = cleanedRows[0].map((c) => normalizeColumnHeaderKey(c));
  const codeColByHeader = firstRowKeys.findIndex((k) =>
    HEADER_ALIASES.studentCode.has(k)
  );
  const nameColByHeader = firstRowKeys.findIndex((k) =>
    HEADER_ALIASES.fullName.has(k)
  );
  const sttColByHeader = firstRowKeys.findIndex((k) =>
    HEADER_ALIASES.stt.has(k)
  );
  const breakColByHeader = firstRowKeys.findIndex((k) =>
    HEADER_ALIASES.alwaysBreakReady.has(k)
  );

  const hasHeaderRow =
    codeColByHeader !== -1 ||
    nameColByHeader !== -1 ||
    sttColByHeader !== -1 ||
    breakColByHeader !== -1;
  const dataStartIndex = hasHeaderRow ? 1 : 0;

  const trackedCodes = existingCodes
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const rows: ParsedStudentRow[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (let i = dataStartIndex; i < cleanedRows.length; i += 1) {
    const cols = cleanedRows[i];
    const lineNum = i + 1;

    let fullName = '';

    if (hasHeaderRow) {
      if (nameColByHeader >= 0) {
        fullName = cols[nameColByHeader] ?? '';
      } else {
        const fallbackIdx = cols.findIndex(
          (val, idx) =>
            idx !== codeColByHeader &&
            idx !== sttColByHeader &&
            idx !== breakColByHeader &&
            Boolean(val)
        );
        fullName = fallbackIdx >= 0 ? cols[fallbackIdx] ?? '' : '';
      }
    } else if (cols.length >= 2 && cols[0] && cols[1]) {
      // Nếu cột đầu là STT số thứ tự hoặc mã cũ thì lấy cột thứ hai làm Họ và tên
      if (
        /^\d{1,4}$/.test(cols[0]) ||
        (/^[A-Za-z0-9_-]{2,20}$/.test(cols[0]) && !/\s/.test(cols[0]))
      ) {
        fullName = cols[1];
      } else {
        fullName = cols[0];
      }
    } else if (cols[0]) {
      fullName = cols[0];
    }

    fullName = fullName.trim();
    if (!fullName) {
      errors.push(`Dòng ${lineNum}: Thiếu họ tên học sinh.`);
      continue;
    }

    const defaultPassword = normalizeVietnamesePassword(fullName);
    if (!defaultPassword) {
      errors.push(`Dòng ${lineNum}: Họ tên "${fullName}" không hợp lệ.`);
      continue;
    }

    const studentCode = generateNextStudentCode(classPrefix, trackedCodes);
    trackedCodes.push(studentCode);

    rows.push({
      fullName,
      studentCode,
      defaultPassword,
      alwaysBreakReady: false,
    });
  }

  return { rows, warnings, errors };
}

/**
 * Phân tích danh sách học sinh từ CSV/Excel (hỗ trợ dấu phẩy, chấm phẩy hoặc tab, bỏ dòng tiêu đề).
 * Tự sinh mã học sinh nếu thiếu và tạo mật khẩu mặc định chuẩn không dấu.
 */
export function parseStudentsCsv(
  csvText: string,
  classPrefix = 'HS',
  existingCodes: string[] = []
): { rows: ParsedStudentRow[]; warnings: string[]; errors: string[] } {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], warnings: [], errors: [] };
  }

  const tabular = lines.map((line) => {
    const delimiter = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
    return splitCsvLine(line, delimiter);
  });

  return parseStudentsTabularRows(tabular, classPrefix, existingCodes);
}

/**
 * Phân tích bảng dữ liệu (Excel / CSV) danh sách lớp học.
 */
export function parseClassesTabularRows(tabularRows: unknown[][]): {
  rows: ParsedClassRow[];
  warnings: string[];
  errors: string[];
} {
  const cleanedRows = tabularRows
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []))
    .filter((r) => r.some((c) => c.length > 0));

  if (cleanedRows.length === 0) {
    return {
      rows: [],
      warnings: [],
      errors: ['Không có dòng dữ liệu lớp học nào.'],
    };
  }

  const HEADER_ALIASES = {
    name: new Set(['tenlop', 'lop', 'classname', 'name', 'malop']),
    grade: new Set(['khoi', 'khoilop', 'grade', 'level']),
  };

  const firstRowKeys = cleanedRows[0].map((c) => normalizeColumnHeaderKey(c));
  const nameColByHeader = firstRowKeys.findIndex((k) => HEADER_ALIASES.name.has(k));
  const gradeColByHeader = firstRowKeys.findIndex((k) =>
    HEADER_ALIASES.grade.has(k)
  );
  const hasHeaderRow = nameColByHeader !== -1 || gradeColByHeader !== -1;
  const dataStartIndex = hasHeaderRow ? 1 : 0;

  const rows: ParsedClassRow[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();

  for (let i = dataStartIndex; i < cleanedRows.length; i += 1) {
    const cols = cleanedRows[i];
    const lineNum = i + 1;

    const rawName = hasHeaderRow
      ? nameColByHeader >= 0
        ? cols[nameColByHeader] ?? ''
        : cols[0] ?? ''
      : cols[0] ?? '';
    const rawGrade = hasHeaderRow
      ? gradeColByHeader >= 0
        ? cols[gradeColByHeader] ?? ''
        : ''
      : cols[1] ?? '';

    const name = rawName.trim();
    if (!name) {
      errors.push(`Dòng ${lineNum}: Thiếu tên lớp học.`);
      continue;
    }

    const grade = normalizeSchoolClassGrade(rawGrade, name);
    const dedupeKey = name.toLowerCase();
    if (seenNames.has(dedupeKey)) {
      warnings.push(
        `Dòng ${lineNum}: Trùng tên lớp "${name}" trong tệp nhập (đã bỏ qua).`
      );
      continue;
    }
    seenNames.add(dedupeKey);
    rows.push({ name, grade });
  }

  return { rows, warnings, errors };
}

/**
 * Phân tích danh sách lớp học từ văn bản CSV / dán từ Excel.
 */
export function parseClassesCsv(csvText: string): {
  rows: ParsedClassRow[];
  warnings: string[];
  errors: string[];
} {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], warnings: [], errors: [] };
  }

  const tabular = lines.map((line) => {
    const delimiter = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
    return splitCsvLine(line, delimiter);
  });

  return parseClassesTabularRows(tabular);
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

/**
 * Xuất danh sách lớp học ra CSV (UTF-8 BOM) gồm sĩ số và thống kê cơ bản.
 */
export function formatClassesToCsv(
  classes: SchoolClass[],
  students: StudentProfile[],
  schoolName = ''
): string {
  const headers = [
    'Tên lớp',
    'Khối',
    'Sĩ số học sinh',
    'Đã tự đổi MK',
    'Bật giải lao demo',
    'Trường học',
  ];
  const lines = [headers.map(escapeCsvCell).join(',')];

  for (const cls of classes) {
    const list = students.filter((s) => s.classId === cls.id);
    const customPwCount = list.filter((s) => s.isCustomPassword).length;
    const breakReadyCount = list.filter((s) => s.alwaysBreakReady).length;
    lines.push(
      [
        cls.name,
        cls.grade,
        list.length,
        customPwCount,
        breakReadyCount,
        schoolName,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }

  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Xuất danh sách học sinh của một lớp ra CSV (UTF-8 BOM).
 */
export function formatStudentsToCsv(
  students: StudentProfile[],
  className: string,
  schoolName = ''
): string {
  const headers = [
    'Mã HS',
    'Họ và tên',
    'Mật khẩu hiện hành',
    'Trạng thái mật khẩu',
    'Giải lao demo',
    'Lớp',
    'Trường học',
  ];
  const lines = [headers.map(escapeCsvCell).join(',')];

  for (const st of students) {
    lines.push(
      [
        st.studentCode,
        st.fullName,
        st.passwordHash || normalizeVietnamesePassword(st.fullName),
        st.isCustomPassword ? 'Đã tự đổi' : 'Mặc định',
        st.alwaysBreakReady ? 'Có' : 'Không',
        className,
        schoolName,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
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
    is_enabled: boolean;
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
    is_enabled: boolean;
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
      is_enabled: c.isEnabled !== false,
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
      is_enabled: true,
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
      is_enabled: p.isEnabled !== false,
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
        is_enabled: true,
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
 * Cho phép tải tệp ảnh câu hỏi (ảnh Hotspot hoặc ảnh minh họa tùy chọn cho các dạng khác)
 * lên Storage bucket khi giáo viên bấm "Lưu Câu hỏi" và dữ liệu câu hỏi đã hợp lệ.
 */
export function shouldUploadQuestionImageOnSave(input: {
  questionType: QuestionType;
  hasPendingFile: boolean;
  supabaseConfigured: boolean;
  promptValid: boolean;
  hotspotImageReady?: boolean;
  hotspotTargetReady?: boolean;
}): boolean {
  if (!input.hasPendingFile || !input.supabaseConfigured || !input.promptValid) {
    return false;
  }
  if (input.questionType === 'hotspot') {
    return Boolean(input.hotspotImageReady && input.hotspotTargetReady);
  }
  return true;
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

export interface TeacherPermissions {
  role: AdminRole;
  label: string;
  shortLabel: string;
  description: string;
  canAccessAllSchools: boolean;
  canManageSchools: boolean;
  canManageTeachers: boolean;
  canEditQuestionBank: boolean;
  canAssignClassTasks: boolean;
  canHostBattle: boolean;
  canManageSupabase: boolean;
}

export const ADMIN_ROLE_LIST: AdminRole[] = ['teacher_lv1', 'teacher_lv2', 'master'];

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, TeacherPermissions> = {
  teacher_lv1: {
    role: 'teacher_lv1',
    label: 'Giáo viên Giảng dạy (LV1)',
    shortLabel: 'GV Giảng dạy (LV1)',
    description:
      'Quản lý lớp & học sinh các trường, xem Ngân hàng câu hỏi (chỉ đọc) và giao bài tập. Không chỉnh sửa Ngân hàng câu hỏi, không tổ chức Thi đấu Realtime.',
    canAccessAllSchools: true,
    canManageSchools: false,
    canManageTeachers: false,
    canEditQuestionBank: false,
    canAssignClassTasks: true,
    canHostBattle: false,
    canManageSupabase: false,
  },
  teacher_lv2: {
    role: 'teacher_lv2',
    label: 'Giáo viên Chuyên môn (LV2)',
    shortLabel: 'GV Chuyên môn (LV2)',
    description:
      'Quản lý lớp & học sinh các trường, toàn quyền Ngân hàng câu hỏi & Bộ đề, giao bài tập và tổ chức Thi đấu Realtime.',
    canAccessAllSchools: true,
    canManageSchools: false,
    canManageTeachers: false,
    canEditQuestionBank: true,
    canAssignClassTasks: true,
    canHostBattle: true,
    canManageSupabase: false,
  },
  master: {
    role: 'master',
    label: 'Giáo viên Master',
    shortLabel: 'Giáo viên Master',
    description:
      'Không giới hạn quyền trên toàn hệ thống: quản trị Trường học, phân quyền Giáo viên, cấu hình Supabase và mọi nghiệp vụ học vụ.',
    canAccessAllSchools: true,
    canManageSchools: true,
    canManageTeachers: true,
    canEditQuestionBank: true,
    canAssignClassTasks: true,
    canHostBattle: true,
    canManageSupabase: true,
  },
};

export function normalizeAdminRole(role?: string | null): AdminRole {
  if (role === 'master' || role === 'super_admin') return 'master';
  if (role === 'teacher_lv2') return 'teacher_lv2';
  return 'teacher_lv1';
}

export interface TeacherPermissionDetailItem {
  key: string;
  label: string;
  description: string;
  allowed: boolean;
}

export function getTeacherPermissionDetails(
  role?: string | null
): TeacherPermissionDetailItem[] {
  const perms = getTeacherPermissions(role);
  return [
    {
      key: 'schools_classes_students',
      label: 'Quản lý Lớp học & Học sinh liên trường',
      description:
        'Xem tất cả trường học, thêm/xóa lớp học, thêm hoặc nhập CSV học sinh và đặt lại mật khẩu học sinh.',
      allowed: perms.canAccessAllSchools,
    },
    {
      key: 'class_tasks',
      label: 'Giao Bài tập Lớp & Mở khóa Giải lao',
      description:
        'Giao nhiệm vụ theo lớp, thiết lập số lượt tối thiểu, điểm sàn (0–1000) và phút giải lao thưởng.',
      allowed: perms.canAssignClassTasks,
    },
    {
      key: 'reports_csv',
      label: 'Xem Thống kê & Xuất Báo cáo CSV',
      description:
        'Theo dõi lịch sử nộp bài, xếp hạng và xuất dữ liệu báo cáo chuẩn UTF-8 BOM cho Excel.',
      allowed: true,
    },
    {
      key: 'question_bank_edit',
      label: 'Chỉnh sửa Ngân hàng Câu hỏi & Bộ đề',
      description: perms.canEditQuestionBank
        ? 'Toàn quyền thêm, sửa, xóa, sắp xếp 4 tầng (Mô-đun, Nhóm, Phần, Câu hỏi Hotspot) và Bộ đề.'
        : 'Không được chỉnh sửa — Tài khoản LV1 chỉ có quyền xem Ngân hàng Câu hỏi và Bộ đề.',
      allowed: perms.canEditQuestionBank,
    },
    {
      key: 'realtime_battle',
      label: 'Tổ chức & Điều phối Thi đấu Realtime',
      description: perms.canHostBattle
        ? 'Bật chế độ thi đấu theo lớp, cấu hình thẻ kỹ năng và điều khiển phòng thi đấu trực tiếp.'
        : 'Không có quyền — Tài khoản LV1 không thể mở hoặc điều khiển phòng Thi đấu Realtime.',
      allowed: perms.canHostBattle,
    },
    {
      key: 'manage_schools',
      label: 'Thêm / Xóa Trường học trong Hệ thống',
      description: perms.canManageSchools
        ? 'Tạo trường học mới hoặc xóa trường học và dữ liệu lớp/học sinh trực thuộc.'
        : 'Chỉ dành cho Giáo viên Master.',
      allowed: perms.canManageSchools,
    },
    {
      key: 'manage_teachers_supabase',
      label: 'Quản lý Giáo viên & Cấu hình Supabase',
      description:
        perms.canManageTeachers && perms.canManageSupabase
          ? 'Cấp mới, chỉnh sửa vai trò, khóa/xóa tài khoản giáo viên và cấu hình đồng bộ CSDL Supabase.'
          : 'Chỉ dành cho Giáo viên Master.',
      allowed: perms.canManageTeachers && perms.canManageSupabase,
    },
  ];
}

export function normalizeTeacherStatus(status?: string | null): TeacherAccountStatus {
  return status === 'locked' ? 'locked' : 'active';
}

export function getTeacherPermissions(role?: string | null): TeacherPermissions {
  return ADMIN_ROLE_PERMISSIONS[normalizeAdminRole(role)];
}

export function canDeleteOrDemoteMaster(
  teachers: Array<{ userId: string; role: string; status?: string | null }>,
  targetUserId: string,
  nextRole?: AdminRole,
  nextStatus?: TeacherAccountStatus
): { ok: boolean; error?: string } {
  const target = teachers.find((t) => t.userId === targetUserId);
  if (!target) {
    return { ok: false, error: 'Không tìm thấy tài khoản giáo viên.' };
  }
  const targetRole = normalizeAdminRole(target.role);
  const targetActive = normalizeTeacherStatus(target.status) === 'active';
  const effectiveNextRole = nextRole ?? targetRole;
  const effectiveNextActive =
    nextRole === undefined && nextStatus === undefined
      ? false
      : (nextStatus ?? normalizeTeacherStatus(target.status)) === 'active';

  const willLoseActiveMaster =
    targetRole === 'master' &&
    targetActive &&
    (effectiveNextRole !== 'master' || !effectiveNextActive);

  if (willLoseActiveMaster) {
    const activeMasterCount = teachers.filter(
      (t) =>
        normalizeAdminRole(t.role) === 'master' &&
        normalizeTeacherStatus(t.status) === 'active'
    ).length;
    if (activeMasterCount <= 1) {
      return {
        ok: false,
        error:
          'Phải giữ lại ít nhất 1 tài khoản Giáo viên Master đang hoạt động trong hệ thống.',
      };
    }
  }
  return { ok: true };
}

export function filterTeachers<
  T extends { fullName: string; email: string; role: string; status?: string | null }
>(
  teachers: T[],
  searchQuery: string,
  roleFilter: 'all' | AdminRole,
  statusFilter: 'all' | TeacherAccountStatus = 'all'
): T[] {
  const q = searchQuery.trim().toLowerCase();
  return teachers.filter((t) => {
    const normalizedRole = normalizeAdminRole(t.role);
    const normalizedStatus = normalizeTeacherStatus(t.status);
    if (roleFilter !== 'all' && normalizedRole !== roleFilter) {
      return false;
    }
    if (statusFilter !== 'all' && normalizedStatus !== statusFilter) {
      return false;
    }
    if (!q) return true;
    return (
      t.fullName.toLowerCase().includes(q) ||
      t.email.toLowerCase().includes(q)
    );
  });
}

export function summarizeTeachersByRole(
  teachers: Array<{ role: string }>
): Record<AdminRole, number> & { total: number } {
  const counts: Record<AdminRole, number> & { total: number } = {
    teacher_lv1: 0,
    teacher_lv2: 0,
    master: 0,
    total: teachers.length,
  };
  for (const t of teachers) {
    counts[normalizeAdminRole(t.role)] += 1;
  }
  return counts;
}

export function summarizeTeacherStatuses(
  teachers: Array<{ status?: string | null }>
): Record<TeacherAccountStatus, number> & { total: number } {
  const counts: Record<TeacherAccountStatus, number> & { total: number } = {
    active: 0,
    locked: 0,
    total: teachers.length,
  };
  for (const t of teachers) {
    counts[normalizeTeacherStatus(t.status)] += 1;
  }
  return counts;
}

export interface AdminTeacherSupabaseRow {
  user_id: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: AdminRole;
  status: TeacherAccountStatus;
  created_at: string;
}

export function buildAdminTeachersSupabasePayload(
  teachers: Array<{
    userId: string;
    fullName: string;
    email: string;
    password: string;
    role: string;
    status?: string | null;
    createdAt?: string;
  }>
): AdminTeacherSupabaseRow[] {
  const now = new Date().toISOString();
  const seenEmails = new Set<string>();
  const rows: AdminTeacherSupabaseRow[] = [];
  for (const t of teachers) {
    const email = t.email.trim().toLowerCase();
    const userId = t.userId.trim();
    if (!userId || !email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    rows.push({
      user_id: userId,
      full_name: t.fullName.trim() || email,
      email,
      password_hash: t.password || '',
      role: normalizeAdminRole(t.role),
      status: normalizeTeacherStatus(t.status),
      created_at: t.createdAt || now,
    });
  }
  return rows;
}

export function mapSupabaseRowToAdminTeacher(
  row: Record<string, unknown>,
  existing?: {
    userId: string;
    fullName: string;
    email: string;
    password: string;
    role: AdminRole;
    status: TeacherAccountStatus;
    createdAt: string;
  }
) {
  const email = String(row.email ?? existing?.email ?? '')
    .trim()
    .toLowerCase();
  const userId = String(row.user_id ?? existing?.userId ?? '').trim();
  if (!userId || !email) return null;

  const remoteHash =
    typeof row.password_hash === 'string' ? row.password_hash.trim() : '';

  return {
    userId,
    fullName: String(row.full_name ?? existing?.fullName ?? email).trim() || email,
    email,
    password: remoteHash || existing?.password || '',
    role: normalizeAdminRole(
      typeof row.role === 'string' ? row.role : existing?.role
    ),
    status: normalizeTeacherStatus(
      typeof row.status === 'string' ? row.status : existing?.status
    ),
    createdAt: String(
      row.created_at ?? existing?.createdAt ?? new Date().toISOString()
    ),
  };
}

export function mergeRemoteTeachersWithLocal<
  T extends {
    userId: string;
    fullName: string;
    email: string;
    password: string;
    role: AdminRole;
    status: TeacherAccountStatus;
    createdAt: string;
  }
>(localTeachers: T[], remoteRows: Array<Record<string, unknown>>) {
  const next = localTeachers.map((t) => ({ ...t }));
  let addedCount = 0;
  let updatedCount = 0;

  for (const row of remoteRows) {
    const rowUserId = String(row.user_id ?? '').trim();
    const rowEmail = String(row.email ?? '')
      .trim()
      .toLowerCase();
    if (!rowUserId || !rowEmail) continue;

    const matchIdx = next.findIndex(
      (t) =>
        t.userId === rowUserId ||
        t.email.trim().toLowerCase() === rowEmail
    );

    if (matchIdx >= 0) {
      const existing = next[matchIdx];
      const mapped = mapSupabaseRowToAdminTeacher(row, existing);
      if (!mapped) continue;
      const changed =
        mapped.fullName !== existing.fullName ||
        mapped.email !== existing.email ||
        mapped.role !== existing.role ||
        mapped.status !== existing.status ||
        (Boolean(row.password_hash) && mapped.password !== existing.password);
      next[matchIdx] = {
        ...existing,
        ...mapped,
        // Keep local userId stability when matched by email unless remote matches directly
        userId: existing.userId,
      };
      if (changed) updatedCount += 1;
    } else {
      const mapped = mapSupabaseRowToAdminTeacher(row);
      if (!mapped) continue;
      next.push(mapped as T);
      addedCount += 1;
    }
  }

  return { merged: next, addedCount, updatedCount };
}

export function isSafeRemoteSupabaseUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !host ||
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    if (
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
      /^fc00:/i.test(host) ||
      /^fd[0-9a-f]{2}:/i.test(host) ||
      /^fe80:/i.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function filterSchools(schools: School[], query: string): School[] {
  const q = query.trim().toLowerCase();
  if (!q) return schools;
  return schools.filter(
    (s) =>
      s.name.toLowerCase().includes(q) || s.district.toLowerCase().includes(q)
  );
}

export function summarizeSchoolHierarchyStats(
  schoolId: string,
  classes: SchoolClass[],
  students: StudentProfile[]
): {
  classCount: number;
  studentCount: number;
  classNames: string[];
} {
  const schoolClasses = classes.filter((c) => c.schoolId === schoolId);
  const classIds = new Set(schoolClasses.map((c) => c.id));
  const studentCount = students.filter((st) => classIds.has(st.classId)).length;
  return {
    classCount: schoolClasses.length,
    studentCount,
    classNames: schoolClasses.map((c) => c.name),
  };
}

export function filterClassesByGradeAndQuery(
  classes: SchoolClass[],
  gradeFilter: string,
  query: string
): SchoolClass[] {
  const q = query.trim().toLowerCase();
  return classes.filter((c) => {
    if (gradeFilter !== 'all' && c.grade !== gradeFilter) return false;
    if (
      q &&
      !c.name.toLowerCase().includes(q) &&
      !c.grade.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}

export function summarizeClassStudentStats(
  classId: string,
  students: StudentProfile[]
): {
  studentCount: number;
  customPasswordCount: number;
  breakReadyCount: number;
} {
  const list = students.filter((s) => s.classId === classId);
  let customPasswordCount = 0;
  let breakReadyCount = 0;
  for (const st of list) {
    if (st.isCustomPassword) customPasswordCount += 1;
    if (st.alwaysBreakReady) breakReadyCount += 1;
  }
  return {
    studentCount: list.length,
    customPasswordCount,
    breakReadyCount,
  };
}

export type StudentStatusFilter =
  | 'all'
  | 'default_pw'
  | 'custom_pw'
  | 'break_ready';

export function filterStudentsByStatusAndQuery(
  students: StudentProfile[],
  statusFilter: StudentStatusFilter,
  query: string
): StudentProfile[] {
  const q = query.trim().toLowerCase();
  return students.filter((st) => {
    if (statusFilter === 'default_pw' && st.isCustomPassword) return false;
    if (statusFilter === 'custom_pw' && !st.isCustomPassword) return false;
    if (statusFilter === 'break_ready' && !st.alwaysBreakReady) return false;
    if (
      q &&
      !st.fullName.toLowerCase().includes(q) &&
      !st.studentCode.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}

// =========================================================================
// Question Bank Import / Export Helpers
// =========================================================================

export interface QuestionBankExportScope {
  module?: IC3Module;
  category?: KnowledgeCategory;
  contentCode?: string;
  questionSetId?: string;
}

export interface QuestionBankExportPackage {
  format: 'ic3-question-bank-v1';
  exportedAt: string;
  scopeLabel: string;
  modules: IC3ModuleRecord[];
  knowledgeCategories: KnowledgeCategoryRecord[];
  knowledgeParts: KnowledgePart[];
  questions: Question[];
  questionSets: QuestionSet[];
}

export interface QuestionBankImportBundle {
  modules: IC3ModuleRecord[];
  knowledgeCategories: KnowledgeCategoryRecord[];
  knowledgeParts: KnowledgePart[];
  questions: Question[];
  questionSets: QuestionSet[];
}

const VALID_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set([
  'single',
  'multiple',
  'true_false',
  'matching',
  'hotspot',
  'matrix_choice',
]);

export function buildQuestionBankExportPackage(
  db: {
    modules?: IC3ModuleRecord[];
    knowledgeCategories?: KnowledgeCategoryRecord[];
    knowledgeParts?: KnowledgePart[];
    questions: Question[];
    questionSets: QuestionSet[];
  },
  scope?: QuestionBankExportScope
): QuestionBankExportPackage {
  const allModules = db.modules ?? [];
  const allCategories = db.knowledgeCategories ?? [];
  const allParts = db.knowledgeParts ?? [];
  const allQuestions = db.questions ?? [];
  const allSets = db.questionSets ?? [];

  if (scope?.questionSetId) {
    const targetSet = allSets.find((s) => s.id === scope.questionSetId);
    const idSet = new Set(targetSet?.questionIds ?? []);
    const questions = allQuestions.filter((q) => idSet.has(q.id));
    const modCodes = new Set(questions.map((q) => q.module));
    const catKeys = new Set(
      questions.map((q) => `${q.module}::${q.category.toUpperCase()}`)
    );
    const partKeys = new Set(
      questions.map(
        (q) =>
          `${q.module}::${q.category.toUpperCase()}::${(q.contentCode || '').toUpperCase()}`
      )
    );
    return {
      format: 'ic3-question-bank-v1',
      exportedAt: new Date().toISOString(),
      scopeLabel: targetSet
        ? `Bộ đề: ${targetSet.title}`
        : `Bộ đề: ${scope.questionSetId}`,
      modules: allModules.filter((m) => modCodes.has(m.code)),
      knowledgeCategories: allCategories.filter((c) =>
        catKeys.has(`${c.module}::${c.code.toUpperCase()}`)
      ),
      knowledgeParts: allParts.filter((p) =>
        partKeys.has(
          `${p.module}::${p.category.toUpperCase()}::${p.code.toUpperCase()}`
        )
      ),
      questions,
      questionSets: targetSet ? [targetSet] : [],
    };
  }

  if (scope?.module) {
    const targetMod = scope.module;
    const targetCat = scope.category?.trim().toUpperCase();
    const targetPart = scope.contentCode?.trim().toUpperCase();

    const questions = allQuestions.filter((q) => {
      if (q.module !== targetMod) return false;
      if (targetCat && q.category.trim().toUpperCase() !== targetCat) {
        return false;
      }
      if (
        targetPart &&
        (q.contentCode || '').trim().toUpperCase() !== targetPart
      ) {
        return false;
      }
      return true;
    });

    const modules = allModules.filter((m) => m.code === targetMod);
    const knowledgeCategories = allCategories.filter((c) => {
      if (c.module !== targetMod) return false;
      if (targetCat && c.code.trim().toUpperCase() !== targetCat) return false;
      return true;
    });
    const knowledgeParts = allParts.filter((p) => {
      if (p.module !== targetMod) return false;
      if (targetCat && p.category.trim().toUpperCase() !== targetCat) {
        return false;
      }
      if (targetPart && p.code.trim().toUpperCase() !== targetPart) {
        return false;
      }
      return true;
    });
    const qIdSet = new Set(questions.map((q) => q.id));
    const questionSets = allSets.filter((s) =>
      s.questionIds.some((id) => qIdSet.has(id))
    );

    const scopeParts = [
      MODULE_LABELS[targetMod] || targetMod,
      targetCat,
      targetPart,
    ].filter(Boolean);

    return {
      format: 'ic3-question-bank-v1',
      exportedAt: new Date().toISOString(),
      scopeLabel: scopeParts.join(' / '),
      modules,
      knowledgeCategories,
      knowledgeParts,
      questions,
      questionSets,
    };
  }

  return {
    format: 'ic3-question-bank-v1',
    exportedAt: new Date().toISOString(),
    scopeLabel: 'Toàn bộ Ngân hàng Câu hỏi',
    modules: [...allModules],
    knowledgeCategories: [...allCategories],
    knowledgeParts: [...allParts],
    questions: [...allQuestions],
    questionSets: [...allSets],
  };
}

export function formatQuestionBankToCsv(questions: Question[]): string {
  const headers = [
    'id',
    'module',
    'level',
    'category',
    'contentCode',
    'topicOrder',
    'topic',
    'type',
    'prompt',
    'instruction',
    'payloadJson',
    'explanation',
    'tips',
  ];

  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const q of questions) {
    lines.push(
      [
        q.id,
        q.module,
        q.level,
        q.category,
        q.contentCode,
        q.topicOrder,
        q.topic,
        q.type,
        q.prompt,
        q.instruction ?? '',
        JSON.stringify(q.payload),
        q.explanation ?? '',
        q.tips ?? '',
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

function parseRfc4180CsvRows(rawText: string): string[][] {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function isValidPayloadForType(type: QuestionType, payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  switch (type) {
    case 'single':
      return (
        Array.isArray(p.options) &&
        p.options.length >= 2 &&
        typeof p.correctOptionId === 'string' &&
        p.correctOptionId.trim().length > 0
      );
    case 'multiple':
      return (
        Array.isArray(p.options) &&
        p.options.length >= 2 &&
        Array.isArray(p.correctOptionIds) &&
        p.correctOptionIds.length >= 1
      );
    case 'true_false':
      return Array.isArray(p.statements) && p.statements.length >= 1;
    case 'matching':
      return (
        Array.isArray(p.matchingLeft) &&
        Array.isArray(p.matchingRight) &&
        Array.isArray(p.correctPairs) &&
        p.matchingLeft.length >= 1 &&
        p.matchingRight.length >= 1 &&
        p.correctPairs.length >= 1
      );
    case 'hotspot':
      return (
        Boolean(p.hotspotTarget && typeof p.hotspotTarget === 'object') &&
        (typeof p.imageUrl === 'string' || typeof p.hotspotType === 'string')
      );
    case 'matrix_choice':
      return (
        Array.isArray(p.options) &&
        p.options.length >= 2 &&
        Array.isArray(p.slots) &&
        p.slots.length >= 1 &&
        p.slots.every(
          (s) =>
            Boolean(s && typeof s === 'object') &&
            typeof (s as { id?: unknown }).id === 'string' &&
            typeof (s as { correctOptionId?: unknown }).correctOptionId === 'string' &&
            Boolean((s as { correctOptionId: string }).correctOptionId.trim())
        )
      );
    default:
      return false;
  }
}

function normalizeColumnHeaderKey(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const TABULAR_COLUMN_ALIASES: Record<string, string[]> = {
  id: ['id', 'macauhoi', 'questionid'],
  module: ['module', 'modun', 'machuongtrinh', 'chuongtrinh'],
  level: ['level', 'capdo', 'trinhdo'],
  category: ['category', 'nhom', 'nhomkienthuc', 'manhom'],
  contentCode: ['contentcode', 'maphan', 'phankienthuc', 'maphankienthuc'],
  topicOrder: ['topicorder', 'thutu', 'sothutu', 'stt', 'thutucau'],
  topic: ['topic', 'chude', 'chuyende'],
  type: ['type', 'dangcauhoi', 'loaicauhoi', 'loai', 'questiontype'],
  prompt: ['prompt', 'cauhoi', 'noidungcauhoi', 'noidung', 'debai'],
  instruction: ['instruction', 'huongdan', 'huongdanlambai'],
  payloadJson: ['payloadjson', 'payload'],
  options: ['options', 'cacluachon', 'luachon', 'phuongan', 'cacphuongan'],
  optionA: ['optiona', 'dapana', 'phuongana', 'luachona'],
  optionB: ['optionb', 'dapanb', 'phuonganb', 'luachonb'],
  optionC: ['optionc', 'dapanc', 'phuonganc', 'luachonc'],
  optionD: ['optiond', 'dapand', 'phuongand', 'luachond'],
  optionE: ['optione', 'dapane', 'phuongane', 'luachone'],
  optionF: ['optionf', 'dapanf', 'phuonganf', 'luachonf'],
  correctAnswer: ['correctanswer', 'dapandung', 'dapan', 'ketquadung'],
  matchingLeft: ['matchingleft', 'cota', 'traicota', 'vea'],
  matchingRight: ['matchingright', 'cotb', 'phaicotb', 'veb'],
  imageUrl: ['imageurl', 'hinhanh', 'anhminhhoa', 'image'],
  imageAlt: ['imagealt', 'motaanh', 'alt'],
  explanation: ['explanation', 'giaithich'],
  tips: ['tips', 'goiy', 'meo'],
};

function normalizeImportedQuestionType(rawTypeInput: unknown): QuestionType | null {
  const raw = String(rawTypeInput ?? '').trim();
  if (!raw) return 'single';
  if (VALID_QUESTION_TYPES.has(raw as QuestionType)) {
    return raw as QuestionType;
  }
  const key = normalizeColumnHeaderKey(raw);
  if (
    key === 'single' ||
    key === '1dapan' ||
    key === 'motdapan' ||
    key === 'tracnghiem' ||
    key === '1luachon' ||
    key === 'sc'
  ) {
    return 'single';
  }
  if (
    key === 'multiple' ||
    key === 'nhieudapan' ||
    key === 'nhieuluachon' ||
    key === 'tracnghiemnhieudapan' ||
    key === 'mc'
  ) {
    return 'multiple';
  }
  if (
    key === 'truefalse' ||
    key === 'dungsai' ||
    key === 'dungsaitungy' ||
    key === 'tf'
  ) {
    return 'true_false';
  }
  if (
    key === 'matching' ||
    key === 'ghepnoi' ||
    key === 'noicot' ||
    key === 'ghepnoicotab'
  ) {
    return 'matching';
  }
  if (
    key === 'hotspot' ||
    key === 'chondiem' ||
    key === 'chondiemtrenhinh' ||
    key === 'khoanhvung'
  ) {
    return 'hotspot';
  }
  if (
    key === 'matrixchoice' ||
    key === 'matrix' ||
    key === 'dienkhuyet' ||
    key === 'dienkhuyetbangchon' ||
    key === 'bangchon' ||
    key === 'dropdownmatrix'
  ) {
    return 'matrix_choice';
  }
  return null;
}

function normalizeImportedModuleCode(
  rawModuleInput: unknown,
  rawLevelInput?: unknown
): IC3Module {
  const raw = String(rawModuleInput ?? '').trim();
  if (raw) {
    const key = normalizeColumnHeaderKey(raw);
    if (key === 'computingfundamentals' || key === 'cf' || key === 'maytinhcanban') {
      return 'computing_fundamentals';
    }
    if (key === 'keyapplications' || key === 'ka' || key === 'ungdungchuchot') {
      return 'key_applications';
    }
    if (key === 'livingonline' || key === 'lo' || key === 'cuocsongtructuyen') {
      return 'living_online';
    }
    if (key === 'ailiteracy' || key === 'ai') {
      return 'ai_literacy';
    }
    return raw as IC3Module;
  }
  const lvl = String(rawLevelInput ?? '').trim().toUpperCase();
  if (lvl === 'LV2') return 'key_applications';
  if (lvl === 'LV3') return 'living_online';
  return 'computing_fundamentals';
}

function buildSimpleTabularPayload(
  type: QuestionType,
  optionsRaw: string,
  answerRaw: string,
  matchingLeftRaw?: string,
  matchingRightRaw?: string
): QuestionPayload | null {
  const splitTokens = (val: string) =>
    val
      .split(/\r?\n|\|/)
      .map((s) => s.trim())
      .filter(Boolean);

  if (type === 'matching') {
    const leftTokens = splitTokens(matchingLeftRaw ?? '');
    const rightTokens = splitTokens(matchingRightRaw ?? '');
    if (leftTokens.length >= 1 && rightTokens.length >= 1) {
      const matchingLeft = leftTokens.map((text, idx) => ({
        id: `l${idx + 1}`,
        text,
      }));
      const matchingRight = rightTokens.map((text, idx) => ({
        id: `r${idx + 1}`,
        text,
      }));
      const pairTokens = answerRaw
        .split(/[;,|]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const correctPairs: Array<{ leftId: string; rightId: string }> = [];
      if (pairTokens.length > 0) {
        for (const tok of pairTokens) {
          const m = tok.match(/^([a-z0-9]+)\s*[-:=→>]+\s*([a-z0-9]+)$/i);
          if (m) {
            const leftNum = Number(m[1].replace(/^l/i, ''));
            const rightNum = Number(m[2].replace(/^r/i, ''));
            const leftItem = Number.isFinite(leftNum) && leftNum >= 1 ? matchingLeft[leftNum - 1] : undefined;
            const rightItem = Number.isFinite(rightNum) && rightNum >= 1 ? matchingRight[rightNum - 1] : undefined;
            if (leftItem && rightItem) {
              correctPairs.push({ leftId: leftItem.id, rightId: rightItem.id });
            }
          }
        }
      } else if (matchingLeft.length === matchingRight.length) {
        matchingLeft.forEach((l, idx) => {
          correctPairs.push({ leftId: l.id, rightId: matchingRight[idx].id });
        });
      }
      if (correctPairs.length >= 1) {
        return { matchingLeft, matchingRight, correctPairs };
      }
    }

    const pairLines = splitTokens(optionsRaw);
    if (pairLines.length >= 1) {
      const matchingLeft: Array<{ id: string; text: string }> = [];
      const matchingRight: Array<{ id: string; text: string }> = [];
      const correctPairs: Array<{ leftId: string; rightId: string }> = [];
      pairLines.forEach((line, idx) => {
        const parts = line.split(/\s*(?:->|=>|::)\s*/);
        if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
          const leftId = `l${idx + 1}`;
          const rightId = `r${idx + 1}`;
          matchingLeft.push({ id: leftId, text: parts[0].trim() });
          matchingRight.push({ id: rightId, text: parts.slice(1).join(' -> ').trim() });
          correctPairs.push({ leftId, rightId });
        }
      });
      if (matchingLeft.length >= 1) {
        return { matchingLeft, matchingRight, correctPairs };
      }
    }
    return null;
  }

  const parts = splitTokens(optionsRaw);
  if (type === 'single' && parts.length >= 2) {
    const options = parts.map((text, idx) => ({
      id: String.fromCharCode(97 + idx),
      text,
    }));
    const ansClean = answerRaw.trim();
    const byLetter = options.find(
      (o, i) =>
        o.id.toLowerCase() === ansClean.toLowerCase() ||
        String(i + 1) === ansClean
    );
    const byText = options.find(
      (o) => o.text.toLowerCase() === ansClean.toLowerCase()
    );
    const correctOptionId = (byLetter ?? byText ?? options[0]).id;
    return { options, correctOptionId };
  }
  if (type === 'multiple' && parts.length >= 2) {
    const options = parts.map((text, idx) => ({
      id: String.fromCharCode(97 + idx),
      text,
    }));
    const tokens = answerRaw
      .split(/[;,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const selectedIds = tokens
      .map((tok) => {
        const idxMatch = options.findIndex(
          (o, i) =>
            o.id.toLowerCase() === tok.toLowerCase() ||
            String(i + 1) === tok ||
            o.text.toLowerCase() === tok.toLowerCase()
        );
        return idxMatch >= 0 ? options[idxMatch].id : '';
      })
      .filter(Boolean);
    if (selectedIds.length === 0) return null;
    return { options, correctOptionIds: Array.from(new Set(selectedIds)) };
  }
  if (type === 'true_false' && parts.length >= 1) {
    const boolTokens = answerRaw
      .split(/[;,|]/)
      .map((s) => s.trim().toLowerCase());
    const statements = parts.map((text, idx) => {
      const tok = boolTokens[idx] ?? 'true';
      const isTrue =
        tok === 'true' ||
        tok === '1' ||
        tok === 'đúng' ||
        tok === 'dung' ||
        tok === 't' ||
        tok === 'd';
      return { id: `s${idx + 1}`, text, isTrue };
    });
    return { statements };
  }
  return null;
}

function normalizeImportedQuestion(
  raw: Record<string, unknown>,
  index: number,
  errors: string[],
  warnings: string[]
): Question | null {
  const rowLabel = `Dòng câu ${index + 1}`;
  const rawType = normalizeImportedQuestionType(raw.type);
  if (!rawType) {
    errors.push(
      `${rowLabel}: Dạng câu hỏi "${String(raw.type ?? '')}" không hợp lệ (hỗ trợ single, multiple, true_false, matching, matrix_choice, hotspot hoặc tên tiếng Việt tương ứng).`
    );
    return null;
  }

  const prompt = String(raw.prompt ?? '').trim();
  if (!prompt) {
    errors.push(`${rowLabel}: Thiếu nội dung câu hỏi (prompt).`);
    return null;
  }

  const mod = normalizeImportedModuleCode(raw.module, raw.level);
  const level = (
    String(raw.level ?? defaultLevelForModule(mod)).trim().toUpperCase() ||
    defaultLevelForModule(mod)
  ) as IC3Level;
  const category = (
    String(raw.category ?? 'GM').trim().toUpperCase() || 'GM'
  ) as KnowledgeCategory;
  const contentCode =
    String(raw.contentCode ?? raw.content_code ?? `${category}1`)
      .trim()
      .toUpperCase() || `${category}1`;
  const parsedOrder = Number(raw.topicOrder ?? raw.topic_order ?? index + 1);
  const topicOrder =
    Number.isFinite(parsedOrder) && parsedOrder >= 1
      ? Math.round(parsedOrder)
      : index + 1;
  const topic =
    String(raw.topic ?? '').trim() || `Chuyên đề ${contentCode}`;

  let payload: unknown = raw.payload;
  if (!payload && typeof raw.payloadJson === 'string' && raw.payloadJson.trim()) {
    try {
      payload = JSON.parse(raw.payloadJson);
    } catch {
      errors.push(`${rowLabel}: payloadJson không đúng định dạng JSON.`);
      return null;
    }
  }
  if (!payload) {
    const combinedOptions =
      typeof raw.options === 'string' && raw.options.trim()
        ? raw.options
        : [
            raw.optionA,
            raw.optionB,
            raw.optionC,
            raw.optionD,
            raw.optionE,
            raw.optionF,
          ]
            .map((v) => String(v ?? '').trim())
            .filter(Boolean)
            .join('|');
    const answerText = String(raw.correctAnswer ?? '');
    const leftText = String(raw.matchingLeft ?? '');
    const rightText = String(raw.matchingRight ?? '');
    if (combinedOptions || (leftText && rightText)) {
      payload = buildSimpleTabularPayload(
        rawType,
        combinedOptions,
        answerText,
        leftText,
        rightText
      );
    }
  }

  if (!isValidPayloadForType(rawType, payload)) {
    errors.push(
      `${rowLabel}: Dữ liệu lựa chọn/đáp án không hợp lệ cho dạng "${rawType}".`
    );
    return null;
  }

  const optionalImageUrl = String(raw.imageUrl ?? raw.image_url ?? '').trim();
  const optionalImageAlt = String(raw.imageAlt ?? raw.image_alt ?? '').trim();
  const normalizedPayload =
    rawType !== 'hotspot' &&
    optionalImageUrl &&
    payload &&
    typeof payload === 'object' &&
    !('imageUrl' in (payload as Record<string, unknown>))
      ? ({
          ...(payload as Record<string, unknown>),
          imageUrl: optionalImageUrl,
          ...(optionalImageAlt ? { imageAlt: optionalImageAlt } : {}),
        } as QuestionPayload)
      : (payload as QuestionPayload);

  const rawId = String(raw.id ?? '').trim();
  const id =
    rawId ||
    `q_imp_${slugKey(`${mod}_${contentCode}`) || 'ic3'}_${index + 1}_${Math.abs(
      prompt.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7)
    ).toString(36)}`;
  if (!rawId) {
    warnings.push(`${rowLabel}: Chưa có id, hệ thống đã tự tạo mã "${id}".`);
  }

  const now = new Date().toISOString();
  return {
    id,
    module: mod,
    level,
    category,
    contentCode,
    topicOrder,
    topic,
    type: rawType,
    prompt,
    instruction:
      typeof raw.instruction === 'string' && raw.instruction.trim()
        ? raw.instruction.trim()
        : getDefaultInstructionForQuestionType(rawType),
    payload: normalizedPayload,
    explanation: String(raw.explanation ?? '').trim(),
    tips:
      typeof raw.tips === 'string' && raw.tips.trim()
        ? raw.tips.trim()
        : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? now),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? now),
  };
}

function mapTabularRowsToObjects(
  rows: unknown[][],
  sourceLabel: string
): {
  headerIndexMap: Map<string, number>;
  records: Record<string, unknown>[];
  error?: string;
} {
  const nonEmptyRows = rows.filter((r) =>
    r.some((c) => String(c ?? '').trim().length > 0)
  );
  if (nonEmptyRows.length < 2) {
    return {
      headerIndexMap: new Map(),
      records: [],
      error: `${sourceLabel} cần có ít nhất 1 dòng tiêu đề và 1 dòng câu hỏi.`,
    };
  }
  const headers = nonEmptyRows[0].map((h) =>
    normalizeColumnHeaderKey(String(h ?? '').trim())
  );
  const idxMap = new Map<string, number>();
  headers.forEach((h, idx) => {
    if (h && !idxMap.has(h)) idxMap.set(h, idx);
  });

  const findIndex = (canonical: string): number | undefined => {
    const aliases = TABULAR_COLUMN_ALIASES[canonical] ?? [canonical.toLowerCase()];
    for (const alias of aliases) {
      const idx = idxMap.get(alias);
      if (idx !== undefined) return idx;
    }
    return undefined;
  };

  if (findIndex('prompt') === undefined) {
    return {
      headerIndexMap: idxMap,
      records: [],
      error: `${sourceLabel} thiếu cột nội dung câu hỏi ("prompt" hoặc "Nội dung câu hỏi"). Hãy tải file Excel/CSV mẫu để xem cấu trúc chuẩn.`,
    };
  }

  const records: Record<string, unknown>[] = [];
  for (let r = 1; r < nonEmptyRows.length; r += 1) {
    const cols = nonEmptyRows[r];
    const getCol = (canonical: string) => {
      const idx = findIndex(canonical);
      return idx !== undefined ? String(cols[idx] ?? '').trim() : '';
    };
    records.push({
      id: getCol('id'),
      module: getCol('module'),
      level: getCol('level'),
      category: getCol('category'),
      contentCode: getCol('contentCode'),
      topicOrder: getCol('topicOrder'),
      topic: getCol('topic'),
      type: getCol('type') || 'single',
      prompt: getCol('prompt'),
      instruction: getCol('instruction'),
      payloadJson: getCol('payloadJson'),
      options: getCol('options'),
      optionA: getCol('optionA'),
      optionB: getCol('optionB'),
      optionC: getCol('optionC'),
      optionD: getCol('optionD'),
      optionE: getCol('optionE'),
      optionF: getCol('optionF'),
      correctAnswer: getCol('correctAnswer'),
      matchingLeft: getCol('matchingLeft'),
      matchingRight: getCol('matchingRight'),
      imageUrl: getCol('imageUrl'),
      imageAlt: getCol('imageAlt'),
      explanation: getCol('explanation'),
      tips: getCol('tips'),
    });
  }

  return { headerIndexMap: idxMap, records };
}

function finalizeQuestionBankBundle(
  rawModules: Record<string, unknown>[],
  rawCategories: Record<string, unknown>[],
  rawParts: Record<string, unknown>[],
  rawQuestions: Record<string, unknown>[],
  rawSets: Record<string, unknown>[],
  errors: string[],
  warnings: string[]
): {
  bundle: QuestionBankImportBundle;
  warnings: string[];
  errors: string[];
} {
  const questions: Question[] = [];
  rawQuestions.forEach((rq, idx) => {
    const normalized = normalizeImportedQuestion(rq, idx, errors, warnings);
    if (normalized) questions.push(normalized);
  });

  const modulesInput: IC3ModuleRecord[] = rawModules
    .filter((m) => String(m.code ?? '').trim().length > 0)
    .map((m, idx) => {
      const code = String(m.code).trim();
      const level = (
        String(m.level ?? defaultLevelForModule(code)).trim().toUpperCase() ||
        defaultLevelForModule(code)
      ) as IC3Level;
      return {
        id: String(m.id ?? `mod_${slugKey(code)}`),
        code,
        level,
        title: String(m.title ?? MODULE_LABELS[code] ?? `${level} — ${code}`).trim(),
        description: String(m.description ?? ''),
        orderIndex: Number(m.orderIndex ?? m.order_index ?? idx + 1) || idx + 1,
      };
    });

  const categoriesInput: KnowledgeCategoryRecord[] = rawCategories
    .filter(
      (c) =>
        String(c.module ?? '').trim().length > 0 &&
        String(c.code ?? '').trim().length > 0
    )
    .map((c, idx) => {
      const mod = String(c.module).trim();
      const code = String(c.code).trim().toUpperCase();
      const rawEnabled = c.isEnabled ?? c.is_enabled;
      return {
        id: String(c.id ?? `cat_${slugKey(`${mod}_${code}`)}`),
        module: mod,
        code,
        title: String(c.title ?? CATEGORY_LABELS[code]?.name ?? `Nhóm ${code}`).trim(),
        description: String(c.description ?? ''),
        orderIndex: Number(c.orderIndex ?? c.order_index ?? idx + 1) || idx + 1,
        isEnabled:
          rawEnabled === undefined || rawEnabled === null
            ? true
            : Boolean(rawEnabled),
      };
    });

  const partsInput: KnowledgePart[] = rawParts
    .filter(
      (p) =>
        String(p.module ?? '').trim().length > 0 &&
        String(p.category ?? '').trim().length > 0 &&
        String(p.code ?? '').trim().length > 0
    )
    .map((p, idx) => {
      const mod = String(p.module).trim();
      const category = String(p.category).trim().toUpperCase();
      const code = String(p.code).trim().toUpperCase();
      const level = String(p.level ?? defaultLevelForModule(mod))
        .trim()
        .toUpperCase();
      const rawEnabled = p.isEnabled ?? p.is_enabled;
      return {
        id: String(p.id ?? `part_${slugKey(`${mod}_${category}_${code}`)}`),
        module: mod,
        level,
        category,
        code,
        title: String(p.title ?? `Phần ${code}`).trim(),
        description: String(p.description ?? ''),
        orderIndex: Number(p.orderIndex ?? p.order_index ?? idx + 1) || idx + 1,
        isEnabled:
          rawEnabled === undefined || rawEnabled === null
            ? true
            : Boolean(rawEnabled),
      };
    });

  const now = new Date().toISOString();
  const questionSetsInput: QuestionSet[] = rawSets
    .filter((s) => String(s.title ?? '').trim().length > 0)
    .map((s, idx) => {
      const rawQIds = s.questionIds ?? s.question_ids;
      const questionIds = Array.isArray(rawQIds)
        ? rawQIds.filter((id): id is string => typeof id === 'string')
        : typeof rawQIds === 'string'
          ? rawQIds
              .split(/[;,|]/)
              .map((x) => x.trim())
              .filter(Boolean)
          : [];
      return {
        id: String(s.id ?? `set_imp_${idx + 1}`),
        title: String(s.title).trim(),
        description: String(s.description ?? ''),
        level: typeof s.level === 'string' && s.level.trim() ? s.level.trim() : undefined,
        category:
          typeof s.category === 'string' && s.category.trim()
            ? s.category.trim()
            : undefined,
        contentCode:
          typeof s.contentCode === 'string' && s.contentCode.trim()
            ? s.contentCode.trim()
            : typeof s.content_code === 'string' && s.content_code.trim()
              ? s.content_code.trim()
              : undefined,
        questionIds,
        createdAt: String(s.createdAt ?? s.created_at ?? now),
        updatedAt: String(s.updatedAt ?? s.updated_at ?? now),
      };
    });

  const synthesized = buildQuestionBankSupabasePayload({
    modules: modulesInput,
    knowledgeCategories: categoriesInput,
    knowledgeParts: partsInput,
    questions,
    questionSets: questionSetsInput,
  });

  return {
    bundle: {
      modules: synthesized.modules.map((m) => ({
        id: m.id,
        code: m.code,
        level: m.level,
        title: m.title,
        description: m.description,
        orderIndex: m.order_index,
      })),
      knowledgeCategories: synthesized.categories.map((c) => ({
        id: c.id,
        module: c.module,
        code: c.code,
        title: c.title,
        description: c.description,
        orderIndex: c.order_index,
        isEnabled: c.is_enabled,
      })),
      knowledgeParts: synthesized.parts.map((p) => ({
        id: p.id,
        module: p.module,
        level: p.level,
        category: p.category,
        code: p.code,
        title: p.title,
        description: p.description,
        orderIndex: p.order_index,
        isEnabled: p.is_enabled,
      })),
      questions,
      questionSets: questionSetsInput,
    },
    warnings,
    errors,
  };
}

export function parseQuestionBankTabularRows(
  rows: unknown[][],
  options?: {
    sourceLabel?: string;
    questionSetRows?: unknown[][];
    defaultContext?: {
      module?: IC3Module;
      level?: IC3Level;
      category?: KnowledgeCategory;
      contentCode?: string;
    };
  }
): {
  bundle: QuestionBankImportBundle;
  warnings: string[];
  errors: string[];
} {
  const emptyBundle: QuestionBankImportBundle = {
    modules: [],
    knowledgeCategories: [],
    knowledgeParts: [],
    questions: [],
    questionSets: [],
  };
  const warnings: string[] = [];
  const errors: string[] = [];
  const sourceLabel = options?.sourceLabel ?? 'Bảng dữ liệu';

  const mapped = mapTabularRowsToObjects(rows, sourceLabel);
  if (mapped.error) {
    errors.push(mapped.error);
    return { bundle: emptyBundle, warnings, errors };
  }

  const rawQuestions = mapped.records.map((rec) => ({
    ...rec,
    module: rec.module || options?.defaultContext?.module || '',
    level: rec.level || options?.defaultContext?.level || '',
    category: rec.category || options?.defaultContext?.category || 'GM',
    contentCode:
      rec.contentCode || options?.defaultContext?.contentCode || '',
  }));

  let rawSets: Record<string, unknown>[] = [];
  if (options?.questionSetRows && options.questionSetRows.length >= 2) {
    const setRows = options.questionSetRows.filter((r) =>
      r.some((c) => String(c ?? '').trim().length > 0)
    );
    if (setRows.length >= 2) {
      const setHeaders = setRows[0].map((h) =>
        normalizeColumnHeaderKey(String(h ?? '').trim())
      );
      const sMap = new Map<string, number>();
      setHeaders.forEach((h, i) => {
        if (h && !sMap.has(h)) sMap.set(h, i);
      });
      const getS = (cols: unknown[], key: string) => {
        const idx = sMap.get(key);
        return idx !== undefined ? String(cols[idx] ?? '').trim() : '';
      };
      for (let i = 1; i < setRows.length; i += 1) {
        const cols = setRows[i];
        const title = getS(cols, 'title') || getS(cols, 'tenbode');
        if (!title) continue;
        rawSets.push({
          id: getS(cols, 'id') || undefined,
          title,
          description: getS(cols, 'description') || getS(cols, 'mota'),
          level: getS(cols, 'level') || getS(cols, 'capdo'),
          category: getS(cols, 'category') || getS(cols, 'nhom'),
          contentCode: getS(cols, 'contentcode') || getS(cols, 'maphan'),
          questionIds: getS(cols, 'questionids') || getS(cols, 'danhsachcauhoi'),
        });
      }
    }
  }

  return finalizeQuestionBankBundle(
    [],
    [],
    [],
    rawQuestions,
    rawSets,
    errors,
    warnings
  );
}

export function parseQuestionBankImportInput(
  rawText: string,
  fileName?: string
): {
  bundle: QuestionBankImportBundle;
  warnings: string[];
  errors: string[];
} {
  const trimmed = rawText.replace(/^\uFEFF/, '').trim();
  const emptyBundle: QuestionBankImportBundle = {
    modules: [],
    knowledgeCategories: [],
    knowledgeParts: [],
    questions: [],
    questionSets: [],
  };

  if (!trimmed) {
    return {
      bundle: emptyBundle,
      warnings: [],
      errors: ['Nội dung nhập đang trống. Vui lòng chọn file Excel/JSON/CSV hoặc dán dữ liệu.'],
    };
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const looksLikeJson =
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    (fileName ? fileName.toLowerCase().endsWith('.json') : false);

  let rawModules: Record<string, unknown>[] = [];
  let rawCategories: Record<string, unknown>[] = [];
  let rawParts: Record<string, unknown>[] = [];
  let rawQuestions: Record<string, unknown>[] = [];
  let rawSets: Record<string, unknown>[] = [];

  if (looksLikeJson) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        rawQuestions = parsed.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item && typeof item === 'object')
        );
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.modules)) rawModules = obj.modules;
        if (Array.isArray(obj.knowledgeCategories)) {
          rawCategories = obj.knowledgeCategories;
        }
        if (Array.isArray(obj.knowledgeParts)) rawParts = obj.knowledgeParts;
        if (Array.isArray(obj.questions)) rawQuestions = obj.questions;
        if (Array.isArray(obj.questionSets)) rawSets = obj.questionSets;
      } else {
        errors.push('File JSON phải là đối tượng ngân hàng câu hỏi hoặc mảng câu hỏi.');
      }
    } catch {
      errors.push('Nội dung JSON không hợp lệ (lỗi cú pháp JSON).');
      return { bundle: emptyBundle, warnings, errors };
    }
    return finalizeQuestionBankBundle(
      rawModules,
      rawCategories,
      rawParts,
      rawQuestions,
      rawSets,
      errors,
      warnings
    );
  }

  const csvRows = parseRfc4180CsvRows(trimmed);
  return parseQuestionBankTabularRows(csvRows, { sourceLabel: 'File CSV' });
}

export function mergeQuestionBankImport(
  current: Partial<QuestionBankImportBundle>,
  imported: QuestionBankImportBundle,
  mode: 'merge' | 'replace'
): QuestionBankImportBundle {
  if (mode === 'replace') {
    const normalized = buildQuestionBankSupabasePayload({
      modules: imported.modules,
      knowledgeCategories: imported.knowledgeCategories,
      knowledgeParts: imported.knowledgeParts,
      questions: imported.questions,
      questionSets: imported.questionSets,
    });
    return {
      modules: normalized.modules.map((m) => ({
        id: m.id,
        code: m.code,
        level: m.level,
        title: m.title,
        description: m.description,
        orderIndex: m.order_index,
      })),
      knowledgeCategories: normalized.categories.map((c) => ({
        id: c.id,
        module: c.module,
        code: c.code,
        title: c.title,
        description: c.description,
        orderIndex: c.order_index,
        isEnabled: c.is_enabled,
      })),
      knowledgeParts: normalized.parts.map((p) => ({
        id: p.id,
        module: p.module,
        level: p.level,
        category: p.category,
        code: p.code,
        title: p.title,
        description: p.description,
        orderIndex: p.order_index,
        isEnabled: p.is_enabled,
      })),
      questions: imported.questions,
      questionSets: imported.questionSets,
    };
  }

  const modMap = new Map<string, IC3ModuleRecord>();
  for (const m of current.modules ?? []) modMap.set(m.code, m);
  for (const m of imported.modules) {
    const prev = modMap.get(m.code);
    modMap.set(m.code, prev ? { ...m, id: prev.id } : m);
  }

  const catMap = new Map<string, KnowledgeCategoryRecord>();
  for (const c of current.knowledgeCategories ?? []) {
    catMap.set(`${c.module}::${c.code.toUpperCase()}`, c);
  }
  for (const c of imported.knowledgeCategories) {
    const key = `${c.module}::${c.code.toUpperCase()}`;
    const prev = catMap.get(key);
    catMap.set(key, prev ? { ...c, id: prev.id } : c);
  }

  const partMap = new Map<string, KnowledgePart>();
  for (const p of current.knowledgeParts ?? []) {
    partMap.set(
      `${p.module}::${p.category.toUpperCase()}::${p.code.toUpperCase()}`,
      p
    );
  }
  for (const p of imported.knowledgeParts) {
    const key = `${p.module}::${p.category.toUpperCase()}::${p.code.toUpperCase()}`;
    const prev = partMap.get(key);
    partMap.set(key, prev ? { ...p, id: prev.id } : p);
  }

  const qMap = new Map<string, Question>();
  for (const q of current.questions ?? []) qMap.set(q.id, q);
  for (const q of imported.questions) qMap.set(q.id, q);

  const setMap = new Map<string, QuestionSet>();
  for (const s of current.questionSets ?? []) setMap.set(s.id, s);
  for (const s of imported.questionSets) setMap.set(s.id, s);

  const mergedQuestions = Array.from(qMap.values());
  const mergedSets = Array.from(setMap.values());
  const normalized = buildQuestionBankSupabasePayload({
    modules: Array.from(modMap.values()),
    knowledgeCategories: Array.from(catMap.values()),
    knowledgeParts: Array.from(partMap.values()),
    questions: mergedQuestions,
    questionSets: mergedSets,
  });

  return {
    modules: normalized.modules.map((m) => ({
      id: m.id,
      code: m.code,
      level: m.level,
      title: m.title,
      description: m.description,
      orderIndex: m.order_index,
    })),
    knowledgeCategories: normalized.categories.map((c) => ({
      id: c.id,
      module: c.module,
      code: c.code,
      title: c.title,
      description: c.description,
      orderIndex: c.order_index,
      isEnabled: c.is_enabled,
    })),
    knowledgeParts: normalized.parts.map((p) => ({
      id: p.id,
      module: p.module,
      level: p.level,
      category: p.category,
      code: p.code,
      title: p.title,
      description: p.description,
      orderIndex: p.order_index,
      isEnabled: p.is_enabled,
    })),
    questions: mergedQuestions,
    questionSets: mergedSets,
  };
}

export function isKnowledgeCategoryEnabled(
  cat?: { isEnabled?: boolean | null } | null
): boolean {
  return cat?.isEnabled !== false;
}

export function summarizeKnowledgeCategoryReadiness(
  categories: Array<{ isEnabled?: boolean | null }>
): {
  total: number;
  enabledCount: number;
  disabledCount: number;
} {
  let enabledCount = 0;
  let disabledCount = 0;
  for (const cat of categories) {
    if (isKnowledgeCategoryEnabled(cat)) {
      enabledCount += 1;
    } else {
      disabledCount += 1;
    }
  }
  return {
    total: categories.length,
    enabledCount,
    disabledCount,
  };
}

export function filterKnowledgeCategoriesByReadiness<
  T extends {
    isEnabled?: boolean | null;
    code: string;
    title: string;
    description?: string;
  }
>(
  categories: T[],
  statusFilter: 'all' | 'enabled' | 'disabled',
  query = ''
): T[] {
  const cleanQuery = query.trim().toLowerCase();
  return categories.filter((cat) => {
    const enabled = isKnowledgeCategoryEnabled(cat);
    if (statusFilter === 'enabled' && !enabled) return false;
    if (statusFilter === 'disabled' && enabled) return false;
    if (cleanQuery) {
      const hay = `${cat.code} ${cat.title} ${cat.description ?? ''}`.toLowerCase();
      if (!hay.includes(cleanQuery)) return false;
    }
    return true;
  });
}

export function isKnowledgePartEnabled(
  part?: { isEnabled?: boolean | null } | null
): boolean {
  return part?.isEnabled !== false;
}

export function summarizeKnowledgePartReadiness(
  parts: Array<{ isEnabled?: boolean | null }>
): {
  total: number;
  enabledCount: number;
  disabledCount: number;
} {
  return summarizeKnowledgeCategoryReadiness(parts);
}

export function filterKnowledgePartsByReadiness<
  T extends {
    isEnabled?: boolean | null;
    code: string;
    title: string;
    description?: string;
  }
>(
  parts: T[],
  statusFilter: 'all' | 'enabled' | 'disabled',
  query = ''
): T[] {
  return filterKnowledgeCategoriesByReadiness(parts, statusFilter, query);
}

export function canBatchToggleKnowledgeParts(
  parts: Array<{ isEnabled?: boolean | null }>
): {
  canEnableAll: boolean;
  canDisableAll: boolean;
  partsToEnableCount: number;
  partsToDisableCount: number;
} {
  const { enabledCount, disabledCount } = summarizeKnowledgePartReadiness(parts);
  return {
    canEnableAll: disabledCount > 0,
    canDisableAll: enabledCount > 0,
    partsToEnableCount: disabledCount,
    partsToDisableCount: enabledCount,
  };
}



