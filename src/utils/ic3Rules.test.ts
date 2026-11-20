import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuestionBankSupabasePayload,
  buildReorderedPartUpdates,
  calculateIC3Score,
  evaluateTaskCompletion,
  formatQuestionOrderSummary,
  formatSubmissionsToCsv,
  formatSupabaseLoadingStatus,
  getNextTopicOrder,
  getPartQuestionsSorted,
  gradeQuestion,
  isPassingIC3Score,
  isStudentBreakUnlocked,
  normalizeVietnamesePassword,
  parseStudentsCsv,
  pickQuestionsBySelectedIds,
  rankBattleParticipants,
  sliceQuestionsByOrderRange,
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
    difficulty: 'medium' as const,
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
    difficulty: 'easy',
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
        difficulty: 'easy',
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
    difficulty: 'easy',
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

