import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AdminDatabase } from '../src/types/ic3';
import type { SafeTeacher } from '../src/utils/api';

let server: http.Server;
let baseUrl = '';
let masterToken = '';
let lv1Token = '';

const tmpDbDir = path.join(os.tmpdir(), 'ic3_admin_data');

async function apiFetch<T>(
  route: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${route}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T;
  return { status: res.status, data };
}

before(async () => {
  // Isolate local store into os.tmpdir() (simulating Vercel serverless FS) and clear remote env vars
  process.env.VERCEL = '1';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  if (fs.existsSync(tmpDbDir)) {
    fs.rmSync(tmpDbDir, { recursive: true, force: true });
  }

  const { createApp } = await import('./app');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      assert(addr && typeof addr !== 'string');
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const masterLogin = await apiFetch<{ token: string; teacher: SafeTeacher }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: { email: 'admin@ic3master.edu.vn', password: 'admin123' },
    }
  );
  assert.equal(masterLogin.status, 200);
  assert(masterLogin.data.token);
  masterToken = masterLogin.data.token;

  const lv1Login = await apiFetch<{ token: string; teacher: SafeTeacher }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: { email: 'giangday.lv1@ic3master.edu.vn', password: 'teacher123' },
    }
  );
  assert.equal(lv1Login.status, 200);
  assert(lv1Login.data.token);
  lv1Token = lv1Login.data.token;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (fs.existsSync(tmpDbDir)) {
    fs.rmSync(tmpDbDir, { recursive: true, force: true });
  }
});

test('health endpoint reports serverless/local persistence state cleanly', async () => {
  const { status, data } = await apiFetch<{
    ok: boolean;
    envConfigured: boolean;
    supabaseConfigured: boolean;
    persistence: string;
  }>('/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.envConfigured, false);
  assert.equal(data.supabaseConfigured, false);
  assert.equal(data.persistence, 'local');
});

test('authentication guards reject unauthenticated and invalid logins', async () => {
  const unauth = await apiFetch<{ error: string }>('/api/bootstrap');
  assert.equal(unauth.status, 401);

  const wrongPw = await apiFetch<{ error: string }>('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@ic3master.edu.vn', password: 'wrong-password' },
  });
  assert.equal(wrongPw.status, 401);
});

test('bootstrap scopes teachers to master and strips password hashes', async () => {
  const masterRes = await apiFetch<
    Omit<AdminDatabase, 'teachers'> & {
      teachers: Array<SafeTeacher & { password?: string }>;
    }
  >('/api/bootstrap', { token: masterToken });
  assert.equal(masterRes.status, 200);
  assert(masterRes.data.teachers.length >= 3);
  for (const t of masterRes.data.teachers) {
    assert.equal(t.password, undefined);
  }

  const lv1Res = await apiFetch<AdminDatabase>('/api/bootstrap', {
    token: lv1Token,
  });
  assert.equal(lv1Res.status, 200);
  assert.equal(lv1Res.data.teachers.length, 0);

  const forbiddenSchool = await apiFetch<{ error: string }>('/api/schools', {
    method: 'POST',
    token: lv1Token,
    body: { name: 'Forbidden School', district: 'Q1' },
  });
  assert.equal(forbiddenSchool.status, 403);

  const forbiddenModule = await apiFetch<{ error: string }>('/api/modules', {
    method: 'POST',
    token: lv1Token,
    body: { code: 'mod_forbidden', level: 'LV1', title: 'Test' },
  });
  assert.equal(forbiddenModule.status, 403);
});

test('SSRF protection blocks private Supabase URLs on test/seed endpoints', async () => {
  const ssrfRes = await apiFetch<{ error?: string }>('/api/supabase/test', {
    method: 'POST',
    token: masterToken,
    headers: {
      'X-Supabase-Url': 'http://127.0.0.1:54321',
      'X-Supabase-Anon-Key': 'fake-anon-key',
    },
  });
  assert.equal(ssrfRes.status, 400);
  assert(ssrfRes.data.error);
});

test('Schools -> Classes -> Students full CRUD & cascade delete', async () => {
  const schoolRes = await apiFetch<{ id: string; name: string }>('/api/schools', {
    method: 'POST',
    token: masterToken,
    body: { name: 'THCS Kiểm Thử', district: 'Quận 1' },
  });
  assert.equal(schoolRes.status, 201);
  const schoolId = schoolRes.data.id;

  const classRes = await apiFetch<{ id: string; schoolId: string }>(
    '/api/classes',
    {
      method: 'POST',
      token: lv1Token,
      body: { schoolId, name: '6A9', grade: 'Khối 6' },
    }
  );
  assert.equal(classRes.status, 201);
  const classId = classRes.data.id;

  const batchClassRes = await apiFetch<{
    created: Array<{ id: string; name: string; grade: string }>;
    skipped: string[];
  }>('/api/classes/batch', {
    method: 'POST',
    token: lv1Token,
    body: {
      schoolId,
      rows: [
        { name: '6A9', grade: 'Khối 6' }, // duplicate
        { name: '7A5', grade: '7' },
        { name: '8A2', grade: '' },
      ],
    },
  });
  assert.equal(batchClassRes.status, 201);
  assert.deepEqual(batchClassRes.data.skipped, ['6A9']);
  assert.equal(batchClassRes.data.created.length, 2);
  assert.equal(batchClassRes.data.created[0].grade, 'Khối 7');
  assert.equal(batchClassRes.data.created[1].grade, 'Khối 8');

  const batchRes = await apiFetch<{
    created: Array<{
      id: string;
      studentCode: string;
      passwordHash: string;
      alwaysBreakReady: boolean;
    }>;
    skipped: string[];
  }>('/api/students/batch', {
    method: 'POST',
    token: lv1Token,
    body: {
      classId,
      rows: [
        { fullName: 'Nguyễn Minh An', alwaysBreakReady: true },
        { fullName: 'Trần Thị Bình' },
      ],
    },
  });
  assert.equal(batchRes.status, 201);
  assert.equal(batchRes.data.created.length, 2);
  assert.equal(batchRes.data.created[0].studentCode, '6A9-01');
  assert.equal(batchRes.data.created[0].passwordHash, 'nguyenminhan');
  assert.equal(batchRes.data.created[0].alwaysBreakReady, false);
  assert.equal(batchRes.data.created[1].studentCode, '6A9-02');
  assert.equal(batchRes.data.created[1].alwaysBreakReady, false);

  const delSchool = await apiFetch<{ ok: boolean }>(`/api/schools/${schoolId}`, {
    method: 'DELETE',
    token: masterToken,
  });
  assert.equal(delSchool.status, 200);

  const dbAfter = await apiFetch<AdminDatabase>('/api/bootstrap', {
    token: masterToken,
  });
  assert.equal(
    dbAfter.data.schools.some((s) => s.id === schoolId),
    false
  );
  assert.equal(
    dbAfter.data.classes.some((c) => c.id === classId),
    false
  );
});

test('Question Bank 4-tier CRUD, QuestionSet membership & batch deletion', async () => {
  const modRes = await apiFetch<{ id: string; code: string }>('/api/modules', {
    method: 'POST',
    token: masterToken,
    body: {
      code: 'custom_test_mod',
      level: 'LV4',
      title: 'Test Module',
      description: 'Desc',
    },
  });
  assert.equal(modRes.status, 201);

  const catRes = await apiFetch<{
    id: string;
    code: string;
    isEnabled: boolean;
  }>('/api/knowledge-categories', {
    method: 'POST',
    token: masterToken,
    body: {
      module: 'custom_test_mod',
      code: 'TCAT',
      title: 'Test Cat',
      description: 'Cat desc',
      isEnabled: false,
    },
  });
  assert.equal(catRes.status, 201);
  assert.equal(catRes.data.isEnabled, false);

  // teacher_lv1 cannot toggle readiness
  const lv1Toggle = await apiFetch<{ error: string }>(
    `/api/knowledge-categories/${catRes.data.id}`,
    {
      method: 'PUT',
      token: lv1Token,
      body: { isEnabled: true },
    }
  );
  assert.equal(lv1Toggle.status, 403);

  // Master can toggle isEnabled on/off without re-sending title
  const enableCatRes = await apiFetch<{ id: string; isEnabled: boolean }>(
    `/api/knowledge-categories/${catRes.data.id}`,
    {
      method: 'PUT',
      token: masterToken,
      body: { isEnabled: true },
    }
  );
  assert.equal(enableCatRes.status, 200);
  assert.equal(enableCatRes.data.isEnabled, true);

  const disableCatRes = await apiFetch<{ id: string; isEnabled: boolean }>(
    `/api/knowledge-categories/${catRes.data.id}`,
    {
      method: 'PUT',
      token: masterToken,
      body: { isEnabled: false },
    }
  );
  assert.equal(disableCatRes.status, 200);
  assert.equal(disableCatRes.data.isEnabled, false);

  const partRes = await apiFetch<{ id: string; code: string }>(
    '/api/knowledge-parts',
    {
      method: 'POST',
      token: masterToken,
      body: {
        module: 'custom_test_mod',
        level: 'LV4',
        category: 'TCAT',
        code: 'TCAT1',
        title: 'Test Part 1',
        description: 'Part desc',
      },
    }
  );
  assert.equal(partRes.status, 201);

  const q1 = await apiFetch<{ id: string; topicOrder: number }>('/api/questions', {
    method: 'POST',
    token: masterToken,
    body: {
      module: 'custom_test_mod',
      level: 'LV4',
      category: 'TCAT',
      contentCode: 'TCAT1',
      type: 'single',
      prompt: 'Câu hỏi kiểm thử 1?',
      payload: {
        options: [
          { id: 'a', text: 'Đáp án A' },
          { id: 'b', text: 'Đáp án B' },
        ],
        correctOptionId: 'a',
      },
      explanation: 'Giải thích',
    },
  });
  assert.equal(q1.status, 201);
  assert.equal(q1.data.topicOrder, 1);

  const setRes = await apiFetch<{ id: string; questionIds: string[] }>(
    '/api/question-sets',
    {
      method: 'POST',
      token: masterToken,
      body: {
        title: 'Bộ đề kiểm thử',
        description: 'Mô tả',
        questionIds: [q1.data.id],
      },
    }
  );
  assert.equal(setRes.status, 201);

  const batchDel = await apiFetch<{ ok: boolean }>('/api/questions/batch-delete', {
    method: 'POST',
    token: masterToken,
    body: { ids: [q1.data.id] },
  });
  assert.equal(batchDel.status, 200);

  const dbAfter = await apiFetch<AdminDatabase>('/api/bootstrap', {
    token: masterToken,
  });
  const setAfter = dbAfter.data.questionSets.find((s) => s.id === setRes.data.id);
  assert(setAfter);
  assert.deepEqual(setAfter.questionIds, []);

  // Clean up test records in dependency order
  await apiFetch(`/api/question-sets/${setRes.data.id}`, {
    method: 'DELETE',
    token: masterToken,
  });
  await apiFetch(`/api/knowledge-parts/${partRes.data.id}`, {
    method: 'DELETE',
    token: masterToken,
  });
  await apiFetch(`/api/knowledge-categories/${catRes.data.id}`, {
    method: 'DELETE',
    token: masterToken,
  });
  await apiFetch(`/api/modules/${modRes.data.id}`, {
    method: 'DELETE',
    token: masterToken,
  });
});

test('Class tasks + student submission unlocks break state & battle room lifecycle works', async () => {
  const beforeBoot = await apiFetch<AdminDatabase>('/api/bootstrap', {
    token: masterToken,
  });
  const firstClass = beforeBoot.data.classes[0];
  const firstStudent = beforeBoot.data.students.find(
    (s) => s.classId === firstClass.id
  );
  const firstSet = beforeBoot.data.questionSets[0];
  assert(firstClass && firstStudent && firstSet);

  const saveTaskRes = await apiFetch<{ classId: string }>(
    `/api/class-tasks/${firstClass.id}`,
    {
      method: 'PUT',
      token: lv1Token,
      body: {
        assignmentTitle: 'Kiểm tra nhanh',
        teacherName: 'Cô Test',
        breakRewardMinutes: 15,
        tasks: [
          {
            id: 'task_test_only',
            classId: firstClass.id,
            orderIndex: 1,
            title: 'Nhiệm vụ duy nhất',
            description: 'Mô tả',
            level: 'LV1',
            category: 'GM',
            contentCode: 'GM1',
            moduleFilter: 'computing_fundamentals',
            quizMode: 'practice',
            questionIds: beforeBoot.data.questions.slice(0, 2).map((q) => q.id),
            estimatedMinutes: 5,
            requiredAttempts: 1,
            minScore: 600,
          },
        ],
      },
    }
  );
  assert.equal(saveTaskRes.status, 200);

  const submitRes = await apiFetch<{
    score: number;
    metMinScore: boolean;
  }>('/api/submissions', {
    method: 'POST',
    token: lv1Token,
    body: {
      studentId: firstStudent.id,
      taskId: 'task_test_only',
      correctCount: 2,
      totalCount: 2,
      durationSeconds: 30,
    },
  });
  assert.equal(submitRes.status, 201);
  assert.equal(submitRes.data.metMinScore, true);

  const afterSubBoot = await apiFetch<AdminDatabase>('/api/bootstrap', {
    token: masterToken,
  });
  const breakAfter = afterSubBoot.data.breakStates.find(
    (b) => b.studentId === firstStudent.id
  );
  assert(breakAfter);
  assert.equal(breakAfter.status, 'active');
  assert.equal(breakAfter.totalGrantedSeconds, 900);

  // Battle config + room lifecycle
  const cfgRes = await apiFetch<{ classId: string; isEnabled: boolean }>(
    `/api/battle-configs/${firstClass.id}`,
    {
      method: 'PUT',
      token: masterToken,
      body: {
        isEnabled: true,
        title: 'Đấu trường Test',
        questionSetId: firstSet.id,
        questionSetName: firstSet.title,
        teacherName: 'Master',
        moduleFilter: 'all',
        questionIds: firstSet.questionIds.slice(0, 3),
        fastComboWindowSeconds: 5,
        topRewardCount: 2,
        breakRewardMinutes: 20,
        timeLimitSeconds: 60,
      },
    }
  );
  assert.equal(cfgRes.status, 200);

  const createRoom = await apiFetch<{ id: string; status: string }>(
    '/api/battle-rooms',
    {
      method: 'POST',
      token: masterToken,
      body: { classId: firstClass.id },
    }
  );
  assert.equal(createRoom.status, 201);
  assert.equal(createRoom.data.status, 'lobby');

  const joinRoom = await apiFetch<{ participants: Array<{ studentId: string }> }>(
    `/api/battle-rooms/${createRoom.data.id}/join`,
    {
      method: 'POST',
      token: masterToken,
      body: { studentId: firstStudent.id },
    }
  );
  assert.equal(joinRoom.status, 200);
  assert(
    joinRoom.data.participants.some((p) => p.studentId === firstStudent.id)
  );

  const startRoom = await apiFetch<{ status: string }>(
    `/api/battle-rooms/${createRoom.data.id}/start`,
    { method: 'POST', token: masterToken }
  );
  assert.equal(startRoom.status, 200);
  assert.equal(startRoom.data.status, 'playing');

  const simStep = await apiFetch<{ events: Array<{ id: string }> }>(
    `/api/battle-rooms/${createRoom.data.id}/simulate-step`,
    { method: 'POST', token: masterToken }
  );
  assert.equal(simStep.status, 200);

  const finishRoom = await apiFetch<{
    status: string;
    rankedResults: Array<{ rank: number }>;
  }>(`/api/battle-rooms/${createRoom.data.id}/finish`, {
    method: 'POST',
    token: masterToken,
  });
  assert.equal(finishRoom.status, 200);
  assert.equal(finishRoom.data.status, 'finished');
  assert(finishRoom.data.rankedResults.length >= 1);

  const resetRoom = await apiFetch<{ status: string }>(
    `/api/battle-rooms/${createRoom.data.id}/reset`,
    { method: 'POST', token: masterToken }
  );
  assert.equal(resetRoom.status, 200);
  assert.equal(resetRoom.data.status, 'lobby');
});

test('security.verifyTeacherPassword safely rejects malformed scrypt hashes without throwing', async () => {
  const { verifyTeacherPassword, hashTeacherPassword } = await import(
    './security.js'
  );
  assert.equal(verifyTeacherPassword('any', ''), false);
  assert.equal(verifyTeacherPassword('any', 'scrypt$salt$'), false);
  assert.equal(verifyTeacherPassword('any', 'scrypt$salt$abc'), false);
  assert.equal(verifyTeacherPassword('any', 'scrypt$salt$zzzz'), false);
  const valid = hashTeacherPassword('matkhau123');
  assert.equal(verifyTeacherPassword('matkhau123', valid), true);
  assert.equal(verifyTeacherPassword('sai', valid), false);
});

test('Express JSON error middleware returns JSON instead of HTML 500 on malformed payloads', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email": broken-json',
  });
  assert.equal(res.status, 400);
  const contentType = res.headers.get('content-type') || '';
  assert(contentType.includes('application/json'));
  const data = (await res.json()) as { error?: string };
  assert(data.error);
});

test('Supabase teacher created directly in admin_teachers (including schema fallback & custom user_id) logs in and bootstraps cleanly', async () => {
  const origFetch = globalThis.fetch;
  const customTeacherRow = {
    user_id: 'sb_custom_teacher_uid_01',
    full_name: 'Cô Giáo Supabase',
    email: 'admin@ic3master.edu.vn', // intentionally shares email with seed master to verify Supabase user_id wins
    password_hash: 'supabase_secret_pw',
    role: 'teacher_lv2',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (urlStr.startsWith('https://mock-ic3-project.supabase.co/')) {
      const parsed = new URL(urlStr);
      // Simulate schema lacking `status` column on explicit select, succeeding on `select=*`
      const selectParam = parsed.searchParams.get('select') || '';
      if (
        parsed.pathname === '/rest/v1/admin_teachers' &&
        selectParam.includes('status')
      ) {
        return new Response(
          JSON.stringify({
            code: '42703',
            message: 'column admin_teachers.status does not exist',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (parsed.pathname === '/rest/v1/admin_teachers') {
        const isHead = (init?.method || 'GET').toUpperCase() === 'HEAD';
        return new Response(isHead ? null : JSON.stringify([customTeacherRow]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Range': '0-0/1',
          },
        });
      }

      if (parsed.pathname.startsWith('/rest/v1/')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Range': '*/0',
          },
        });
      }

      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return origFetch(input, init);
  }) as typeof fetch;

  try {
    const sbHeaders = {
      'X-Supabase-Url': 'https://mock-ic3-project.supabase.co',
      'X-Supabase-Anon-Key': 'mock-anon-key',
    };

    const loginRes = await apiFetch<{
      token: string;
      teacher: SafeTeacher;
      authSource: string;
    }>('/api/auth/login', {
      method: 'POST',
      headers: sbHeaders,
      body: {
        email: 'ADMIN@IC3MASTER.EDU.VN',
        password: 'supabase_secret_pw',
      },
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.authSource, 'supabase');
    assert.equal(loginRes.data.teacher.userId, 'sb_custom_teacher_uid_01');
    assert.equal(loginRes.data.teacher.role, 'teacher_lv2');

    const bootRes = await apiFetch<AdminDatabase>('/api/bootstrap', {
      token: loginRes.data.token,
      headers: sbHeaders,
    });
    assert.equal(bootRes.status, 200);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('api/index normalizeApiUrl restores original /api/* routes across Vercel rewrite modes', async () => {
  const { normalizeApiUrl } = await import('../api/index.js');
  assert.equal(normalizeApiUrl('/api/index?__path=auth/login'), '/api/auth/login');
  assert.equal(
    normalizeApiUrl('/api/auth/login?__path=auth/login'),
    '/api/auth/login'
  );
  assert.equal(
    normalizeApiUrl('/api/index?__path=questions&module=computing_fundamentals'),
    '/api/questions?module=computing_fundamentals'
  );
  assert.equal(normalizeApiUrl('/api/index?__path='), '/api');
  assert.equal(normalizeApiUrl('/api/health'), '/api/health');
});

test('POST /api/question-bank/import-remote enforces role guard and supports merge vs replace modes', async () => {
  const beforeBoot = await apiFetch<AdminDatabase>('/api/bootstrap', {
    token: masterToken,
  });
  const initialCount = beforeBoot.data.questions.length;
  assert(initialCount >= 1);

  const importedQ = {
    id: 'q_api_imported_01',
    module: 'ai_literacy',
    level: 'LV4',
    category: 'AI',
    contentCode: 'AI1',
    topicOrder: 1,
    topic: 'AI Import API',
    type: 'single' as const,
    prompt: 'Câu hỏi nhập qua API?',
    payload: {
      options: [
        { id: 'a', text: 'Đáp án đúng' },
        { id: 'b', text: 'Đáp án sai' },
      ],
      correctOptionId: 'a',
    },
    explanation: '',
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
  };

  // Teacher LV1 is forbidden from importing Question Bank
  const forbiddenRes = await apiFetch<{ error: string }>(
    '/api/question-bank/import-remote',
    {
      method: 'POST',
      token: lv1Token,
      body: { questions: [importedQ], mode: 'merge' },
    }
  );
  assert.equal(forbiddenRes.status, 403);

  // Merge keeps existing questions and synthesizes new module/category/part
  const mergeRes = await apiFetch<{
    ok: boolean;
    counts: { questions: number; modules: number };
  }>('/api/question-bank/import-remote', {
    method: 'POST',
    token: masterToken,
    body: {
      questions: [importedQ],
      mode: 'merge',
    },
  });
  assert.equal(mergeRes.status, 200);
  assert.equal(mergeRes.data.ok, true);
  assert.equal(mergeRes.data.counts.questions, initialCount + 1);

  // Replace swaps questions cleanly with imported list
  const replaceRes = await apiFetch<{
    ok: boolean;
    counts: { questions: number; questionSets: number };
  }>('/api/question-bank/import-remote', {
    method: 'POST',
    token: masterToken,
    body: {
      modules: [
        {
          id: 'mod_ai_lit',
          code: 'ai_literacy',
          level: 'LV4',
          title: 'AI Literacy',
          description: '',
          orderIndex: 1,
        },
      ],
      knowledgeCategories: [
        {
          id: 'cat_ai_lit',
          module: 'ai_literacy',
          code: 'AI',
          title: 'AI Cơ bản',
          description: '',
          orderIndex: 1,
          isEnabled: true,
        },
      ],
      knowledgeParts: [
        {
          id: 'part_ai1',
          module: 'ai_literacy',
          level: 'LV4',
          category: 'AI',
          code: 'AI1',
          title: 'Khái niệm AI',
          description: '',
          orderIndex: 1,
          isEnabled: true,
        },
      ],
      questions: [importedQ],
      questionSets: [],
      mode: 'replace',
    },
  });
  assert.equal(replaceRes.status, 200);
  assert.equal(replaceRes.data.counts.questions, 1);
  assert.equal(replaceRes.data.counts.questionSets, 0);
});

test('knowledge parts API persists isEnabled on create, supports partial readiness toggle, and enforces RBAC', async () => {
  const createDisabledRes = await apiFetch<{
    id: string;
    code: string;
    isEnabled: boolean;
  }>('/api/knowledge-parts', {
    method: 'POST',
    token: masterToken,
    body: {
      module: 'ai_literacy',
      level: 'LV4',
      category: 'AI',
      code: 'OT9',
      title: 'Phần OT9 — Chuyên đề thử nghiệm',
      description: 'Chưa mở cho học sinh',
      isEnabled: false,
    },
  });
  assert.equal(createDisabledRes.status, 201);
  assert.equal(createDisabledRes.data.code, 'OT9');
  assert.equal(createDisabledRes.data.isEnabled, false);

  const createDefaultRes = await apiFetch<{
    id: string;
    code: string;
    isEnabled: boolean;
  }>('/api/knowledge-parts', {
    method: 'POST',
    token: masterToken,
    body: {
      module: 'ai_literacy',
      level: 'LV4',
      category: 'AI',
      code: 'OT10',
      title: 'Phần OT10 — Mặc định mở',
      description: '',
    },
  });
  assert.equal(createDefaultRes.status, 201);
  assert.equal(createDefaultRes.data.isEnabled, true);

  // Partial toggle without sending title
  const enableRes = await apiFetch<{
    id: string;
    title: string;
    isEnabled: boolean;
  }>(`/api/knowledge-parts/${createDisabledRes.data.id}`, {
    method: 'PUT',
    token: masterToken,
    body: { isEnabled: true },
  });
  assert.equal(enableRes.status, 200);
  assert.equal(enableRes.data.isEnabled, true);
  assert.equal(enableRes.data.title, 'Phần OT9 — Chuyên đề thử nghiệm');

  const disableRes = await apiFetch<{
    id: string;
    isEnabled: boolean;
  }>(`/api/knowledge-parts/${createDisabledRes.data.id}`, {
    method: 'PUT',
    token: masterToken,
    body: { isEnabled: false },
  });
  assert.equal(disableRes.status, 200);
  assert.equal(disableRes.data.isEnabled, false);

  // teacher_lv1 is read-only and must receive 403
  const forbiddenRes = await apiFetch<{ error: string }>(
    `/api/knowledge-parts/${createDisabledRes.data.id}`,
    {
      method: 'PUT',
      token: lv1Token,
      body: { isEnabled: true },
    }
  );
  assert.equal(forbiddenRes.status, 403);

  // Verify persisted via bootstrap
  const bootRes = await apiFetch<AdminDatabase>('/api/bootstrap', {
    token: masterToken,
  });
  assert.equal(bootRes.status, 200);
  const ot9 = bootRes.data.knowledgeParts.find((p) => p.code === 'OT9');
  const ot10 = bootRes.data.knowledgeParts.find((p) => p.code === 'OT10');
  assert.equal(ot9?.isEnabled, false);
  assert.equal(ot10?.isEnabled, true);
});

test('POST /api/knowledge-parts/batch-readiness toggles all parts in a category without affecting other categories and enforces RBAC', async () => {
  // Create a sibling category part that must stay untouched
  const otherCatPartRes = await apiFetch<{ id: string; isEnabled: boolean }>(
    '/api/knowledge-parts',
    {
      method: 'POST',
      token: masterToken,
      body: {
        module: 'ai_literacy',
        level: 'LV4',
        category: 'OTHER',
        code: 'OTH1',
        title: 'Phần nhóm khác',
        description: '',
        isEnabled: true,
      },
    }
  );
  assert.equal(otherCatPartRes.status, 201);

  // RBAC check: teacher_lv1 receives 403
  const lv1Res = await apiFetch<{ error: string }>(
    '/api/knowledge-parts/batch-readiness',
    {
      method: 'POST',
      token: lv1Token,
      body: {
        module: 'ai_literacy',
        level: 'LV4',
        category: 'AI',
        isEnabled: false,
      },
    }
  );
  assert.equal(lv1Res.status, 403);

  // Invalid body returns 400
  const badRes = await apiFetch<{ error: string }>(
    '/api/knowledge-parts/batch-readiness',
    {
      method: 'POST',
      token: masterToken,
      body: { module: 'ai_literacy', category: 'AI' },
    }
  );
  assert.equal(badRes.status, 400);

  // Disable all parts in ai_literacy / AI (including virtual part OT11)
  const disableAllRes = await apiFetch<{
    ok: boolean;
    updatedCount: number;
    isEnabled: boolean;
    parts: Array<{ code: string; isEnabled: boolean }>;
  }>('/api/knowledge-parts/batch-readiness', {
    method: 'POST',
    token: masterToken,
    body: {
      module: 'ai_literacy',
      level: 'LV4',
      category: 'AI',
      isEnabled: false,
      virtualParts: [{ code: 'OT11', title: 'Phần OT11 ảo' }],
    },
  });
  assert.equal(disableAllRes.status, 200);
  assert.equal(disableAllRes.data.ok, true);
  assert.equal(disableAllRes.data.isEnabled, false);
  assert.ok(disableAllRes.data.updatedCount >= 4);
  assert.equal(
    disableAllRes.data.parts.every((p) => p.isEnabled === false),
    true
  );

  // Enable all parts in ai_literacy / AI
  const enableAllRes = await apiFetch<{
    ok: boolean;
    updatedCount: number;
    isEnabled: boolean;
    parts: Array<{ code: string; isEnabled: boolean }>;
  }>('/api/knowledge-parts/batch-readiness', {
    method: 'POST',
    token: masterToken,
    body: {
      module: 'ai_literacy',
      level: 'LV4',
      category: 'AI',
      isEnabled: true,
    },
  });
  assert.equal(enableAllRes.status, 200);
  assert.equal(enableAllRes.data.isEnabled, true);
  assert.equal(
    enableAllRes.data.parts.every((p) => p.isEnabled === true),
    true
  );

  // Confirm OTHER category remained enabled after disable-all, and AI parts are enabled
  const bootRes = await apiFetch<AdminDatabase>('/api/bootstrap', {
    token: masterToken,
  });
  assert.equal(bootRes.status, 200);
  const aiParts = bootRes.data.knowledgeParts.filter(
    (p) => p.module === 'ai_literacy' && p.category === 'AI'
  );
  const otherPart = bootRes.data.knowledgeParts.find((p) => p.code === 'OTH1');
  assert.ok(aiParts.some((p) => p.code === 'OT11'));
  assert.equal(
    aiParts.every((p) => p.isEnabled === true),
    true
  );
  assert.equal(otherPart?.isEnabled, true);
});





