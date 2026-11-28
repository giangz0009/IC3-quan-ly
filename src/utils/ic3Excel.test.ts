import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import type { Question } from '../types/ic3';
import {
  buildQuestionBankExportPackage,
  gradeQuestion,
} from './ic3Rules';
import {
  buildClassesExcelBuffer,
  buildClassesSampleExcelBuffer,
  buildQuestionBankExcelBuffer,
  buildStudentsExcelBuffer,
  buildStudentsSampleExcelBuffer,
  parseClassesExcelSheet,
  parseQuestionBankExcelSheet,
  parseStudentsExcelSheet,
  readExcelWorkbookBuffer,
  readTabularExcelWorkbookBuffer,
} from './ic3Excel';

test('Excel sample template generates CauHoi + HuongDan sheets and parses all 4 sample types cleanly', () => {
  const pkg = buildQuestionBankExportPackage({
    modules: [],
    knowledgeCategories: [],
    knowledgeParts: [],
    questions: [],
    questionSets: [],
  });
  const bytes = buildQuestionBankExcelBuffer(pkg, 'template', {
    module: 'computing_fundamentals',
    level: 'LV1',
    category: 'GM',
    contentCode: 'GM1',
  });

  const wbData = readExcelWorkbookBuffer(bytes);
  assert.deepEqual(wbData.sheetNames, ['CauHoi']);
  assert.equal(wbData.activeSheetName, 'CauHoi');

  const parsed = parseQuestionBankExcelSheet(wbData);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.bundle.questions.length, 4);
  assert.deepEqual(
    parsed.bundle.questions.map((q) => q.type),
    ['single', 'multiple', 'true_false', 'matching']
  );
  assert.equal(gradeQuestion(parsed.bundle.questions[0], 'a'), true);
  assert.equal(gradeQuestion(parsed.bundle.questions[1], ['a', 'b']), true);
  assert.equal(
    gradeQuestion(parsed.bundle.questions[2], { s1: true, s2: false }),
    true
  );
  assert.equal(
    gradeQuestion(parsed.bundle.questions[3], { l1: 'r2', l2: 'r1' }),
    true
  );
});

test('Excel export and re-import round-trips all 5 question types and QuestionSets cleanly', () => {
  const questions: Question[] = [
    {
      id: 'q_x_single',
      module: 'computing_fundamentals',
      level: 'LV1',
      category: 'GM',
      contentCode: 'GM1',
      topicOrder: 1,
      topic: 'Phần cứng',
      type: 'single',
      prompt: 'Đơn vị đo tốc độ CPU là gì?',
      payload: {
        options: [
          { id: 'a', text: 'GHz' },
          { id: 'b', text: 'GB' },
        ],
        correctOptionId: 'a',
      },
      explanation: 'CPU đo bằng GHz.',
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
    },
    {
      id: 'q_x_hotspot',
      module: 'key_applications',
      level: 'LV2',
      category: 'WORD',
      contentCode: 'WORD1',
      topicOrder: 1,
      topic: 'Word Ribbon',
      type: 'hotspot',
      prompt: 'Nhấp vào nút Bold trên thanh Ribbon',
      payload: {
        hotspotType: 'word_ribbon',
        imageAlt: 'Word Ribbon',
        hotspotTarget: { label: 'Bold', minX: 15, minY: 20, maxX: 25, maxY: 35 },
      },
      explanation: '',
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
    },
  ];
  const pkg = buildQuestionBankExportPackage({
    modules: [],
    knowledgeCategories: [],
    knowledgeParts: [],
    questions,
    questionSets: [
      {
        id: 'set_x_1',
        title: 'Bộ đề Excel Export',
        description: 'Kiểm thử',
        level: 'LV1',
        category: 'GM',
        contentCode: 'GM1',
        questionIds: ['q_x_single', 'q_x_hotspot'],
        createdAt: '2026-11-24T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      },
    ],
  });

  const bytes = buildQuestionBankExcelBuffer(pkg, 'export');
  const wbData = readExcelWorkbookBuffer(bytes);
  const parsed = parseQuestionBankExcelSheet(wbData);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.bundle.questions.length, 2);
  assert.equal(parsed.bundle.questions[0].id, 'q_x_single');
  assert.equal(parsed.bundle.questions[1].type, 'hotspot');
  assert.equal(gradeQuestion(parsed.bundle.questions[1], { x: 20, y: 25 }), true);
  assert.equal(parsed.bundle.questionSets.length, 1);
  assert.deepEqual(parsed.bundle.questionSets[0].questionIds, [
    'q_x_single',
    'q_x_hotspot',
  ]);
});

test('Excel parser handles Vietnamese headers, Option A-D columns, multiple sheets, and defaultContext fallback', () => {
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    [
      'Dạng câu hỏi',
      'Nội dung câu hỏi',
      'Đáp án A',
      'Đáp án B',
      'Đáp án C',
      'Đáp án D',
      'Đáp án đúng',
      'Giải thích',
    ],
    [
      '1 đáp án',
      'Hệ điều hành mã nguồn mở phổ biến là gì?',
      'Windows 11',
      'Linux',
      'macOS',
      'iOS',
      'B',
      'Linux là hệ điều hành mã nguồn mở.',
    ],
    [
      'Nhiều đáp án',
      'Chọn các trình duyệt web phổ biến:',
      'Google Chrome',
      'Microsoft Edge',
      'Microsoft Word',
      'Adobe Photoshop',
      'A, B',
      'Chrome và Edge là trình duyệt.',
    ],
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Cột không hợp lệ', 'Ghi chú'],
    ['abc', 'def'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws1, 'NganHangVN');
  XLSX.utils.book_append_sheet(wb, ws2, 'SheetPhu');

  const bytes = new Uint8Array(
    XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  );
  const wbData = readExcelWorkbookBuffer(bytes);
  assert.deepEqual(wbData.sheetNames, ['NganHangVN', 'SheetPhu']);

  const parsedSheet1 = parseQuestionBankExcelSheet(wbData, 'NganHangVN', {
    module: 'living_online',
    level: 'LV3',
    category: 'OT',
    contentCode: 'OT2',
  });
  assert.equal(parsedSheet1.errors.length, 0);
  assert.equal(parsedSheet1.bundle.questions.length, 2);
  assert.equal(parsedSheet1.bundle.questions[0].module, 'living_online');
  assert.equal(parsedSheet1.bundle.questions[0].contentCode, 'OT2');
  assert.equal(gradeQuestion(parsedSheet1.bundle.questions[0], 'b'), true);
  assert.equal(gradeQuestion(parsedSheet1.bundle.questions[1], ['a', 'b']), true);

  const parsedSheet2 = parseQuestionBankExcelSheet(wbData, 'SheetPhu');
  assert.equal(parsedSheet2.errors.length, 1);
});

test('Classes Excel sample and export round-trip cleanly with grade normalization and HuongDan excluded', () => {
  const sampleBytes = buildClassesSampleExcelBuffer('THCS Nguyễn Du');
  const sampleWb = readTabularExcelWorkbookBuffer(sampleBytes, ['danhsachlop']);
  assert.deepEqual(sampleWb.sheetNames, ['DanhSachLop']);
  const parsedSample = parseClassesExcelSheet(sampleWb);
  assert.equal(parsedSample.errors.length, 0);
  assert.deepEqual(parsedSample.rows, [
    { name: '6A3', grade: 'Khối 6' },
    { name: '6A4', grade: 'Khối 6' },
    { name: '7A3', grade: 'Khối 7' },
  ]);

  const exportBytes = buildClassesExcelBuffer(
    [
      {
        id: 'c_1',
        schoolId: 's_1',
        name: '8A1',
        grade: 'Khối 8',
        createdAt: '2026-11-24T00:00:00.000Z',
      },
    ],
    [],
    'THCS Nguyễn Du'
  );
  const exportWb = readTabularExcelWorkbookBuffer(exportBytes, ['danhsachlop']);
  const parsedExport = parseClassesExcelSheet(exportWb);
  assert.equal(parsedExport.errors.length, 0);
  assert.deepEqual(parsedExport.rows, [{ name: '8A1', grade: 'Khối 8' }]);
});

test('Students Excel sample uses single name column with auto-codes while export preserves full columns', () => {
  const sampleBytes = buildStudentsSampleExcelBuffer('7A1');
  const sampleWb = readTabularExcelWorkbookBuffer(sampleBytes, [
    'danhsachhocsinh',
  ]);
  assert.deepEqual(sampleWb.sheetNames, ['DanhSachHocSinh']);
  assert.deepEqual(sampleWb.sheets['DanhSachHocSinh']?.[0], ['Họ và tên']);
  const parsedSample = parseStudentsExcelSheet(sampleWb, undefined, '7A1');
  assert.equal(parsedSample.errors.length, 0);
  assert.equal(parsedSample.rows.length, 3);
  assert.equal(parsedSample.rows[0].studentCode, '7A1-01');
  assert.equal(parsedSample.rows[1].studentCode, '7A1-02');
  assert.equal(parsedSample.rows[2].studentCode, '7A1-03');
  assert.equal(parsedSample.rows[0].alwaysBreakReady, false);
  assert.equal(parsedSample.rows[2].alwaysBreakReady, false);

  const exportBytes = buildStudentsExcelBuffer(
    [
      {
        id: 'st_1',
        classId: 'c_1',
        fullName: 'Phạm Minh Tuấn',
        studentCode: '7A1-01',
        passwordHash: 'phamminhtuan',
        isCustomPassword: false,
        alwaysBreakReady: true,
        createdAt: '2026-11-24T00:00:00.000Z',
      },
    ],
    '7A1',
    'THCS Nguyễn Du'
  );
  const exportWb = readTabularExcelWorkbookBuffer(exportBytes, [
    'danhsachhocsinh',
  ]);
  const parsedExport = parseStudentsExcelSheet(exportWb, undefined, '7A1', ['7A1-01']);
  assert.equal(parsedExport.errors.length, 0);
  assert.deepEqual(parsedExport.rows, [
    {
      fullName: 'Phạm Minh Tuấn',
      studentCode: '7A1-02',
      defaultPassword: 'phamminhtuan',
      alwaysBreakReady: false,
    },
  ]);
});

test('Question Bank Excel export and re-import preserve matrix_choice and optional illustration imageUrl', () => {
  const bytes = buildQuestionBankExcelBuffer(
    {
      format: 'ic3-question-bank-v1',
      exportedAt: '2026-11-28T00:00:00.000Z',
      scopeLabel: 'Test Matrix & Illust',
      modules: [],
      knowledgeCategories: [],
      knowledgeParts: [],
      questions: [
        {
          id: 'q_mx_xls',
          module: 'living_online',
          level: 'LV3',
          category: 'GM',
          contentCode: 'GM1',
          topicOrder: 1,
          topic: 'Boolean',
          type: 'matrix_choice',
          prompt: 'Chọn toán tử phù hợp:',
          payload: {
            templateText: 'Để _(1)_ kết quả dùng AND',
            options: [
              { id: 'o1', text: 'Mở rộng' },
              { id: 'o2', text: 'Thu hẹp' },
            ],
            slots: [{ id: 's1', label: '(1)', correctOptionId: 'o2' }],
            imageUrl: 'https://example.com/matrix-hint.png',
            imageAlt: 'Sơ đồ Venn',
          },
          explanation: '',
          createdAt: '2026-11-28T00:00:00.000Z',
          updatedAt: '2026-11-28T00:00:00.000Z',
        },
        {
          id: 'q_single_img_xls',
          module: 'computing_fundamentals',
          level: 'LV1',
          category: 'GM',
          contentCode: 'GM1',
          topicOrder: 2,
          topic: 'Thiết bị',
          type: 'single',
          prompt: 'Quan sát hình minh họa và chọn đúng:',
          payload: {
            options: [
              { id: 'a', text: 'CPU' },
              { id: 'b', text: 'RAM' },
            ],
            correctOptionId: 'b',
            imageUrl: 'https://example.com/ram-stick.png',
            imageAlt: 'Thanh RAM',
          },
          explanation: '',
          createdAt: '2026-11-28T00:00:00.000Z',
          updatedAt: '2026-11-28T00:00:00.000Z',
        },
      ],
      questionSets: [],
    },
    'export'
  );

  const wb = readExcelWorkbookBuffer(bytes);
  const parsed = parseQuestionBankExcelSheet(wb);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.bundle.questions.length, 2);
  assert.equal(parsed.bundle.questions[0].type, 'matrix_choice');
  assert.equal(gradeQuestion(parsed.bundle.questions[0], { s1: 'o2' }), true);

  const singlePayload = parsed.bundle.questions[1].payload;
  assert.ok('imageUrl' in singlePayload);
  assert.equal(singlePayload.imageUrl, 'https://example.com/ram-stick.png');
  assert.equal(gradeQuestion(parsed.bundle.questions[1], 'b'), true);
});


