import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildQuestionBankSupabasePayload,
  type SupabasePendingTask,
} from './ic3Rules';
import {
  CATEGORY_LABELS,
  MODULE_LABELS,
  type AdminDatabase,
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
} from '../types/ic3';

const STORAGE_URL_KEY = 'ic3_admin_supabase_url';
const STORAGE_ANON_KEY = 'ic3_admin_supabase_anon_key';
const STORAGE_QB_LIVE_KEY = 'ic3_admin_supabase_qb_live';

export interface SupabaseSettings {
  url: string;
  anonKey: string;
}

export interface SupabaseTableCheck {
  table: string;
  label: string;
  ok: boolean;
  remoteCount: number | null;
  localCount: number | null;
  error?: string;
}

export interface SupabaseConnectionReport {
  ok: boolean;
  message: string;
  latencyMs?: number;
  tablesChecked: number;
  readyTables: number;
  tableChecks: SupabaseTableCheck[];
}

export interface SupabaseRemoteSample {
  ok: boolean;
  message: string;
  parts: Array<{
    id: string;
    level: string;
    category: string;
    code: string;
    title: string;
  }>;
  questions: Array<{
    id: string;
    level: string;
    category: string;
    content_code: string;
    topic_order: number;
    type: string;
    prompt: string;
  }>;
}

export function getSavedSupabaseSettings(): SupabaseSettings {
  if (typeof window === 'undefined') {
    return { url: '', anonKey: '' };
  }
  return {
    url: window.localStorage.getItem(STORAGE_URL_KEY) ?? '',
    anonKey: window.localStorage.getItem(STORAGE_ANON_KEY) ?? '',
  };
}

export function saveSupabaseSettings(settings: SupabaseSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_URL_KEY, settings.url.trim());
  window.localStorage.setItem(STORAGE_ANON_KEY, settings.anonKey.trim());
}

export function clearSupabaseSettings(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_URL_KEY);
  window.localStorage.removeItem(STORAGE_ANON_KEY);
  window.localStorage.removeItem(STORAGE_QB_LIVE_KEY);
}

export function isSupabaseConfigured(settings?: SupabaseSettings): boolean {
  const s = settings ?? getSavedSupabaseSettings();
  return Boolean(s.url.trim() && s.anonKey.trim());
}

export function getQuestionBankSupabaseEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (!isSupabaseConfigured()) return false;
  const saved = window.localStorage.getItem(STORAGE_QB_LIVE_KEY);
  return saved === null ? true : saved === 'true';
}

export function setQuestionBankSupabaseEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_QB_LIVE_KEY, enabled ? 'true' : 'false');
}

let cachedClientKey = '';
let cachedClient: SupabaseClient | null = null;

let nextSupabaseTaskId = 1;
let activeSupabaseTasks: SupabasePendingTask[] = [];
const supabaseActivityListeners = new Set<(tasks: SupabasePendingTask[]) => void>();

function notifySupabaseActivity(): void {
  const snapshot = [...activeSupabaseTasks];
  for (const listener of supabaseActivityListeners) {
    listener(snapshot);
  }
}

export function getActiveSupabaseTasks(): SupabasePendingTask[] {
  return [...activeSupabaseTasks];
}

export function subscribeSupabaseActivity(
  listener: (tasks: SupabasePendingTask[]) => void
): () => void {
  supabaseActivityListeners.add(listener);
  listener([...activeSupabaseTasks]);
  return () => {
    supabaseActivityListeners.delete(listener);
  };
}

async function trackSupabaseCall<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const id = nextSupabaseTaskId++;
  activeSupabaseTasks = [...activeSupabaseTasks, { id, label }];
  notifySupabaseActivity();
  try {
    return await fn();
  } finally {
    activeSupabaseTasks = activeSupabaseTasks.filter((t) => t.id !== id);
    notifySupabaseActivity();
  }
}

export function runTrackedSupabaseActivity<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  return trackSupabaseCall(label, fn);
}

export function createBrowserSupabaseClient(
  settings: SupabaseSettings
): SupabaseClient | null {
  const url = settings.url.trim();
  const anonKey = settings.anonKey.trim();
  if (!url || !anonKey) return null;
  const cacheKey = `${url}::${anonKey}`;
  if (cachedClient && cachedClientKey === cacheKey) {
    return cachedClient;
  }
  try {
    cachedClient = createClient(url, anonKey);
    cachedClientKey = cacheKey;
    return cachedClient;
  } catch {
    return null;
  }
}

export async function testSupabaseConnection(
  settings: SupabaseSettings,
  localDb?: AdminDatabase
): Promise<SupabaseConnectionReport> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) {
    return {
      ok: false,
      message: 'Vui lòng nhập đầy đủ Supabase Project URL và Anon Key hợp lệ.',
      tablesChecked: 0,
      readyTables: 0,
      tableChecks: [],
    };
  }

  const totalTasks =
    localDb?.classTaskConfigs.reduce((sum, cfg) => sum + cfg.tasks.length, 0) ?? null;

  const specs: Array<{
    table: string;
    label: string;
    selectCols: string;
    localCount: number | null;
  }> = [
    {
      table: 'schools',
      label: 'Trường học',
      selectCols: 'id',
      localCount: localDb?.schools.length ?? null,
    },
    {
      table: 'classes',
      label: 'Lớp học',
      selectCols: 'id',
      localCount: localDb?.classes.length ?? null,
    },
    {
      table: 'students',
      label: 'Học sinh',
      selectCols: 'id',
      localCount: localDb?.students.length ?? null,
    },
    {
      table: 'admin_teachers',
      label: 'Giáo viên & Phân quyền',
      selectCols: 'user_id',
      localCount: localDb?.teachers?.length ?? null,
    },
    {
      table: 'ic3_modules',
      label: 'Mô-đun IC3 (LV1, LV2...)',
      selectCols: 'id, code, level',
      localCount: localDb?.modules?.length ?? null,
    },
    {
      table: 'knowledge_categories',
      label: 'Nhóm kiến thức (GM, OT...)',
      selectCols: 'id, module, code, is_enabled',
      localCount: localDb?.knowledgeCategories?.length ?? null,
    },
    {
      table: 'knowledge_parts',
      label: 'Phần kiến thức (GM1, OT1...)',
      selectCols: 'id, module, category, code, is_enabled',
      localCount: localDb?.knowledgeParts?.length ?? null,
    },
    {
      table: 'questions',
      label: 'Câu hỏi (kèm content_code & topic_order)',
      selectCols: 'id, content_code, topic_order',
      localCount: localDb?.questions.length ?? null,
    },
    {
      table: 'question_sets',
      label: 'Bộ đề Luyện & Thi đấu',
      selectCols: 'id',
      localCount: localDb?.questionSets.length ?? null,
    },
    {
      table: 'class_task_configs',
      label: 'Cấu hình Bài tập Lớp',
      selectCols: 'class_id',
      localCount: localDb?.classTaskConfigs.length ?? null,
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
      localCount: localDb?.submissions.length ?? null,
    },
    {
      table: 'student_break_states',
      label: 'Trạng thái Giải lao',
      selectCols: 'student_id',
      localCount: localDb?.breakStates.length ?? null,
    },
    {
      table: 'class_battle_configs',
      label: 'Cấu hình Thi đấu Lớp',
      selectCols: 'class_id',
      localCount: localDb?.battleConfigs.length ?? null,
    },
    {
      table: 'battle_rooms',
      label: 'Phòng Thi đấu Realtime',
      selectCols: 'id',
      localCount: localDb?.battleRooms.length ?? null,
    },
  ];

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return trackSupabaseCall('Đang kiểm tra kết nối & lược đồ Supabase...', async () => {
    try {
      const results = await Promise.all(
      specs.map(async (spec): Promise<SupabaseTableCheck> => {
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

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = Math.max(1, Math.round(t1 - t0));
    const readyTables = results.filter((r) => r.ok).length;
    const allReady = readyTables === results.length;

    return {
      ok: allReady,
      latencyMs,
      tablesChecked: results.length,
      readyTables,
      tableChecks: results,
      message: allReady
        ? `Kết nối thành công tới Supabase (${readyTables}/${results.length} bảng sẵn sàng, độ trễ ${latencyMs}ms).`
        : readyTables > 0
          ? `Kết nối được Supabase nhưng mới có ${readyTables}/${results.length} bảng sẵn sàng (${latencyMs}ms). Vui lòng chạy kịch bản SQL cập nhật hoặc kiểm tra quyền RLS.`
          : `Không thể truy cập các bảng trên Supabase: ${results[0]?.error || 'Kiểm tra URL, Anon Key hoặc chạy kịch bản SQL.'}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Không thể kết nối tới Supabase.',
      tablesChecked: specs.length,
      readyTables: 0,
      tableChecks: [],
    };
  }
  });
}

export async function fetchSupabaseSampleQuestions(
  settings: SupabaseSettings
): Promise<SupabaseRemoteSample> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) {
    return {
      ok: false,
      message: 'Vui lòng nhập đầy đủ Supabase Project URL và Anon Key.',
      parts: [],
      questions: [],
    };
  }
  return trackSupabaseCall('Đang đọc thử dữ liệu từ Supabase...', async () => {
  try {
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
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Lỗi đọc dữ liệu từ Supabase.',
      parts: [],
      questions: [],
    };
  }
  });
}

export async function syncLocalDatabaseToSupabase(
  settings: SupabaseSettings,
  db: AdminDatabase
): Promise<{ ok: boolean; message: string }> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) {
    return { ok: false, message: 'Chưa cấu hình Supabase URL và Anon Key.' };
  }
  return trackSupabaseCall('Đang đẩy & đồng bộ toàn bộ dữ liệu lên Supabase...', async () => {
  try {
    if (db.schools.length > 0) {
      const { error } = await client.from('schools').upsert(
        db.schools.map((s) => ({
          id: s.id,
          name: s.name,
          district: s.district,
          created_at: s.createdAt,
        }))
      );
      if (error) throw new Error(`schools: ${error.message}`);
    }

    if (db.classes.length > 0) {
      const { error } = await client.from('classes').upsert(
        db.classes.map((c) => ({
          id: c.id,
          school_id: c.schoolId,
          name: c.name,
          grade: c.grade,
          created_at: c.createdAt,
        }))
      );
      if (error) throw new Error(`classes: ${error.message}`);
    }

    if (db.students.length > 0) {
      const { error } = await client.from('students').upsert(
        db.students.map((st) => ({
          id: st.id,
          class_id: st.classId,
          full_name: st.fullName,
          student_code: st.studentCode,
          password_hash: st.passwordHash,
          is_custom_password: st.isCustomPassword,
          always_break_ready: st.alwaysBreakReady,
          created_at: st.createdAt,
        }))
      );
      if (error) throw new Error(`students: ${error.message}`);
    }

    const qbPayload = buildQuestionBankSupabasePayload({
      modules: db.modules,
      knowledgeCategories: db.knowledgeCategories,
      knowledgeParts: db.knowledgeParts,
      questions: db.questions,
      questionSets: db.questionSets,
    });

    if (qbPayload.modules.length > 0) {
      const { error } = await client
        .from('ic3_modules')
        .upsert(qbPayload.modules, { onConflict: 'code' });
      if (error) throw new Error(`ic3_modules: ${error.message}`);
    }

    if (qbPayload.categories.length > 0) {
      const { error } = await client
        .from('knowledge_categories')
        .upsert(qbPayload.categories, { onConflict: 'module,code' });
      if (error) throw new Error(`knowledge_categories: ${error.message}`);
    }

    if (qbPayload.parts.length > 0) {
      const { error } = await client
        .from('knowledge_parts')
        .upsert(qbPayload.parts, { onConflict: 'module,category,code' });
      if (error) throw new Error(`knowledge_parts: ${error.message}`);
    }

    if (qbPayload.questions.length > 0) {
      const { error } = await client
        .from('questions')
        .upsert(qbPayload.questions, { onConflict: 'id' });
      if (error) throw new Error(`questions: ${error.message}`);
    }

    if (qbPayload.questionSets.length > 0) {
      const { error } = await client
        .from('question_sets')
        .upsert(qbPayload.questionSets, { onConflict: 'id' });
      if (error) throw new Error(`question_sets: ${error.message}`);
    }

    if (db.classTaskConfigs.length > 0) {
      const { error: cfgErr } = await client.from('class_task_configs').upsert(
        db.classTaskConfigs.map((cfg) => ({
          class_id: cfg.classId,
          assignment_title: cfg.assignmentTitle,
          teacher_name: cfg.teacherName,
          break_reward_minutes: cfg.breakRewardMinutes,
          updated_at: cfg.updatedAt,
        }))
      );
      if (cfgErr) throw new Error(`class_task_configs: ${cfgErr.message}`);

      const allTasks = db.classTaskConfigs.flatMap((cfg) => cfg.tasks);
      if (allTasks.length > 0) {
        const { error: taskErr } = await client.from('class_tasks').upsert(
          allTasks.map((t) => ({
            id: t.id,
            class_id: t.classId,
            order_index: t.orderIndex,
            title: t.title,
            description: t.description,
            level: t.level,
            category: t.category,
            content_code: t.contentCode,
            module_filter: t.moduleFilter,
            quiz_mode: t.quizMode,
            question_ids: t.questionIds,
            estimated_minutes: t.estimatedMinutes,
            required_attempts: t.requiredAttempts,
            min_score: t.minScore,
          }))
        );
        if (taskErr) throw new Error(`class_tasks: ${taskErr.message}`);
      }
    }

    if (db.breakStates.length > 0) {
      const { error } = await client.from('student_break_states').upsert(
        db.breakStates.map((b) => ({
          student_id: b.studentId,
          status: b.status,
          total_granted_seconds: b.totalGrantedSeconds,
          remaining_seconds: b.remainingSeconds,
          unlocked_at: b.unlockedAt ?? null,
          expired_at: b.expiredAt ?? null,
          updated_at: b.updatedAt,
        }))
      );
      if (error) throw new Error(`student_break_states: ${error.message}`);
    }

    if (db.battleConfigs.length > 0) {
      const { error } = await client.from('class_battle_configs').upsert(
        db.battleConfigs.map((bc) => ({
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
        }))
      );
      if (error) throw new Error(`class_battle_configs: ${error.message}`);
    }

    const totalTasks = db.classTaskConfigs.reduce((sum, c) => sum + c.tasks.length, 0);
    return {
      ok: true,
      message: `Đã đồng bộ ${db.schools.length} trường, ${db.classes.length} lớp, ${db.students.length} học sinh, ${db.modules?.length ?? 0} mô-đun, ${db.knowledgeCategories?.length ?? 0} nhóm kiến thức, ${db.knowledgeParts?.length ?? 0} phần kiến thức, ${db.questions.length} câu hỏi, ${db.questionSets.length} bộ đề và ${totalTasks} bài tập lớp lên Supabase.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Đồng bộ Supabase thất bại.',
    };
  }
  });
}

export interface SupabaseQuestionBankPullResult {
  ok: boolean;
  message: string;
  modules: IC3ModuleRecord[];
  knowledgeCategories: KnowledgeCategoryRecord[];
  knowledgeParts: KnowledgePart[];
  questions: Question[];
  questionSets: QuestionSet[];
}

function getDefaultLevelForModule(mod: IC3Module): IC3Level {
  if (mod === 'computing_fundamentals') return 'LV1';
  if (mod === 'key_applications') return 'LV2';
  if (mod === 'living_online') return 'LV3';
  return mod.toUpperCase();
}

export async function fetchQuestionBankFromSupabase(
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<SupabaseQuestionBankPullResult> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) {
    return {
      ok: false,
      message: 'Chưa cấu hình Supabase URL và Anon Key hợp lệ.',
      modules: [],
      knowledgeCategories: [],
      knowledgeParts: [],
      questions: [],
      questionSets: [],
    };
  }

  return trackSupabaseCall('Đang tải Ngân hàng Câu hỏi từ Supabase...', async () => {
  try {
    const [modulesRes, categoriesRes, partsRes, questionsRes, setsRes] = await Promise.all([
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
    ]);

    const queryErrors = [
      modulesRes.error ? `ic3_modules: ${modulesRes.error.message}` : null,
      categoriesRes.error ? `knowledge_categories: ${categoriesRes.error.message}` : null,
      partsRes.error ? `knowledge_parts: ${partsRes.error.message}` : null,
      questionsRes.error ? `questions: ${questionsRes.error.message}` : null,
      setsRes.error ? `question_sets: ${setsRes.error.message}` : null,
    ].filter(Boolean);

    if (queryErrors.length > 0) {
      return {
        ok: false,
        message: `Không thể đọc dữ liệu từ Supabase (${queryErrors.join(' | ')}). Hãy chạy lại kịch bản SQL ở mục Kết nối Supabase.`,
        modules: [],
        knowledgeCategories: [],
        knowledgeParts: [],
        questions: [],
        questionSets: [],
      };
    }

    const rawQuestions = Array.isArray(questionsRes.data) ? questionsRes.data : [];
    const partCounters = new Map<string, number>();

    const questions: Question[] = rawQuestions.map((row: Record<string, unknown>) => {
      const mod = (row.module as IC3Module) || 'computing_fundamentals';
      const cat = (row.category as KnowledgeCategory) || 'GM';
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
      return {
        id: String(row.id),
        module: mod,
        level,
        category: cat,
        contentCode,
        topicOrder,
        topic: String(row.topic || 'Tổng hợp'),
        type: (row.type as QuestionType) || 'single',
        prompt: String(row.prompt || ''),
        instruction: row.instruction ? String(row.instruction) : undefined,
        payload: parsedPayload,
        explanation: String(row.explanation || ''),
        tips: row.tips ? String(row.tips) : undefined,
        createdAt: String(row.created_at || now),
        updatedAt: String(row.updated_at || now),
      };
    });

    const rawParts = !partsRes.error && Array.isArray(partsRes.data) ? partsRes.data : [];
    const knowledgeParts: KnowledgePart[] = rawParts.map((p: Record<string, unknown>) => {
      const mod = (p.module as IC3Module) || 'computing_fundamentals';
      const cat = (p.category as KnowledgeCategory) || 'GM';
      return {
        id: String(p.id),
        module: mod,
        level: (p.level as IC3Level) || getDefaultLevelForModule(mod),
        category: cat,
        code: String(p.code || `${cat}1`).trim().toUpperCase(),
        title: String(p.title || `Chuyên đề ${p.code || cat}`),
        description: String(p.description || ''),
        orderIndex: typeof p.order_index === 'number' ? p.order_index : 1,
        isEnabled:
          p.is_enabled === undefined || p.is_enabled === null
            ? true
            : Boolean(p.is_enabled),
      };
    });

    // Synthesize parts from questions if knowledge_parts table is empty/missing
    const existingPartKeys = new Set(
      knowledgeParts.map(
        (p) => `${p.module}:${p.category}:${p.code.trim().toUpperCase()}`
      )
    );
    for (const q of questions) {
      const key = `${q.module}:${q.category}:${q.contentCode.trim().toUpperCase()}`;
      if (!existingPartKeys.has(key)) {
        existingPartKeys.add(key);
        const sameGroupCount = knowledgeParts.filter(
          (p) => p.module === q.module && p.category === q.category
        ).length;
        knowledgeParts.push({
          id: `part_${q.level.toLowerCase()}_${q.contentCode.toLowerCase()}`,
          module: q.module,
          level: q.level,
          category: q.category,
          code: q.contentCode,
          title: q.topic || `Chuyên đề ${q.contentCode}`,
          description: '',
          orderIndex: sameGroupCount + 1,
          isEnabled: true,
        });
      }
    }

    const rawModules =
      !modulesRes.error && Array.isArray(modulesRes.data) ? modulesRes.data : [];
    const modules: IC3ModuleRecord[] = rawModules.map((m: Record<string, unknown>) => {
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

    const seenModuleCodes = new Set(modules.map((m) => m.code));
    for (const item of [...knowledgeParts, ...questions]) {
      if (!seenModuleCodes.has(item.module)) {
        seenModuleCodes.add(item.module);
        const level = item.level || getDefaultLevelForModule(item.module);
        modules.push({
          id: `mod_${level.toLowerCase()}`,
          code: item.module,
          level,
          title: MODULE_LABELS[item.module] || `${item.module} (${level})`,
          description: '',
          orderIndex: modules.length + 1,
        });
      }
    }

    const rawCategories =
      !categoriesRes.error && Array.isArray(categoriesRes.data)
        ? categoriesRes.data
        : [];
    const knowledgeCategories: KnowledgeCategoryRecord[] = rawCategories.map(
      (c: Record<string, unknown>) => {
        const code = String(c.code || 'GM').trim().toUpperCase();
        return {
          id: String(c.id),
          module: String(c.module || 'computing_fundamentals'),
          code,
          title: String(c.title || CATEGORY_LABELS[code]?.name || `Nhóm ${code}`),
          description: String(
            c.description ?? CATEGORY_LABELS[code]?.description ?? ''
          ),
          orderIndex: typeof c.order_index === 'number' ? c.order_index : 1,
          isEnabled:
            c.is_enabled === undefined || c.is_enabled === null
              ? true
              : Boolean(c.is_enabled),
        };
      }
    );

    const seenCategoryKeys = new Set(
      knowledgeCategories.map((c) => `${c.module}:${c.code.toUpperCase()}`)
    );
    for (const item of [...knowledgeParts, ...questions]) {
      const catCode = item.category.trim().toUpperCase();
      const key = `${item.module}:${catCode}`;
      if (!seenCategoryKeys.has(key)) {
        seenCategoryKeys.add(key);
        const sameModCount = knowledgeCategories.filter(
          (c) => c.module === item.module
        ).length;
        knowledgeCategories.push({
          id: `cat_${item.module}_${catCode.toLowerCase()}`,
          module: item.module,
          code: catCode,
          title: CATEGORY_LABELS[catCode]?.name || `Nhóm ${catCode}`,
          description: CATEGORY_LABELS[catCode]?.description || '',
          orderIndex: sameModCount + 1,
          isEnabled: true,
        });
      }
    }

    const rawSets = !setsRes.error && Array.isArray(setsRes.data) ? setsRes.data : [];
    const questionSets: QuestionSet[] = rawSets.map((s: Record<string, unknown>) => {
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
      ok: true,
      message: `Đã lấy ${modules.length} mô-đun, ${knowledgeCategories.length} nhóm, ${knowledgeParts.length} phần, ${questions.length} câu hỏi và ${questionSets.length} bộ đề từ Supabase.`,
      modules,
      knowledgeCategories,
      knowledgeParts,
      questions,
      questionSets,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Không thể lấy dữ liệu Ngân hàng Câu hỏi từ Supabase.',
      modules: [],
      knowledgeCategories: [],
      knowledgeParts: [],
      questions: [],
      questionSets: [],
    };
  }
  });
}

export interface SupabaseQuestionBankPushResult {
  ok: boolean;
  message: string;
  counts: {
    modules: number;
    categories: number;
    parts: number;
    questions: number;
    questionSets: number;
  };
}

export async function pushQuestionBankToSupabase(
  input: {
    modules?: IC3ModuleRecord[];
    knowledgeCategories?: KnowledgeCategoryRecord[];
    knowledgeParts?: KnowledgePart[];
    questions: Question[];
    questionSets: QuestionSet[];
  },
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<SupabaseQuestionBankPushResult> {
  const emptyCounts = {
    modules: 0,
    categories: 0,
    parts: 0,
    questions: 0,
    questionSets: 0,
  };
  const client = createBrowserSupabaseClient(settings);
  if (!client) {
    return {
      ok: false,
      message: 'Chưa cấu hình Supabase URL và Anon Key hợp lệ.',
      counts: emptyCounts,
    };
  }

  return trackSupabaseCall('Đang đẩy Ngân hàng Câu hỏi lên Supabase...', async () => {
  try {
    const payload = buildQuestionBankSupabasePayload(input);

    if (payload.modules.length > 0) {
      const { error } = await client
        .from('ic3_modules')
        .upsert(payload.modules, { onConflict: 'code' });
      if (error) throw new Error(`ic3_modules: ${error.message}`);
    }

    if (payload.categories.length > 0) {
      const { error } = await client
        .from('knowledge_categories')
        .upsert(payload.categories, { onConflict: 'module,code' });
      if (error) throw new Error(`knowledge_categories: ${error.message}`);
    }

    if (payload.parts.length > 0) {
      const { error } = await client
        .from('knowledge_parts')
        .upsert(payload.parts, { onConflict: 'module,category,code' });
      if (error) throw new Error(`knowledge_parts: ${error.message}`);
    }

    if (payload.questions.length > 0) {
      const { error } = await client
        .from('questions')
        .upsert(payload.questions, { onConflict: 'id' });
      if (error) throw new Error(`questions: ${error.message}`);
    }

    if (payload.questionSets.length > 0) {
      const { error } = await client
        .from('question_sets')
        .upsert(payload.questionSets, { onConflict: 'id' });
      if (error) throw new Error(`question_sets: ${error.message}`);
    }

    const counts = {
      modules: payload.modules.length,
      categories: payload.categories.length,
      parts: payload.parts.length,
      questions: payload.questions.length,
      questionSets: payload.questionSets.length,
    };
    return {
      ok: true,
      counts,
      message: `Đã đẩy ${counts.modules} mô-đun, ${counts.categories} nhóm, ${counts.parts} phần, ${counts.questions} câu hỏi và ${counts.questionSets} bộ đề lên Supabase.`,
    };
  } catch (err) {
    return {
      ok: false,
      counts: emptyCounts,
      message:
        err instanceof Error
          ? `Không thể đẩy Ngân hàng Câu hỏi lên Supabase: ${err.message}`
          : 'Không thể đẩy Ngân hàng Câu hỏi lên Supabase.',
    };
  }
  });
}

async function upsertModuleRaw(
  client: SupabaseClient,
  mod: IC3ModuleRecord
): Promise<void> {
  const { error } = await client.from('ic3_modules').upsert(
    {
      id: mod.id,
      code: mod.code,
      level: mod.level,
      title: mod.title,
      description: mod.description,
      order_index: mod.orderIndex,
    },
    { onConflict: 'code' }
  );
  if (error) throw new Error(`Supabase ic3_modules: ${error.message}`);

  const [{ error: partsErr }, { error: qErr }] = await Promise.all([
    client
      .from('knowledge_parts')
      .update({ level: mod.level })
      .eq('module', mod.code),
    client
      .from('questions')
      .update({ level: mod.level })
      .eq('module', mod.code),
  ]);
  if (partsErr) throw new Error(`Supabase knowledge_parts (level): ${partsErr.message}`);
  if (qErr) throw new Error(`Supabase questions (level): ${qErr.message}`);
}

export async function upsertModuleOnSupabase(
  mod: IC3ModuleRecord,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall(`Đang đồng bộ Mô-đun ${mod.level} lên Supabase...`, () =>
    upsertModuleRaw(client, mod)
  );
}

export async function deleteModuleOnSupabase(
  modOrId: IC3ModuleRecord | string,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall('Đang xóa Mô-đun trên Supabase...', async () => {
    const query = client.from('ic3_modules').delete();
    const { error } =
      typeof modOrId === 'string'
        ? await query.eq('id', modOrId)
        : await query.eq('code', modOrId.code);
    if (error) throw new Error(`Supabase ic3_modules: ${error.message}`);
  });
}

async function upsertKnowledgeCategoryRaw(
  client: SupabaseClient,
  cat: KnowledgeCategoryRecord
): Promise<void> {
  const { error } = await client.from('knowledge_categories').upsert(
    {
      id: cat.id,
      module: cat.module,
      code: cat.code.trim().toUpperCase(),
      title: cat.title,
      description: cat.description,
      order_index: cat.orderIndex,
      is_enabled: cat.isEnabled !== false,
    },
    { onConflict: 'module,code' }
  );
  if (error) throw new Error(`Supabase knowledge_categories: ${error.message}`);
}

export async function upsertKnowledgeCategoryOnSupabase(
  cat: KnowledgeCategoryRecord,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall(
    `Đang đồng bộ Nhóm ${cat.code.trim().toUpperCase()} lên Supabase...`,
    () => upsertKnowledgeCategoryRaw(client, cat)
  );
}

export async function deleteKnowledgeCategoryOnSupabase(
  catOrId: KnowledgeCategoryRecord | string,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall('Đang xóa Nhóm kiến thức trên Supabase...', async () => {
    const query = client.from('knowledge_categories').delete();
    const { error } =
      typeof catOrId === 'string'
        ? await query.eq('id', catOrId)
        : await query
            .eq('module', catOrId.module)
            .eq('code', catOrId.code.trim().toUpperCase());
    if (error) throw new Error(`Supabase knowledge_categories: ${error.message}`);
  });
}

async function upsertKnowledgePartRaw(
  client: SupabaseClient,
  part: KnowledgePart
): Promise<void> {
  const { error } = await client.from('knowledge_parts').upsert(
    {
      id: part.id,
      module: part.module,
      level: part.level,
      category: part.category.trim().toUpperCase(),
      code: part.code.trim().toUpperCase(),
      title: part.title,
      description: part.description,
      order_index: part.orderIndex,
      is_enabled: part.isEnabled !== false,
    },
    { onConflict: 'module,category,code' }
  );
  if (error) throw new Error(`Supabase knowledge_parts: ${error.message}`);
}

export async function upsertKnowledgePartOnSupabase(
  part: KnowledgePart,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall(
    `Đang đồng bộ Phần ${part.code.trim().toUpperCase()} lên Supabase...`,
    () => upsertKnowledgePartRaw(client, part)
  );
}

export async function deleteKnowledgePartOnSupabase(
  partOrId: KnowledgePart | string,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall('Đang xóa Phần kiến thức trên Supabase...', async () => {
    const query = client.from('knowledge_parts').delete();
    const { error } =
      typeof partOrId === 'string'
        ? await query.eq('id', partOrId)
        : await query
            .eq('module', partOrId.module)
            .eq('category', partOrId.category.trim().toUpperCase())
            .eq('code', partOrId.code.trim().toUpperCase());
    if (error) throw new Error(`Supabase knowledge_parts: ${error.message}`);
  });
}

async function upsertQuestionRaw(
  client: SupabaseClient,
  q: Question
): Promise<void> {
  const { error } = await client.from('questions').upsert(
    {
      id: q.id,
      module: q.module,
      level: q.level,
      category: q.category.trim().toUpperCase(),
      content_code: q.contentCode.trim().toUpperCase(),
      topic_order: q.topicOrder,
      topic: q.topic,
      type: q.type,
      prompt: q.prompt,
      instruction: q.instruction ?? null,
      payload: q.payload,
      explanation: q.explanation,
      tips: q.tips ?? null,
      created_at: q.createdAt,
      updated_at: q.updatedAt,
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`Supabase questions: ${error.message}`);
}

export async function upsertQuestionOnSupabase(
  q: Question,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall('Đang đồng bộ Câu hỏi lên Supabase...', () =>
    upsertQuestionRaw(client, q)
  );
}

async function ensureModuleParentRaw(
  client: SupabaseClient,
  mod: IC3ModuleRecord
): Promise<void> {
  const { error } = await client.from('ic3_modules').upsert(
    {
      id: mod.id,
      code: mod.code,
      level: mod.level,
      title: mod.title,
      description: mod.description,
      order_index: mod.orderIndex,
    },
    { onConflict: 'code', ignoreDuplicates: true }
  );
  if (error) throw new Error(`Supabase ic3_modules: ${error.message}`);
}

export async function ensureModuleParentOnSupabase(
  mod: IC3ModuleRecord,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return ensureModuleParentRaw(client, mod);
}

async function ensureCategoryParentRaw(
  client: SupabaseClient,
  cat: KnowledgeCategoryRecord
): Promise<void> {
  const { error } = await client.from('knowledge_categories').upsert(
    {
      id: cat.id,
      module: cat.module,
      code: cat.code.trim().toUpperCase(),
      title: cat.title,
      description: cat.description,
      order_index: cat.orderIndex,
      is_enabled: cat.isEnabled !== false,
    },
    { onConflict: 'module,code', ignoreDuplicates: true }
  );
  if (error) throw new Error(`Supabase knowledge_categories: ${error.message}`);
}

export async function ensureCategoryParentOnSupabase(
  cat: KnowledgeCategoryRecord,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return ensureCategoryParentRaw(client, cat);
}

async function ensurePartParentRaw(
  client: SupabaseClient,
  part: KnowledgePart
): Promise<void> {
  const { error } = await client.from('knowledge_parts').upsert(
    {
      id: part.id,
      module: part.module,
      level: part.level,
      category: part.category.trim().toUpperCase(),
      code: part.code.trim().toUpperCase(),
      title: part.title,
      description: part.description,
      order_index: part.orderIndex,
      is_enabled: part.isEnabled !== false,
    },
    { onConflict: 'module,category,code', ignoreDuplicates: true }
  );
  if (error) throw new Error(`Supabase knowledge_parts: ${error.message}`);
}

export async function ensurePartParentOnSupabase(
  part: KnowledgePart,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return ensurePartParentRaw(client, part);
}

export async function syncCategoryWithParentOnSupabase(
  parentMod: IC3ModuleRecord | undefined,
  cat: KnowledgeCategoryRecord,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall(
    `Đang đồng bộ Nhóm ${cat.code.trim().toUpperCase()} lên Supabase...`,
    async () => {
      if (parentMod) {
        await ensureModuleParentRaw(client, parentMod);
      }
      await upsertKnowledgeCategoryRaw(client, cat);
    }
  );
}

export async function syncPartWithParentsOnSupabase(
  parentMod: IC3ModuleRecord | undefined,
  parentCat: KnowledgeCategoryRecord | undefined,
  part: KnowledgePart,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall(
    `Đang đồng bộ Phần ${part.code.trim().toUpperCase()} lên Supabase...`,
    async () => {
      if (parentMod) {
        await ensureModuleParentRaw(client, parentMod);
      }
      if (parentCat) {
        await ensureCategoryParentRaw(client, parentCat);
      } else {
        const cleanCat = part.category.trim().toUpperCase();
        await ensureCategoryParentRaw(client, {
          id: `cat_${part.module}_${cleanCat.toLowerCase()}`,
          module: part.module,
          code: cleanCat,
          title: CATEGORY_LABELS[cleanCat]?.name || `Nhóm ${cleanCat}`,
          description: CATEGORY_LABELS[cleanCat]?.description || '',
          orderIndex: 1,
          isEnabled: true,
        });
      }
      await upsertKnowledgePartRaw(client, part);
    }
  );
}

export async function syncQuestionWithParentsOnSupabase(
  dbSnapshot: {
    modules?: IC3ModuleRecord[];
    knowledgeCategories?: KnowledgeCategoryRecord[];
    knowledgeParts?: KnowledgePart[];
  },
  q: Question,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall('Đang đồng bộ Câu hỏi lên Supabase...', async () => {
    const cleanCat = q.category.trim().toUpperCase();
    const cleanPart = q.contentCode.trim().toUpperCase();

    const modRec = (dbSnapshot.modules ?? []).find((m) => m.code === q.module);
    if (modRec) {
      await ensureModuleParentRaw(client, modRec);
    } else {
      await ensureModuleParentRaw(client, {
        id: `mod_${q.module.toLowerCase()}`,
        code: q.module,
        level: q.level,
        title: MODULE_LABELS[q.module] || `${q.level} — ${q.module}`,
        description: '',
        orderIndex: 99,
      });
    }

    const catRec = (dbSnapshot.knowledgeCategories ?? []).find(
      (c) => c.module === q.module && c.code.toUpperCase() === cleanCat
    );
    if (catRec) {
      await ensureCategoryParentRaw(client, catRec);
    } else {
      await ensureCategoryParentRaw(client, {
        id: `cat_${q.module}_${cleanCat.toLowerCase()}`,
        module: q.module,
        code: cleanCat,
        title: CATEGORY_LABELS[cleanCat]?.name || `Nhóm ${cleanCat}`,
        description: CATEGORY_LABELS[cleanCat]?.description || '',
        orderIndex: 99,
        isEnabled: true,
      });
    }

    const partRec = (dbSnapshot.knowledgeParts ?? []).find(
      (p) =>
        p.module === q.module &&
        p.category.toUpperCase() === cleanCat &&
        p.code.toUpperCase() === cleanPart
    );
    if (partRec) {
      await ensurePartParentRaw(client, partRec);
    } else {
      await ensurePartParentRaw(client, {
        id: `part_${q.module}_${cleanCat.toLowerCase()}_${cleanPart.toLowerCase()}`,
        module: q.module,
        level: q.level,
        category: cleanCat,
        code: cleanPart,
        title: q.topic || `Chuyên đề ${cleanPart}`,
        description: '',
        orderIndex: 99,
        isEnabled: true,
      });
    }

    await upsertQuestionRaw(client, q);
  });
}

async function deleteQuestionRaw(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from('questions').delete().eq('id', id);
  if (error) throw new Error(`Supabase questions: ${error.message}`);
}

export async function deleteQuestionOnSupabase(
  id: string,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall('Đang xóa Câu hỏi trên Supabase...', () =>
    deleteQuestionRaw(client, id)
  );
}

async function upsertQuestionSetRaw(
  client: SupabaseClient,
  qs: QuestionSet
): Promise<void> {
  const { error } = await client.from('question_sets').upsert({
    id: qs.id,
    title: qs.title,
    description: qs.description,
    level: qs.level ?? null,
    category: qs.category ?? null,
    content_code: qs.contentCode ?? null,
    question_ids: qs.questionIds,
    created_at: qs.createdAt,
    updated_at: qs.updatedAt,
  });
  if (error) throw new Error(`Supabase question_sets: ${error.message}`);
}

export async function deleteQuestionAndSyncSetsOnSupabase(
  qId: string,
  updatedSets: QuestionSet[],
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall(
    'Đang xóa Câu hỏi & cập nhật Bộ đề trên Supabase...',
    async () => {
      await deleteQuestionRaw(client, qId);
      if (updatedSets.length > 0) {
        await Promise.all(
          updatedSets.map((qs) => upsertQuestionSetRaw(client, qs))
        );
      }
    }
  );
}

export async function deleteQuestionsBatchAndSyncSetsOnSupabase(
  qIds: string[],
  updatedSets: QuestionSet[],
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client || qIds.length === 0) return;
  return trackSupabaseCall(
    `Đang xóa ${qIds.length} câu hỏi & cập nhật Bộ đề trên Supabase...`,
    async () => {
      const { error } = await client.from('questions').delete().in('id', qIds);
      if (error) throw new Error(`Supabase questions (batch delete): ${error.message}`);
      if (updatedSets.length > 0) {
        await Promise.all(
          updatedSets.map((qs) => upsertQuestionSetRaw(client, qs))
        );
      }
    }
  );
}

export async function reorderQuestionsOnSupabase(
  updates: Array<{ id: string; topicOrder: number }>,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client || updates.length === 0) return;
  return trackSupabaseCall(
    'Đang cập nhật thứ tự câu hỏi trên Supabase...',
    async () => {
      const now = new Date().toISOString();
      await Promise.all(
        updates.map(async (u) => {
          const { error } = await client
            .from('questions')
            .update({ topic_order: u.topicOrder, updated_at: now })
            .eq('id', u.id);
          if (error) throw new Error(`Supabase reorder: ${error.message}`);
        })
      );
    }
  );
}

export async function upsertQuestionSetOnSupabase(
  qs: QuestionSet,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall(
    `Đang đồng bộ Bộ đề "${qs.title}" lên Supabase...`,
    () => upsertQuestionSetRaw(client, qs)
  );
}

export async function deleteQuestionSetOnSupabase(
  id: string,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<void> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) return;
  return trackSupabaseCall('Đang xóa Bộ đề trên Supabase...', async () => {
    const { error } = await client.from('question_sets').delete().eq('id', id);
    if (error) throw new Error(`Supabase question_sets: ${error.message}`);
  });
}

export const HOTSPOT_STORAGE_BUCKET = 'hotspot-images';

export async function uploadHotspotImageToSupabase(
  file: File,
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<{ ok: boolean; url?: string; message?: string }> {
  const client = createBrowserSupabaseClient(settings);
  if (!client) {
    return { ok: false, message: 'Chưa cấu hình kết nối Supabase.' };
  }
  return trackSupabaseCall(
    'Đang tải ảnh câu hỏi Hotspot lên Supabase Storage...',
    async () => {
      const extMatch = (file.name || '').match(/\.([a-zA-Z0-9]+)$/);
      const mimeExt = file.type?.split('/')[1]?.split('+')[0]?.toLowerCase();
      const normalizedMimeExt = mimeExt === 'jpeg' ? 'jpg' : mimeExt;
      const ext = extMatch ? extMatch[1].toLowerCase() : normalizedMimeExt || 'png';
      const filePath = `questions/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;

      const { error } = await client.storage
        .from(HOTSPOT_STORAGE_BUCKET)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'image/png',
        });

      if (error) {
        return { ok: false, message: error.message };
      }

      const { data } = client.storage
        .from(HOTSPOT_STORAGE_BUCKET)
        .getPublicUrl(filePath);

      return { ok: true, url: data.publicUrl };
    }
  );
}

export async function deleteHotspotImagesFromSupabase(
  storagePaths: string[],
  settings: SupabaseSettings = getSavedSupabaseSettings()
): Promise<{ ok: boolean; deletedCount: number; message?: string }> {
  const uniquePaths = Array.from(
    new Set(storagePaths.map((p) => p.trim()).filter(Boolean))
  );
  if (uniquePaths.length === 0) {
    return { ok: true, deletedCount: 0 };
  }
  const client = createBrowserSupabaseClient(settings);
  if (!client) {
    return { ok: false, deletedCount: 0, message: 'Chưa cấu hình kết nối Supabase.' };
  }
  return trackSupabaseCall(
    uniquePaths.length === 1
      ? 'Đang xóa ảnh Hotspot cũ khỏi Supabase Storage...'
      : `Đang xóa ${uniquePaths.length} ảnh Hotspot khỏi Supabase Storage...`,
    async () => {
      const { error } = await client.storage
        .from(HOTSPOT_STORAGE_BUCKET)
        .remove(uniquePaths);

      if (error) {
        return { ok: false, deletedCount: 0, message: error.message };
      }

      return { ok: true, deletedCount: uniquePaths.length };
    }
  );
}


