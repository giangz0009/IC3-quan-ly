import * as XLSX from 'xlsx';
import type {
  IC3Level,
  IC3Module,
  KnowledgeCategory,
  Question,
  SchoolClass,
  StudentProfile,
} from '../types/ic3';
import {
  normalizeVietnamesePassword,
  parseClassesTabularRows,
  parseQuestionBankTabularRows,
  parseStudentsTabularRows,
  type ParsedClassRow,
  type ParsedStudentRow,
  type QuestionBankExportPackage,
  type QuestionBankImportBundle,
} from './ic3Rules';

export interface ParsedExcelWorkbookData {
  sheetNames: string[];
  activeSheetName: string;
  sheets: Record<string, unknown[][]>;
  questionSetRows?: unknown[][];
}

function normalizeSheetKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const GUIDE_SHEET_KEYS = new Set(['huongdan', 'guide', 'instructions', 'readme']);
const SET_SHEET_KEYS = new Set(['bode', 'questionsets', 'sets']);

export function readExcelWorkbookBuffer(
  buffer: ArrayBuffer | Uint8Array
): ParsedExcelWorkbookData {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wb = XLSX.read(bytes, { type: 'array' });

  const sheets: Record<string, unknown[][]> = {};
  const questionSheetCandidates: string[] = [];
  let questionSetRows: unknown[][] | undefined;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    const key = normalizeSheetKey(name);
    if (SET_SHEET_KEYS.has(key)) {
      questionSetRows = rows;
      continue;
    }
    sheets[name] = rows;
    if (!GUIDE_SHEET_KEYS.has(key)) {
      questionSheetCandidates.push(name);
    }
  }

  const sheetNames =
    questionSheetCandidates.length > 0
      ? questionSheetCandidates
      : Object.keys(sheets);

  const preferred = sheetNames.find((n) => {
    const k = normalizeSheetKey(n);
    return k === 'cauhoi' || k === 'questions' || k === 'sheet1';
  });

  return {
    sheetNames,
    activeSheetName: preferred ?? sheetNames[0] ?? '',
    sheets,
    questionSetRows,
  };
}

export function parseQuestionBankExcelSheet(
  workbook: ParsedExcelWorkbookData,
  sheetName?: string,
  defaultContext?: {
    module?: IC3Module;
    level?: IC3Level;
    category?: KnowledgeCategory;
    contentCode?: string;
  }
): {
  bundle: QuestionBankImportBundle;
  warnings: string[];
  errors: string[];
} {
  const targetSheet = sheetName || workbook.activeSheetName;
  const rows = targetSheet ? workbook.sheets[targetSheet] ?? [] : [];
  if (!targetSheet || rows.length === 0) {
    return {
      bundle: {
        modules: [],
        knowledgeCategories: [],
        knowledgeParts: [],
        questions: [],
        questionSets: [],
      },
      warnings: [],
      errors: ['Tệp Excel không có sheet dữ liệu câu hỏi hợp lệ.'],
    };
  }
  return parseQuestionBankTabularRows(rows, {
    sourceLabel: `Sheet "${targetSheet}"`,
    questionSetRows: workbook.questionSetRows,
    defaultContext,
  });
}

function questionToExcelRow(q: Question): Record<string, string | number> {
  const row: Record<string, string | number> = {
    id: q.id,
    module: q.module,
    level: q.level,
    category: q.category,
    contentCode: q.contentCode,
    topicOrder: q.topicOrder,
    topic: q.topic,
    type: q.type,
    prompt: q.prompt,
    instruction: q.instruction ?? '',
    optionA: '',
    optionB: '',
    optionC: '',
    optionD: '',
    optionE: '',
    optionF: '',
    matchingLeft: '',
    matchingRight: '',
    correctAnswer: '',
    payloadJson: '',
    explanation: q.explanation ?? '',
    tips: q.tips ?? '',
  };

  const p = q.payload as Record<string, unknown>;
  const hasOptionalImage =
    q.type !== 'hotspot' && typeof p.imageUrl === 'string' && p.imageUrl.trim().length > 0;

  if (!hasOptionalImage && q.type === 'single' && Array.isArray(p.options)) {
    const opts = p.options as Array<{ id: string; text: string }>;
    if (opts.length <= 6) {
      const keys = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'] as const;
      opts.forEach((opt, i) => {
        row[keys[i]] = opt.text;
      });
      const correctIdx = opts.findIndex((o) => o.id === p.correctOptionId);
      row.correctAnswer =
        correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : String(p.correctOptionId ?? '');
      // Keep payloadJson blank when representable cleanly in optionA..optionF so edits in Excel take effect immediately
      return row;
    }
  } else if (!hasOptionalImage && q.type === 'multiple' && Array.isArray(p.options)) {
    const opts = p.options as Array<{ id: string; text: string }>;
    const correctIds = Array.isArray(p.correctOptionIds)
      ? (p.correctOptionIds as string[])
      : [];
    if (opts.length <= 6) {
      const keys = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'] as const;
      opts.forEach((opt, i) => {
        row[keys[i]] = opt.text;
      });
      row.correctAnswer = correctIds
        .map((cid) => {
          const idx = opts.findIndex((o) => o.id === cid);
          return idx >= 0 ? String.fromCharCode(65 + idx) : cid;
        })
        .join(', ');
      return row;
    }
  } else if (!hasOptionalImage && q.type === 'true_false' && Array.isArray(p.statements)) {
    const stmts = p.statements as Array<{
      id: string;
      text: string;
      isTrue: boolean;
      explanation?: string;
    }>;
    if (stmts.length <= 6 && stmts.every((s) => !s.explanation)) {
      const keys = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'] as const;
      stmts.forEach((st, i) => {
        row[keys[i]] = st.text;
      });
      row.correctAnswer = stmts.map((s) => (s.isTrue ? 'Đúng' : 'Sai')).join(' | ');
      return row;
    }
  } else if (
    !hasOptionalImage &&
    q.type === 'matching' &&
    Array.isArray(p.matchingLeft) &&
    Array.isArray(p.matchingRight) &&
    Array.isArray(p.correctPairs)
  ) {
    const left = p.matchingLeft as Array<{ id: string; text: string }>;
    const right = p.matchingRight as Array<{ id: string; text: string }>;
    const pairs = p.correctPairs as Array<{ leftId: string; rightId: string }>;
    row.matchingLeft = left.map((l) => l.text).join(' | ');
    row.matchingRight = right.map((r) => r.text).join(' | ');
    row.correctAnswer = pairs
      .map((pair) => {
        const li = left.findIndex((l) => l.id === pair.leftId);
        const ri = right.findIndex((r) => r.id === pair.rightId);
        return li >= 0 && ri >= 0 ? `${li + 1}-${ri + 1}` : '';
      })
      .filter(Boolean)
      .join(' | ');
    return row;
  }

  row.payloadJson = JSON.stringify(q.payload);
  return row;
}

export function buildQuestionBankExcelBuffer(
  pkg: QuestionBankExportPackage,
  mode: 'export' | 'template' = 'export',
  contextHint?: {
    module?: IC3Module;
    level?: IC3Level;
    category?: KnowledgeCategory;
    contentCode?: string;
  }
): Uint8Array {
  const wb = XLSX.utils.book_new();

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
    'optionA',
    'optionB',
    'optionC',
    'optionD',
    'optionE',
    'optionF',
    'matchingLeft',
    'matchingRight',
    'correctAnswer',
    'payloadJson',
    'explanation',
    'tips',
  ];

  const mod = contextHint?.module ?? 'computing_fundamentals';
  const lvl = contextHint?.level ?? 'LV1';
  const cat = contextHint?.category ?? 'GM';
  const code = contextHint?.contentCode ?? 'GM1';

  const sourceQuestions: Question[] =
    mode === 'template'
      ? [
          {
            id: '',
            module: mod,
            level: lvl,
            category: cat,
            contentCode: code,
            topicOrder: 1,
            topic: 'Thiết bị & Phím tắt',
            type: 'single',
            prompt: 'Phím tắt nào dùng để sao chép văn bản hoặc tệp tin đang chọn?',
            instruction: 'Chọn một đáp án đúng nhất.',
            payload: {
              options: [
                { id: 'a', text: 'Ctrl + C' },
                { id: 'b', text: 'Ctrl + V' },
                { id: 'c', text: 'Ctrl + X' },
                { id: 'd', text: 'Ctrl + Z' },
              ],
              correctOptionId: 'a',
            },
            explanation: 'Ctrl + C sao chép đối tượng vào Clipboard.',
            tips: 'C viết tắt của Copy.',
            createdAt: '',
            updatedAt: '',
          },
          {
            id: '',
            module: mod,
            level: lvl,
            category: cat,
            contentCode: code,
            topicOrder: 2,
            topic: 'Thiết bị lưu trữ',
            type: 'multiple',
            prompt: 'Những thiết bị nào sau đây là thiết bị NHẬP (Input Device)?',
            instruction: 'Chọn TẤT CẢ đáp án đúng.',
            payload: {
              options: [
                { id: 'a', text: 'Bàn phím' },
                { id: 'b', text: 'Chuột máy tính' },
                { id: 'c', text: 'Máy in' },
                { id: 'd', text: 'Loa ngoài' },
              ],
              correctOptionIds: ['a', 'b'],
            },
            explanation: 'Bàn phím và chuột dùng để đưa dữ liệu vào máy tính.',
            createdAt: '',
            updatedAt: '',
          },
          {
            id: '',
            module: mod,
            level: lvl,
            category: cat,
            contentCode: code,
            topicOrder: 3,
            topic: 'Bộ nhớ máy tính',
            type: 'true_false',
            prompt: 'Xác định Đúng hoặc Sai cho từng phát biểu sau:',
            instruction: 'Chọn Đúng hoặc Sai cho từng ý.',
            payload: {
              statements: [
                {
                  id: 's1',
                  text: 'Ổ cứng SSD có tốc độ đọc ghi nhanh hơn ổ HDD truyền thống.',
                  isTrue: true,
                },
                {
                  id: 's2',
                  text: 'RAM giữ nguyên toàn bộ dữ liệu sau khi tắt nguồn điện.',
                  isTrue: false,
                },
              ],
            },
            explanation: 'RAM là bộ nhớ khả biến, dữ liệu sẽ mất khi tắt nguồn.',
            createdAt: '',
            updatedAt: '',
          },
          {
            id: '',
            module: mod,
            level: lvl,
            category: cat,
            contentCode: code,
            topicOrder: 4,
            topic: 'Khái niệm phần cứng',
            type: 'matching',
            prompt: 'Ghép nối thành phần ở Cột A với chức năng tương ứng ở Cột B:',
            instruction: 'Chọn cặp tương ứng giữa Cột A và Cột B.',
            payload: {
              matchingLeft: [
                { id: 'l1', text: 'CPU' },
                { id: 'l2', text: 'RAM' },
              ],
              matchingRight: [
                { id: 'r1', text: 'Bộ nhớ truy cập tạm thời' },
                { id: 'r2', text: 'Bộ vi xử lý trung tâm' },
              ],
              correctPairs: [
                { leftId: 'l1', rightId: 'r2' },
                { leftId: 'l2', rightId: 'r1' },
              ],
            },
            explanation: 'CPU xử lý lệnh; RAM lưu tạm dữ liệu đang chạy.',
            createdAt: '',
            updatedAt: '',
          },
        ]
      : pkg.questions;

  const questionMatrix: unknown[][] = [
    headers,
    ...sourceQuestions.map((q) => {
      const r = questionToExcelRow(q);
      return headers.map((h) => r[h] ?? '');
    }),
  ];

  const wsQuestions = XLSX.utils.aoa_to_sheet(questionMatrix);
  wsQuestions['!cols'] = [
    { wch: 18 }, // id
    { wch: 24 }, // module
    { wch: 8 },  // level
    { wch: 10 }, // category
    { wch: 12 }, // contentCode
    { wch: 10 }, // topicOrder
    { wch: 24 }, // topic
    { wch: 12 }, // type
    { wch: 46 }, // prompt
    { wch: 28 }, // instruction
    { wch: 24 }, // optionA
    { wch: 24 }, // optionB
    { wch: 24 }, // optionC
    { wch: 24 }, // optionD
    { wch: 18 }, // optionE
    { wch: 18 }, // optionF
    { wch: 28 }, // matchingLeft
    { wch: 28 }, // matchingRight
    { wch: 18 }, // correctAnswer
    { wch: 24 }, // payloadJson
    { wch: 36 }, // explanation
    { wch: 24 }, // tips
  ];
  XLSX.utils.book_append_sheet(wb, wsQuestions, 'CauHoi');

  if (mode === 'export' && pkg.questionSets.length > 0) {
    const setRows: unknown[][] = [
      ['id', 'title', 'description', 'level', 'category', 'contentCode', 'questionIds'],
      ...pkg.questionSets.map((s) => [
        s.id,
        s.title,
        s.description,
        s.level ?? '',
        s.category ?? '',
        s.contentCode ?? '',
        s.questionIds.join(' | '),
      ]),
    ];
    const wsSets = XLSX.utils.aoa_to_sheet(setRows);
    wsSets['!cols'] = [
      { wch: 18 },
      { wch: 34 },
      { wch: 36 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 42 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSets, 'BoDe');
  }

  const guideRows: unknown[][] = [
    ['HƯỚNG DẪN NHẬP NGÂN HÀNG CÂU HỎI TỪ FILE EXCEL (.xlsx)'],
    ['1. Sheet dữ liệu chính là "CauHoi". Không đổi cấu trúc các dòng dữ liệu thành nhiều bảng trên cùng một sheet.'],
    ['2. Các cột hỗ trợ (có thể dùng tên tiếng Anh hoặc tiếng Việt tương ứng):'],
    ['Cột', 'Bắt buộc', 'Mô tả & Ví dụ'],
    ['id', 'Không', 'Mã câu hỏi duy nhất. Để trống nếu thêm câu mới (hệ thống tự tạo ID).'],
    ['module', 'Không', 'computing_fundamentals (LV1), key_applications (LV2), living_online (LV3) hoặc mã mô-đun tùy chỉnh.'],
    ['level', 'Không', 'Cấp độ: LV1, LV2, LV3, LV4... (mặc định tự suy ra từ module).'],
    ['category', 'Không', 'Nhóm kiến thức: GM, OT, TH... (mặc định GM).'],
    ['contentCode', 'Không', 'Mã phần kiến thức: GM1, GM2, OT1... (mặc định GM1).'],
    ['topicOrder', 'Không', 'Số thứ tự câu trong phần (1, 2, 3...).'],
    ['topic', 'Không', 'Tên chuyên đề / bài học của câu hỏi.'],
    ['type', 'Nên có', 'single (1 đáp án), multiple (nhiều đáp án), true_false (Đúng/Sai), matching (Ghép nối), matrix_choice (Điền khuyết bảng chọn), hotspot.'],
    ['prompt', 'Bắt buộc', 'Nội dung đề bài câu hỏi.'],
    ['optionA .. optionF', 'Khi không dùng payloadJson', 'Điền từng phương án lựa chọn (hoặc từng phát biểu Đúng/Sai) vào cột optionA, optionB, optionC...'],
    ['correctAnswer', 'Bắt buộc với trắc nghiệm', 'single: A hoặc B | multiple: A, C | true_false: Đúng | Sai | matching: 1-2 | 2-1.'],
    ['matchingLeft / matchingRight', 'Với dạng matching', 'Các vế cột A và cột B phân tách bằng dấu | (VD: CPU | RAM).'],
    ['payloadJson', 'Tùy chọn nâng cao', 'Dùng cho dạng matrix_choice, hotspot hoặc câu hỏi có ảnh minh họa (imageUrl).'],
    ['explanation / tips', 'Không', 'Giải thích đáp án và mẹo làm bài hiển thị sau khi học sinh trả lời.'],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 78 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HuongDan');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

/**
 * Đọc workbook Excel tổng quát cho Lớp học / Học sinh (tách riêng sheet hướng dẫn).
 */
export function readTabularExcelWorkbookBuffer(
  buffer: ArrayBuffer | Uint8Array,
  preferredSheetKeys: string[] = []
): ParsedExcelWorkbookData {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wb = XLSX.read(bytes, { type: 'array' });

  const sheets: Record<string, unknown[][]> = {};
  const dataCandidates: string[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    const key = normalizeSheetKey(name);
    sheets[name] = rows;
    if (!GUIDE_SHEET_KEYS.has(key)) {
      dataCandidates.push(name);
    }
  }

  const sheetNames =
    dataCandidates.length > 0 ? dataCandidates : Object.keys(sheets);
  const preferredSet = new Set(preferredSheetKeys.map(normalizeSheetKey));
  const preferred = sheetNames.find((n) => preferredSet.has(normalizeSheetKey(n)));

  return {
    sheetNames,
    activeSheetName: preferred ?? sheetNames[0] ?? '',
    sheets,
  };
}

export function parseClassesExcelSheet(
  workbook: ParsedExcelWorkbookData,
  sheetName?: string
): { rows: ParsedClassRow[]; warnings: string[]; errors: string[] } {
  const targetSheet = sheetName || workbook.activeSheetName;
  const rows = targetSheet ? workbook.sheets[targetSheet] ?? [] : [];
  if (!targetSheet || rows.length === 0) {
    return {
      rows: [],
      warnings: [],
      errors: ['Tệp Excel không có sheet dữ liệu lớp học hợp lệ.'],
    };
  }
  return parseClassesTabularRows(rows);
}

export function buildClassesExcelBuffer(
  classes: SchoolClass[],
  students: StudentProfile[],
  schoolName = ''
): Uint8Array {
  const wb = XLSX.utils.book_new();
  const headers = [
    'Tên lớp',
    'Khối',
    'Sĩ số học sinh',
    'Đã tự đổi MK',
    'Bật giải lao demo',
    'Trường học',
  ];

  const matrix: unknown[][] = [
    headers,
    ...classes.map((cls) => {
      const list = students.filter((s) => s.classId === cls.id);
      return [
        cls.name,
        cls.grade,
        list.length,
        list.filter((s) => s.isCustomPassword).length,
        list.filter((s) => s.alwaysBreakReady).length,
        schoolName,
      ];
    }),
  ];

  const ws = XLSX.utils.aoa_to_sheet(matrix);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'DanhSachLop');

  const wsGuide = XLSX.utils.aoa_to_sheet([
    ['HƯỚNG DẪN NHẬP DANH SÁCH LỚP HỌC TỪ EXCEL (.xlsx)'],
    ['1. Sheet dữ liệu chính là "DanhSachLop".'],
    ['2. Cột hỗ trợ khi nhập lại vào hệ thống:'],
    ['Cột', 'Bắt buộc', 'Mô tả & Ví dụ'],
    ['Tên lớp', 'Bắt buộc', 'Tên lớp duy nhất trong trường (VD: 6A1, 7A2, 8B1).'],
    ['Khối', 'Nên có', 'VD: Khối 6, Khối 7 hoặc nhập số 6, 7 (hệ thống tự chuẩn hóa thành Khối 6).'],
    ['Các cột còn lại', 'Tùy chọn', 'Sĩ số, Đã tự đổi MK, Trường học chỉ dùng để thống kê khi xuất file.'],
  ]);
  wsGuide['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 68 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HuongDan');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function buildClassesSampleExcelBuffer(schoolName = ''): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Tên lớp', 'Khối', 'Ghi chú (tùy chọn)'],
    ['6A3', 'Khối 6', schoolName || 'Ví dụ lớp khối 6'],
    ['6A4', '6', 'Có thể nhập số 6 hoặc Khối 6'],
    ['7A3', 'Khối 7', ''],
  ]);
  ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, ws, 'DanhSachLop');

  const wsGuide = XLSX.utils.aoa_to_sheet([
    ['HƯỚNG DẪN TẠO FILE NHẬP LỚP HỌC (.xlsx)'],
    ['- Điền mỗi lớp một dòng trong sheet "DanhSachLop".'],
    ['- Cột "Tên lớp" là bắt buộc; "Khối" có thể nhập "Khối 6" hoặc số "6" (hoặc để trống để hệ thống tự suy từ tên lớp).'],
    ['- Lớp trùng tên với lớp đã có trong trường sẽ được đánh dấu và tự động bỏ qua khi nhập.'],
  ]);
  wsGuide['!cols'] = [{ wch: 84 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HuongDan');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function parseStudentsExcelSheet(
  workbook: ParsedExcelWorkbookData,
  sheetName?: string,
  classPrefix = 'HS',
  existingCodes: string[] = []
): { rows: ParsedStudentRow[]; warnings: string[]; errors: string[] } {
  const targetSheet = sheetName || workbook.activeSheetName;
  const rows = targetSheet ? workbook.sheets[targetSheet] ?? [] : [];
  if (!targetSheet || rows.length === 0) {
    return {
      rows: [],
      warnings: [],
      errors: ['Tệp Excel không có sheet dữ liệu học sinh hợp lệ.'],
    };
  }
  return parseStudentsTabularRows(rows, classPrefix, existingCodes);
}

export function buildStudentsExcelBuffer(
  students: StudentProfile[],
  className: string,
  schoolName = ''
): Uint8Array {
  const wb = XLSX.utils.book_new();
  const headers = [
    'Mã HS',
    'Họ và tên',
    'Mật khẩu hiện hành',
    'Trạng thái mật khẩu',
    'Giải lao demo',
    'Lớp',
    'Trường học',
  ];

  const matrix: unknown[][] = [
    headers,
    ...students.map((st) => [
      st.studentCode,
      st.fullName,
      st.passwordHash || normalizeVietnamesePassword(st.fullName),
      st.isCustomPassword ? 'Đã tự đổi' : 'Mặc định',
      st.alwaysBreakReady ? 'Có' : 'Không',
      className,
      schoolName,
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(matrix);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 28 },
    { wch: 22 },
    { wch: 20 },
    { wch: 16 },
    { wch: 12 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'DanhSachHocSinh');

  const wsGuide = XLSX.utils.aoa_to_sheet([
    ['HƯỚNG DẪN XUẤT / NHẬP DANH SÁCH HỌC SINH (.xlsx)'],
    ['1. Sheet dữ liệu chính là "DanhSachHocSinh".'],
    ['2. Khi nhập danh sách học sinh vào lớp:'],
    ['Cột', 'Bắt buộc', 'Mô tả & Quy ước tự động'],
    ['Họ và tên', 'Bắt buộc', 'Họ và tên đầy đủ của học sinh (mỗi học sinh một dòng).'],
    ['Mã HS', 'Tự động', 'Hệ thống tự động đánh Mã HS nối tiếp theo lớp (VD: 6A1-06, 6A1-07...), giáo viên không cần nhập.'],
    ['Mật khẩu mặc định', 'Tự động', 'Tự động sinh từ họ tên viết thường không dấu, bỏ khoảng trắng (vd: Đỗ Gia Huy -> dogiahuy).'],
    ['Giải lao demo', 'Mặc định Không', 'Tự động đặt ở chế độ mặc định (Theo nhiệm vụ).'],
  ]);
  wsGuide['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HuongDan');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function buildStudentsSampleExcelBuffer(className = '6A1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Họ và tên'],
    ['Nguyễn Hoàng Nam'],
    ['Trần Ngọc Hân'],
    ['Lê Minh Khôi'],
  ]);
  ws['!cols'] = [{ wch: 32 }];
  XLSX.utils.book_append_sheet(wb, ws, 'DanhSachHocSinh');

  const wsGuide = XLSX.utils.aoa_to_sheet([
    [`HƯỚNG DẪN TẠO FILE NHẬP HỌC SINH LỚP ${className} (.xlsx)`],
    ['- Chỉ cần điền danh sách Họ và tên vào cột "Họ và tên" trong sheet "DanhSachHocSinh" (mỗi học sinh một dòng).'],
    [`- Mã học sinh sẽ được hệ thống tự động đánh nối tiếp theo tên lớp (VD: ${className}-01, ${className}-02...).`],
    ['- Mật khẩu mặc định tự động tạo từ họ tên viết thường không dấu, bỏ khoảng trắng; Giải lao demo đặt về mặc định.'],
  ]);
  wsGuide['!cols'] = [{ wch: 92 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HuongDan');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

