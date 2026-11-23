import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdminTeachersSupabasePayload,
  buildHotspotTargetFromPoints,
  buildQuestionBankSupabasePayload,
  buildReorderedPartUpdates,
  calculateIC3Score,
  canDeleteOrDemoteMaster,
  collectHotspotStoragePathsToDelete,
  evaluateTaskCompletion,
  extractHotspotStoragePathFromUrl,
  extractImageFileFromClipboardData,
  filterTeachers,
  formatQuestionOrderSummary,
  formatSubmissionsToCsv,
  formatSupabaseLoadingStatus,
  getDefaultInstructionForQuestionType,
  getHotspotTargetCenter,
  getNextTopicOrder,
  getObsoleteHotspotStoragePath,
  getPartQuestionsSorted,
  getTeacherPermissionDetails,
  getTeacherPermissions,
  gradeQuestion,
  isPassingIC3Score,
  isSafeRemoteSupabaseUrl,
  isStudentBreakUnlocked,
  mapSupabaseRowToAdminTeacher,
  mergeRemoteTeachersWithLocal,
  normalizeAdminRole,
  normalizeTeacherStatus,
  normalizeVietnamesePassword,
  parseStudentsCsv,
  pickQuestionsBySelectedIds,
  rankBattleParticipants,
  resolveToastVariant,
  shouldUploadHotspotFileOnSave,
  sliceQuestionsByOrderRange,
  summarizeTeachersByRole,
  summarizeTeacherStatuses,
  toggleSelectAllVisibleIds,
  validateStudentPassword,
} from './ic3Rules';
import type {
  AdminTaskStatRecord,
  BattleParticipant,
  ClassTaskItem,
  Question,
} from '../types/ic3';

test('normalizeVietnamesePassword handles Đ/đ, accents, and spaces accurately', () => {
  assert.equal(normalizeVietnamesePassword('Đỗ Gia Huy'), 'dogiahuy');
  assert.equal(normalizeVietnamesePassword('Nguyễn Văn An'), 'nguyenvanan');
  assert.equal(normalizeVietnamesePassword('  Trần Thị Minh Thư  '), 'tranthiminhthu');
  assert.equal(normalizeVietnamesePassword('Lê Hoàng Phúc 01'), 'lehoangphuc01');
});

test('validateStudentPassword enforces length, no whitespace, and non-duplicate', () => {
  assert.equal(validateStudentPassword('abc').valid, false);
  assert.equal(validateStudentPassword('ab cd').valid, false);
  assert.equal(validateStudentPassword('dogiahuy', 'dogiahuy').valid, false);
  assert.equal(validateStudentPassword('huy2026', 'dogiahuy').valid, true);
});

test('calculateIC3Score and passing threshold follow 1000-point IC3 standard', () => {
  assert.equal(calculateIC3Score(7, 10), 700);
  assert.equal(calculateIC3Score(10, 10), 1000);
  assert.equal(calculateIC3Score(0, 10), 0);
  assert.equal(calculateIC3Score(5, 0), 0);
  assert.equal(isPassingIC3Score(700), true);
  assert.equal(isPassingIC3Score(699), false);
});

test('gradeQuestion correctly evaluates all 5 IC3 question types', () => {
  const base = {
    module: 'computing_fundamentals' as const,
    level: 'LV1' as const,
    category: 'GM' as const,
    contentCode: 'GM1',
    topicOrder: 1,
    topic: 'Test',
    prompt: 'Prompt',
    explanation: '',
    createdAt: '',
    updatedAt: '',
  };

  const singleQ: Question = {
    ...base,
    id: 'q1',
    type: 'single',
    payload: {
      options: [
        { id: 'a', text: 'RAM' },
        { id: 'b', text: 'SSD' },
      ],
      correctOptionId: 'a',
    },
  };
  assert.equal(gradeQuestion(singleQ, 'a'), true);
  assert.equal(gradeQuestion(singleQ, 'b'), false);

  const multiQ: Question = {
    ...base,
    id: 'q2',
    type: 'multiple',
    payload: {
      options: [
        { id: 'a', text: '1' },
        { id: 'b', text: '2' },
        { id: 'c', text: '3' },
      ],
      correctOptionIds: ['a', 'c'],
    },
  };
  assert.equal(gradeQuestion(multiQ, ['c', 'a']), true);
  assert.equal(gradeQuestion(multiQ, ['a']), false);
  assert.equal(gradeQuestion(multiQ, ['a', 'b', 'c']), false);

  const tfQ: Question = {
    ...base,
    id: 'q3',
    type: 'true_false',
    payload: {
      statements: [
        { id: 's1', text: 'CPU là bộ xử lý', isTrue: true },
        { id: 's2', text: 'ROM ghi tự do', isTrue: false },
      ],
    },
  };
  assert.equal(gradeQuestion(tfQ, { s1: true, s2: false }), true);
  assert.equal(gradeQuestion(tfQ, { s1: true, s2: true }), false);

  const matchQ: Question = {
    ...base,
    id: 'q4',
    type: 'matching',
    payload: {
      matchingLeft: [
        { id: 'l1', text: 'Ctrl+C' },
        { id: 'l2', text: 'Ctrl+V' },
      ],
      matchingRight: [
        { id: 'r1', text: 'Dán' },
        { id: 'r2', text: 'Sao chép' },
      ],
      correctPairs: [
        { leftId: 'l1', rightId: 'r2' },
        { leftId: 'l2', rightId: 'r1' },
      ],
    },
  };
  assert.equal(gradeQuestion(matchQ, { l1: 'r2', l2: 'r1' }), true);
  assert.equal(gradeQuestion(matchQ, { l1: 'r1', l2: 'r2' }), false);

  const hotspotQ: Question = {
    ...base,
    id: 'q5',
    type: 'hotspot',
    payload: {
      hotspotType: 'word_ribbon',
      imageAlt: 'Word Ribbon',
      hotspotTarget: {
        label: 'In đậm (Bold)',
        minX: 20,
        minY: 30,
        maxX: 30,
        maxY: 45,
      },
    },
  };
  assert.equal(gradeQuestion(hotspotQ, { x: 25, y: 38 }), true);
  // Tolerance ±1.5%
  assert.equal(gradeQuestion(hotspotQ, { x: 18.8, y: 46.2 }), true);
  assert.equal(gradeQuestion(hotspotQ, { x: 15, y: 38 }), false);
});

test('evaluateTaskCompletion and isStudentBreakUnlocked enforce requiredAttempts and minScore', () => {
  const tasks: ClassTaskItem[] = [
    {
      id: 't1',
      classId: 'c1',
      orderIndex: 1,
      title: 'Task 1',
      description: '',
      level: 'LV1',
      category: 'GM',
      contentCode: 'GM1',
      moduleFilter: 'all',
      quizMode: 'practice',
      questionIds: ['q1'],
      estimatedMinutes: 10,
      requiredAttempts: 2,
      minScore: 700,
    },
  ];

  const subs: AdminTaskStatRecord[] = [
    {
      id: 's1',
      studentId: 'st1',
      studentName: 'A',
      studentCode: 'HS01',
      schoolId: 'sc1',
      classId: 'c1',
      taskId: 't1',
      taskTitle: 'Task 1',
      score: 650,
      correctCount: 6,
      totalCount: 10,
      durationSeconds: 120,
      completedAt: '2026-11-10T10:00:00Z',
      attemptNumber: 1,
      requiredAttempts: 2,
      minScore: 700,
      metMinScore: false,
    },
    {
      id: 's2',
      studentId: 'st1',
      studentName: 'A',
      studentCode: 'HS01',
      schoolId: 'sc1',
      classId: 'c1',
      taskId: 't1',
      taskTitle: 'Task 1',
      score: 800,
      correctCount: 8,
      totalCount: 10,
      durationSeconds: 110,
      completedAt: '2026-11-10T10:05:00Z',
      attemptNumber: 2,
      requiredAttempts: 2,
      minScore: 700,
      metMinScore: true,
    },
  ];

  const eval1 = evaluateTaskCompletion(subs, 'st1', tasks[0]);
  assert.equal(eval1.qualifyingAttempts, 1);
  assert.equal(eval1.completed, false);
  assert.equal(isStudentBreakUnlocked(tasks, subs, 'st1'), false);

  subs.push({
    ...subs[1],
    id: 's3',
    score: 900,
    attemptNumber: 3,
  });

  const eval2 = evaluateTaskCompletion(subs, 'st1', tasks[0]);
  assert.equal(eval2.qualifyingAttempts, 2);
  assert.equal(eval2.bestScore, 900);
  assert.equal(eval2.completed, true);
  assert.equal(isStudentBreakUnlocked(tasks, subs, 'st1'), true);
});

test('rankBattleParticipants sorts by score DESC then durationSeconds ASC and rewards Top X', () => {
  const baseParticipant = {
    roomId: 'r1',
    connected: true,
    answeredCount: 10,
    finished: true,
    shieldCharges: 0,
    pendingCardChoices: 0,
    attacksUsed: 0,
    defensesUsed: 0,
    attacksBlocked: 0,
    activeDebuffs: [],
    currentPairCount: 0,
    currentPairElapsedSeconds: 0,
    joinedAt: '',
  };

  const participants: BattleParticipant[] = [
    {
      ...baseParticipant,
      studentId: 'st2',
      studentName: 'Bình',
      studentCode: 'HS02',
      correctCount: 9,
      score: 900,
      durationSeconds: 140,
    },
    {
      ...baseParticipant,
      studentId: 'st1',
      studentName: 'An',
      studentCode: 'HS01',
      correctCount: 9,
      score: 900,
      durationSeconds: 95,
    },
    {
      ...baseParticipant,
      studentId: 'st3',
      studentName: 'Châu',
      studentCode: 'HS03',
      correctCount: 8,
      score: 800,
      durationSeconds: 80,
    },
  ];

  const ranked = rankBattleParticipants(participants, 10, 2, 15);
  assert.deepEqual(
    ranked.map((r) => [r.rank, r.studentName, r.rewardedBreakMinutes]),
    [
      [1, 'An', 15],
      [2, 'Bình', 15],
      [3, 'Châu', 0],
    ]
  );
});

test('parseStudentsCsv and formatSubmissionsToCsv handle Vietnamese data', () => {
  const csv = 'Họ tên,Mã HS\nĐỗ Gia Huy,6A1-01\nLê Minh Anh,';
  const parsed = parseStudentsCsv(csv, '6A1');
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].defaultPassword, 'dogiahuy');
  assert.equal(parsed.rows[1].studentCode, '6A1002');
  assert.equal(parsed.rows[1].defaultPassword, 'leminhanh');

  const out = formatSubmissionsToCsv([], [], []);
  assert.equal(out.startsWith('\uFEFF'), true);
});

test('part question ordering, range slicing, and reordering work accurately', () => {
  const mkQ = (id: string, contentCode: string, topicOrder: number): Question => ({
    id,
    module: 'computing_fundamentals',
    level: 'LV1',
    category: 'GM',
    contentCode,
    topicOrder,
    topic: 'Test',
    type: 'single',
    prompt: `Prompt ${id}`,
    payload: {
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      correctOptionId: 'a',
    },
    explanation: '',
    createdAt: '2026-11-15T08:00:00Z',
    updatedAt: '2026-11-15T08:00:00Z',
  });

  const qs = [
    mkQ('q3', 'GM1', 3),
    mkQ('q1', 'GM1', 1),
    mkQ('q2', 'GM1', 2),
    mkQ('q_other', 'GM2', 1),
  ];

  const sorted = getPartQuestionsSorted(qs, 'computing_fundamentals', 'GM', 'GM1');
  assert.deepEqual(
    sorted.map((q) => q.id),
    ['q1', 'q2', 'q3']
  );

  assert.equal(
    getNextTopicOrder(qs, 'computing_fundamentals', 'GM', 'GM1'),
    4
  );
  assert.equal(
    getNextTopicOrder(qs, 'computing_fundamentals', 'GM', 'GM3'),
    1
  );

  const sliced = sliceQuestionsByOrderRange(
    qs,
    'computing_fundamentals',
    'GM',
    'GM1',
    2,
    3
  );
  assert.deepEqual(
    sliced.map((q) => q.id),
    ['q2', 'q3']
  );

  const updates = buildReorderedPartUpdates(
    qs,
    'computing_fundamentals',
    'GM',
    'GM1',
    'q2',
    -1
  );
  assert.deepEqual(updates, [
    { id: 'q2', topicOrder: 1 },
    { id: 'q1', topicOrder: 2 },
    { id: 'q3', topicOrder: 3 },
  ]);
});

test('buildQuestionBankSupabasePayload synthesizes missing FK parents and normalizes codes', () => {
  const payload = buildQuestionBankSupabasePayload({
    modules: [],
    knowledgeCategories: [],
    knowledgeParts: [],
    questions: [
      {
        id: 'q_custom',
        module: 'ai_literacy',
        level: 'lv4',
        category: 'th',
        contentCode: 'th1',
        topicOrder: 1,
        topic: 'Prompt AI',
        type: 'single',
        prompt: 'What is a prompt?',
        payload: {
          options: [
            { id: 'a', text: 'Câu lệnh hướng dẫn AI' },
            { id: 'b', text: 'Ổ cứng SSD' },
          ],
          correctOptionId: 'a',
        },
        explanation: '',
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
      },
    ],
    questionSets: [
      {
        id: 'set_1',
        title: 'Bộ đề LV4',
        description: '',
        level: 'LV4',
        category: 'th',
        contentCode: 'th1',
        questionIds: ['q_custom'],
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
      },
    ],
  });

  assert.equal(payload.modules.length, 1);
  assert.equal(payload.modules[0].code, 'ai_literacy');
  assert.equal(payload.modules[0].level, 'LV4');

  assert.equal(payload.categories.length, 1);
  assert.equal(payload.categories[0].module, 'ai_literacy');
  assert.equal(payload.categories[0].code, 'TH');

  assert.equal(payload.parts.length, 1);
  assert.equal(payload.parts[0].module, 'ai_literacy');
  assert.equal(payload.parts[0].category, 'TH');
  assert.equal(payload.parts[0].code, 'TH1');

  assert.equal(payload.questions[0].category, 'TH');
  assert.equal(payload.questions[0].content_code, 'TH1');
  assert.equal(payload.questionSets[0].category, 'TH');
});

test('multi-select helpers select all visible, pick non-contiguous in order, and format summary', () => {
  const mkQ = (id: string, topicOrder: number): Question => ({
    id,
    module: 'computing_fundamentals',
    level: 'LV1',
    category: 'GM',
    contentCode: 'GM1',
    topicOrder,
    topic: 'Test',
    type: 'single',
    prompt: `Q${topicOrder}`,
    payload: {
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      correctOptionId: 'a',
    },
    explanation: '',
    createdAt: '2026-11-15T08:00:00Z',
    updatedAt: '2026-11-15T08:00:00Z',
  });

  const sorted = [mkQ('q1', 1), mkQ('q2', 2), mkQ('q3', 3), mkQ('q4', 4)];

  // Select all visible when partially selected
  assert.deepEqual(
    toggleSelectAllVisibleIds(['q1'], ['q1', 'q2', 'q3']),
    ['q1', 'q2', 'q3']
  );

  // Deselect all visible when all visible are already selected (preserve hidden selection q4)
  assert.deepEqual(
    toggleSelectAllVisibleIds(['q4', 'q1', 'q2', 'q3'], ['q1', 'q2', 'q3']),
    ['q4']
  );

  // Pick non-contiguous selected IDs in ascending topicOrder regardless of click order
  const picked = pickQuestionsBySelectedIds(sorted, ['q4', 'q1', 'q3']);
  assert.deepEqual(
    picked.map((q) => q.id),
    ['q1', 'q3', 'q4']
  );

  assert.equal(formatQuestionOrderSummary(picked), 'Câu 1, Câu 3, Câu 4');
  assert.equal(
    formatQuestionOrderSummary(picked, 2),
    'Câu 1, Câu 3 (+1 câu)'
  );
});

test('formatSupabaseLoadingStatus formats empty, single, and concurrent Supabase tasks', () => {
  assert.equal(formatSupabaseLoadingStatus([]), null);
  assert.equal(
    formatSupabaseLoadingStatus([{ id: 1, label: 'Đang lấy Ngân hàng Câu hỏi từ Supabase...' }]),
    'Đang lấy Ngân hàng Câu hỏi từ Supabase...'
  );
  assert.equal(
    formatSupabaseLoadingStatus([
      { id: 1, label: 'Đang kiểm tra kết nối Supabase...' },
      { id: 2, label: 'Đang đồng bộ Câu hỏi lên Supabase...' },
    ]),
    'Đang đồng bộ Câu hỏi lên Supabase... (2 tác vụ đang chờ Supabase...)'
  );
});

test('getDefaultInstructionForQuestionType returns expected instruction for all 5 question types and payload omits difficulty', () => {
  assert.equal(getDefaultInstructionForQuestionType('single'), 'Chọn một đáp án đúng nhất.');
  assert.equal(getDefaultInstructionForQuestionType('multiple'), 'Chọn TẤT CẢ đáp án đúng.');
  assert.equal(getDefaultInstructionForQuestionType('true_false'), 'Chọn Đúng hoặc Sai cho từng ý.');
  assert.equal(
    getDefaultInstructionForQuestionType('matching'),
    'Chọn cặp tương ứng giữa Cột A và Cột B.'
  );
  assert.equal(
    getDefaultInstructionForQuestionType('hotspot'),
    'Nhấp chuột trực tiếp vào vùng tương ứng trên hình.'
  );

  const payload = buildQuestionBankSupabasePayload({
    modules: [],
    knowledgeCategories: [],
    knowledgeParts: [],
    questions: [
      {
        id: 'q_default_inst',
        module: 'computing_fundamentals',
        level: 'LV1',
        category: 'GM',
        contentCode: 'GM1',
        topicOrder: 1,
        topic: 'Phần cứng',
        type: 'multiple',
        prompt: 'Chọn đáp án đúng',
        payload: {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['a'],
        },
        explanation: '',
        createdAt: '2026-11-20T00:00:00Z',
        updatedAt: '2026-11-20T00:00:00Z',
      },
    ],
    questionSets: [],
  });

  assert.equal(payload.questions[0].instruction, 'Chọn TẤT CẢ đáp án đúng.');
  assert.equal('difficulty' in payload.questions[0], false);
});

test('hotspot helpers compute click box, drag region, center point, and grade uploaded image payloads', () => {
  const clicked = buildHotspotTargetFromPoints(
    { x: 50, y: 40 },
    { x: 50.4, y: 40.4 },
    'Nút Save'
  );
  assert.deepEqual(clicked, {
    label: 'Nút Save',
    minX: 46.2,
    maxX: 54.2,
    minY: 34.2,
    maxY: 46.2,
  });
  assert.deepEqual(getHotspotTargetCenter(clicked), { x: 50.2, y: 40.2 });

  const dragged = buildHotspotTargetFromPoints(
    { x: 30, y: 20 },
    { x: 10, y: 50 },
    ''
  );
  assert.deepEqual(dragged, {
    label: 'Điểm đáp án đúng',
    minX: 10,
    minY: 20,
    maxX: 30,
    maxY: 50,
  });

  const uploadedHotspotQ: Question = {
    id: 'q_hs_upload',
    module: 'computing_fundamentals',
    level: 'LV1',
    category: 'GM',
    contentCode: 'GM1',
    topicOrder: 1,
    topic: 'Test',
    type: 'hotspot',
    prompt: 'Nhấp vào nút Lưu trên ảnh',
    payload: {
      imageUrl: 'https://example.supabase.co/storage/v1/object/public/hotspot-images/q1.png',
      imageAlt: 'Ảnh chụp màn hình Word',
      hotspotTarget: clicked,
    },
    explanation: '',
    createdAt: '',
    updatedAt: '',
  };
  assert.equal(gradeQuestion(uploadedHotspotQ, { x: 50, y: 40 }), true);
  assert.equal(gradeQuestion(uploadedHotspotQ, { x: 10, y: 10 }), false);
});

test('extractImageFileFromClipboardData supports items, files fallback, and ignores non-image text', () => {
  const pastedImg = new File([new Uint8Array([137, 80, 78, 71])], 'screenshot.png', {
    type: 'image/png',
  });
  const fromItems = extractImageFileFromClipboardData({
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => pastedImg },
    ],
    files: [],
  });
  assert.equal(fromItems, pastedImg);

  const fallbackImg = new File([new Uint8Array([1, 2, 3])], 'clip.webp', {
    type: 'image/webp',
  });
  const fromFiles = extractImageFileFromClipboardData({
    items: [],
    files: [fallbackImg],
  });
  assert.equal(fromFiles, fallbackImg);

  const textOnly = extractImageFileFromClipboardData({
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    files: [],
  });
  assert.equal(textOnly, null);
  assert.equal(extractImageFileFromClipboardData(null), null);
});

test('shouldUploadHotspotFileOnSave only allows Storage upload on valid hotspot save', () => {
  assert.equal(
    shouldUploadHotspotFileOnSave({
      questionType: 'hotspot',
      hasPendingFile: true,
      supabaseConfigured: true,
      promptValid: true,
      hotspotImageReady: true,
      hotspotTargetReady: true,
    }),
    true
  );

  // Missing target point or missing prompt must NOT upload to Storage
  assert.equal(
    shouldUploadHotspotFileOnSave({
      questionType: 'hotspot',
      hasPendingFile: true,
      supabaseConfigured: true,
      promptValid: true,
      hotspotImageReady: true,
      hotspotTargetReady: false,
    }),
    false
  );
  assert.equal(
    shouldUploadHotspotFileOnSave({
      questionType: 'hotspot',
      hasPendingFile: true,
      supabaseConfigured: true,
      promptValid: false,
      hotspotImageReady: true,
      hotspotTargetReady: true,
    }),
    false
  );

  // Editing existing question without selecting/pasting new file must NOT re-upload
  assert.equal(
    shouldUploadHotspotFileOnSave({
      questionType: 'hotspot',
      hasPendingFile: false,
      supabaseConfigured: true,
      promptValid: true,
      hotspotImageReady: true,
      hotspotTargetReady: true,
    }),
    false
  );
});

test('Hotspot Storage path extraction and obsolete cleanup on edit/delete work accurately', () => {
  const oldUrl =
    'https://abcxyz.supabase.co/storage/v1/object/public/hotspot-images/questions/111_old.png';
  const newUrl =
    'https://abcxyz.supabase.co/storage/v1/object/public/hotspot-images/questions/222_new.webp?t=123';

  assert.equal(
    extractHotspotStoragePathFromUrl(oldUrl),
    'questions/111_old.png'
  );
  assert.equal(
    extractHotspotStoragePathFromUrl(newUrl),
    'questions/222_new.webp'
  );
  assert.equal(
    extractHotspotStoragePathFromUrl('data:image/webp;base64,AAA'),
    null
  );
  assert.equal(
    extractHotspotStoragePathFromUrl('blob:http://localhost:3000/123'),
    null
  );

  // Replacing with another image returns the old path for deletion
  assert.equal(
    getObsoleteHotspotStoragePath(oldUrl, newUrl),
    'questions/111_old.png'
  );
  // Keeping the same image returns null
  assert.equal(getObsoleteHotspotStoragePath(oldUrl, oldUrl), null);
  // Changing question type (newImageUrl = undefined) also deletes old image
  assert.equal(
    getObsoleteHotspotStoragePath(oldUrl, undefined),
    'questions/111_old.png'
  );

  const q1: Question = {
    id: 'q1',
    module: 'computing_fundamentals',
    level: 'LV1',
    category: 'GM',
    contentCode: 'GM1',
    topicOrder: 1,
    topic: 'Test',
    type: 'hotspot',
    prompt: 'Q1',
    payload: {
      imageUrl: oldUrl,
      imageAlt: 'Ảnh cũ',
      hotspotTarget: { label: 'A', minX: 10, minY: 10, maxX: 20, maxY: 20 },
    },
    explanation: '',
    createdAt: '',
    updatedAt: '',
  };
  const q2: Question = {
    ...q1,
    id: 'q2',
    payload: {
      imageUrl: newUrl,
      imageAlt: 'Ảnh mới',
      hotspotTarget: { label: 'B', minX: 10, minY: 10, maxX: 20, maxY: 20 },
    },
  };
  const q3SameAsQ1: Question = {
    ...q1,
    id: 'q3',
  };

  // Batch deleting q1 & q2 deletes both paths when no remaining question uses them
  assert.deepEqual(collectHotspotStoragePathsToDelete([q1, q2], []), [
    'questions/111_old.png',
    'questions/222_new.webp',
  ]);
  // If another remaining question still references oldUrl, keep oldUrl
  assert.deepEqual(
    collectHotspotStoragePathsToDelete([q1, q2], [q3SameAsQ1]),
    ['questions/222_new.webp']
  );
});

test('resolveToastVariant classifies success, warning, error, and info accurately', () => {
  assert.equal(
    resolveToastVariant('Đã thêm câu hỏi mới vào phần kiến thức.', false),
    'success'
  );
  assert.equal(
    resolveToastVariant('Đã tạm tắt tự động đồng bộ Supabase cho Ngân hàng Câu hỏi.', false),
    'info'
  );
  assert.equal(
    resolveToastVariant('Đã sao chép kịch bản PostgreSQL DDL vào bộ nhớ tạm.', false),
    'info'
  );
  assert.equal(
    resolveToastVariant('Đã lưu cục bộ Câu 1, nhưng lỗi đồng bộ Supabase: timeout', true),
    'warning'
  );
  assert.equal(
    resolveToastVariant('Vui lòng chọn ít nhất 1 câu hỏi để tạo bộ đề.', true),
    'warning'
  );
  assert.equal(
    resolveToastVariant('Không thể kết nối máy chủ Supabase.', true),
    'error'
  );
  assert.equal(resolveToastVariant('Thông báo tùy chỉnh', 'warning'), 'warning');
  assert.equal(resolveToastVariant('Thông báo tùy chỉnh', 'info'), 'info');
});

test('normalizeAdminRole and getTeacherPermissions enforce 3 cross-school tiers', () => {
  assert.equal(normalizeAdminRole('super_admin'), 'master');
  assert.equal(normalizeAdminRole('teacher'), 'teacher_lv1');
  assert.equal(normalizeAdminRole('teacher_lv2'), 'teacher_lv2');
  assert.equal(normalizeAdminRole('master'), 'master');

  const lv1 = getTeacherPermissions('teacher_lv1');
  assert.equal(lv1.canAccessAllSchools, true);
  assert.equal(lv1.canAssignClassTasks, true);
  assert.equal(lv1.canEditQuestionBank, false);
  assert.equal(lv1.canHostBattle, false);
  assert.equal(lv1.canManageSchools, false);
  assert.equal(lv1.canManageTeachers, false);
  assert.equal(lv1.canManageSupabase, false);

  const lv2 = getTeacherPermissions('teacher_lv2');
  assert.equal(lv2.canAccessAllSchools, true);
  assert.equal(lv2.canAssignClassTasks, true);
  assert.equal(lv2.canEditQuestionBank, true);
  assert.equal(lv2.canHostBattle, true);
  assert.equal(lv2.canManageSchools, false);
  assert.equal(lv2.canManageTeachers, false);
  assert.equal(lv2.canManageSupabase, false);

  const master = getTeacherPermissions('master');
  assert.equal(master.canAccessAllSchools, true);
  assert.equal(master.canAssignClassTasks, true);
  assert.equal(master.canEditQuestionBank, true);
  assert.equal(master.canHostBattle, true);
  assert.equal(master.canManageSchools, true);
  assert.equal(master.canManageTeachers, true);
  assert.equal(master.canManageSupabase, true);
});

test('canDeleteOrDemoteMaster protects the last Master account', () => {
  const oneMaster = [
    { userId: 'u1', role: 'master' },
    { userId: 'u2', role: 'teacher_lv2' },
  ];
  assert.equal(canDeleteOrDemoteMaster(oneMaster, 'u1').ok, false);
  assert.equal(canDeleteOrDemoteMaster(oneMaster, 'u1', 'teacher_lv2').ok, false);
  assert.equal(canDeleteOrDemoteMaster(oneMaster, 'u2').ok, true);

  const twoMasters = [
    { userId: 'u1', role: 'master' },
    { userId: 'u2', role: 'master' },
  ];
  assert.equal(canDeleteOrDemoteMaster(twoMasters, 'u1').ok, true);
  assert.equal(canDeleteOrDemoteMaster(twoMasters, 'u1', 'teacher_lv1').ok, true);
});

test('filterTeachers and summarizeTeachersByRole accurately count and filter across all 3 tiers', () => {
  const sample = [
    { userId: '1', fullName: 'Thầy Minh', email: 'minh@ic3.vn', role: 'master' },
    { userId: '2', fullName: 'Cô Lan', email: 'lan@ic3.vn', role: 'teacher_lv2' },
    { userId: '3', fullName: 'Cô Hà', email: 'ha@ic3.vn', role: 'teacher_lv1' },
    { userId: '4', fullName: 'Thầy Nam (cũ)', email: 'nam@ic3.vn', role: 'teacher' },
  ];

  const summary = summarizeTeachersByRole(sample);
  assert.deepEqual(summary, {
    teacher_lv1: 2,
    teacher_lv2: 1,
    master: 1,
    total: 4,
  });

  assert.equal(filterTeachers(sample, '', 'all').length, 4);
  assert.equal(filterTeachers(sample, '', 'teacher_lv1').length, 2);
  assert.equal(filterTeachers(sample, 'lan@', 'all').length, 1);
  assert.equal(filterTeachers(sample, 'minh', 'teacher_lv2').length, 0);
});

test('normalizeTeacherStatus, summarizeTeacherStatuses, status filter, and last-active-Master lock guard work accurately', () => {
  assert.equal(normalizeTeacherStatus(undefined), 'active');
  assert.equal(normalizeTeacherStatus('locked'), 'locked');

  const sample = [
    { userId: 'u1', fullName: 'Thầy Minh', email: 'm@ic3.vn', role: 'master', status: 'active' },
    { userId: 'u2', fullName: 'Cô Anh', email: 'a@ic3.vn', role: 'teacher_lv2', status: 'locked' },
    { userId: 'u3', fullName: 'Cô Hà', email: 'h@ic3.vn', role: 'teacher_lv1' },
  ];

  assert.deepEqual(summarizeTeacherStatuses(sample), {
    active: 2,
    locked: 1,
    total: 3,
  });

  assert.equal(filterTeachers(sample, '', 'all', 'active').length, 2);
  assert.equal(filterTeachers(sample, '', 'all', 'locked').length, 1);
  assert.equal(filterTeachers(sample, '', 'teacher_lv2', 'locked').length, 1);

  // Locking the only active Master account must be rejected
  assert.equal(canDeleteOrDemoteMaster(sample, 'u1', 'master', 'locked').ok, false);
  assert.equal(canDeleteOrDemoteMaster(sample, 'u2', 'teacher_lv2', 'active').ok, true);
});

test('getTeacherPermissionDetails returns accurate 7-item permission breakdown per role', () => {
  const lv1 = getTeacherPermissionDetails('teacher_lv1');
  const lv2 = getTeacherPermissionDetails('teacher_lv2');
  const master = getTeacherPermissionDetails('master');

  assert.equal(lv1.length, 7);
  assert.equal(lv1.filter((p) => p.allowed).length, 3);
  assert.equal(lv2.filter((p) => p.allowed).length, 5);
  assert.equal(master.filter((p) => p.allowed).length, 7);
});

test('buildAdminTeachersSupabasePayload, mapSupabaseRowToAdminTeacher, and mergeRemoteTeachersWithLocal sync teachers accurately', () => {
  const local = [
    {
      userId: 'teacher_admin_01',
      fullName: 'Nguyễn Quản Trị (Master)',
      email: 'ADMIN@ic3master.edu.vn ',
      password: 'scrypt$salt$hash',
      role: 'master' as const,
      status: 'active' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const payload = buildAdminTeachersSupabasePayload(local);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].email, 'admin@ic3master.edu.vn');
  assert.equal(payload[0].password_hash, 'scrypt$salt$hash');
  assert.equal(payload[0].role, 'master');
  assert.equal(payload[0].status, 'active');

  const mapped = mapSupabaseRowToAdminTeacher({
    user_id: 'remote_u2',
    full_name: 'Cô Lan',
    email: 'lan@ic3.vn',
    password_hash: 'scrypt$s2$h2',
    role: 'teacher_lv2',
    status: 'locked',
    created_at: '2026-02-01T00:00:00.000Z',
  });
  assert.ok(mapped);
  assert.equal(mapped.role, 'teacher_lv2');
  assert.equal(mapped.status, 'locked');

  const { merged, addedCount, updatedCount } = mergeRemoteTeachersWithLocal(local, [
    {
      user_id: 'uuid-remote-admin',
      full_name: 'Nguyễn Quản Trị Cập Nhật',
      email: 'admin@ic3master.edu.vn',
      password_hash: '',
      role: 'master',
      status: 'active',
    },
    {
      user_id: 'remote_u2',
      full_name: 'Cô Lan',
      email: 'lan@ic3.vn',
      password_hash: 'scrypt$s2$h2',
      role: 'teacher_lv2',
      status: 'locked',
    },
  ]);

  assert.equal(addedCount, 1);
  assert.equal(updatedCount, 1);
  assert.equal(merged.length, 2);
  // Preserves local userId stability and local password hash when remote password_hash is empty
  assert.equal(merged[0].userId, 'teacher_admin_01');
  assert.equal(merged[0].password, 'scrypt$salt$hash');
  assert.equal(merged[0].fullName, 'Nguyễn Quản Trị Cập Nhật');
  assert.equal(merged[1].status, 'locked');
});

test('isSafeRemoteSupabaseUrl accepts public HTTPS URLs and blocks loopback or private network targets', () => {
  assert.equal(isSafeRemoteSupabaseUrl('https://xyzproject.supabase.co'), true);
  assert.equal(isSafeRemoteSupabaseUrl('http://localhost:54321'), false);
  assert.equal(isSafeRemoteSupabaseUrl('http://127.0.0.1:8000'), false);
  assert.equal(isSafeRemoteSupabaseUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafeRemoteSupabaseUrl('http://10.0.0.5'), false);
  assert.equal(isSafeRemoteSupabaseUrl('http://192.168.1.10'), false);
  assert.equal(isSafeRemoteSupabaseUrl('http://172.16.0.1'), false);
  assert.equal(isSafeRemoteSupabaseUrl('javascript:alert(1)'), false);
  assert.equal(isSafeRemoteSupabaseUrl(''), false);
});

