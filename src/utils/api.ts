import type {
  AdminDatabase,
  AdminRole,
  AdminTeacher,
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
  StudentProfile,
  TeacherAccountStatus,
} from '../types/ic3';

export type SafeTeacher = Omit<AdminTeacher, 'password'>;

let memoryAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return memoryAuthToken;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const authHeaders: Record<string, string> = memoryAuthToken
    ? { Authorization: `Bearer ${memoryAuthToken}` }
    : {};
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      memoryAuthToken = null;
    }
    throw new Error(data.error || `Lỗi máy chủ (${res.status})`);
  }
  return data as T;
}

export const api = {
  async login(email: string, password: string) {
    const result = await request<{ teacher: SafeTeacher; token: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );
    setAuthToken(result.token);
    return result;
  },

  async logout() {
    try {
      if (memoryAuthToken) {
        await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
      }
    } finally {
      setAuthToken(null);
    }
  },

  bootstrap() {
    return request<Omit<AdminDatabase, 'teachers'> & { teachers: SafeTeacher[] }>(
      '/api/bootstrap'
    );
  },

  createTeacher(payload: {
    fullName: string;
    email: string;
    password: string;
    role: AdminRole;
    status?: TeacherAccountStatus;
  }) {
    return request<SafeTeacher>('/api/teachers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateTeacher(
    userId: string,
    payload: {
      fullName?: string;
      email?: string;
      password?: string;
      role?: AdminRole;
      status?: TeacherAccountStatus;
    }
  ) {
    return request<SafeTeacher>(`/api/teachers/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteTeacher(userId: string) {
    return request<{ ok: boolean }>(`/api/teachers/${userId}`, {
      method: 'DELETE',
    });
  },

  createSchool(payload: { name: string; district: string }) {
    return request<School>('/api/schools', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateSchool(id: string, payload: { name: string; district: string }) {
    return request<School>(`/api/schools/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteSchool(id: string) {
    return request<{ ok: boolean }>(`/api/schools/${id}`, {
      method: 'DELETE',
    });
  },

  createClass(payload: { schoolId: string; name: string; grade: string }) {
    return request<SchoolClass>('/api/classes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateClass(id: string, payload: { name: string; grade: string }) {
    return request<SchoolClass>(`/api/classes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteClass(id: string) {
    return request<{ ok: boolean }>(`/api/classes/${id}`, {
      method: 'DELETE',
    });
  },

  createStudent(payload: {
    classId: string;
    fullName: string;
    studentCode: string;
    alwaysBreakReady?: boolean;
  }) {
    return request<StudentProfile>('/api/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  batchImportStudents(
    classId: string,
    rows: Array<{ fullName: string; studentCode: string }>
  ) {
    return request<{ created: StudentProfile[]; skipped: string[] }>(
      '/api/students/batch',
      {
        method: 'POST',
        body: JSON.stringify({ classId, rows }),
      }
    );
  },

  updateStudent(
    id: string,
    payload: Partial<Pick<StudentProfile, 'fullName' | 'studentCode' | 'alwaysBreakReady'>>
  ) {
    return request<StudentProfile>(`/api/students/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteStudent(id: string) {
    return request<{ ok: boolean }>(`/api/students/${id}`, {
      method: 'DELETE',
    });
  },

  resetStudentPassword(id: string) {
    return request<StudentProfile>(`/api/students/${id}/reset-password`, {
      method: 'POST',
    });
  },

  resetClassPasswords(classId: string) {
    return request<{ ok: boolean; count: number }>(
      `/api/classes/${classId}/reset-passwords`,
      { method: 'POST' }
    );
  },

  createModule(payload: Omit<IC3ModuleRecord, 'id' | 'orderIndex'>) {
    return request<IC3ModuleRecord>('/api/modules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateModule(
    id: string,
    payload: Partial<Pick<IC3ModuleRecord, 'level' | 'title' | 'description'>>
  ) {
    return request<IC3ModuleRecord>(`/api/modules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteModule(id: string) {
    return request<{ ok: boolean }>(`/api/modules/${id}`, {
      method: 'DELETE',
    });
  },

  createKnowledgeCategory(
    payload: Omit<KnowledgeCategoryRecord, 'id' | 'orderIndex'>
  ) {
    return request<KnowledgeCategoryRecord>('/api/knowledge-categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateKnowledgeCategory(
    id: string,
    payload: Partial<Pick<KnowledgeCategoryRecord, 'title' | 'description'>>
  ) {
    return request<KnowledgeCategoryRecord>(`/api/knowledge-categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteKnowledgeCategory(id: string) {
    return request<{ ok: boolean }>(`/api/knowledge-categories/${id}`, {
      method: 'DELETE',
    });
  },

  createKnowledgePart(payload: Omit<KnowledgePart, 'id' | 'orderIndex'>) {
    return request<KnowledgePart>('/api/knowledge-parts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateKnowledgePart(
    id: string,
    payload: Partial<Pick<KnowledgePart, 'title' | 'description'>>
  ) {
    return request<KnowledgePart>(`/api/knowledge-parts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteKnowledgePart(id: string) {
    return request<{ ok: boolean }>(`/api/knowledge-parts/${id}`, {
      method: 'DELETE',
    });
  },

  createQuestion(payload: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>) {
    return request<Question>('/api/questions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  reorderQuestions(updates: Array<{ id: string; topicOrder: number }>) {
    return request<{ ok: boolean }>('/api/questions/reorder', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    });
  },

  updateQuestion(id: string, payload: Partial<Question>) {
    return request<Question>(`/api/questions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteQuestion(id: string) {
    return request<{ ok: boolean }>(`/api/questions/${id}`, {
      method: 'DELETE',
    });
  },

  batchDeleteQuestions(ids: string[]) {
    return request<{ ok: boolean; deletedCount: number }>('/api/questions/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  },

  createQuestionSet(
    payload: Omit<QuestionSet, 'id' | 'createdAt' | 'updatedAt'>
  ) {
    return request<QuestionSet>('/api/question-sets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateQuestionSet(id: string, payload: Partial<QuestionSet>) {
    return request<QuestionSet>(`/api/question-sets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteQuestionSet(id: string) {
    return request<{ ok: boolean }>(`/api/question-sets/${id}`, {
      method: 'DELETE',
    });
  },

  importQuestionBankFromRemote(payload: {
    modules?: IC3ModuleRecord[];
    knowledgeCategories?: KnowledgeCategoryRecord[];
    knowledgeParts: KnowledgePart[];
    questions: Question[];
    questionSets?: QuestionSet[];
  }) {
    return request<{
      ok: boolean;
      counts: {
        modules: number;
        knowledgeCategories: number;
        knowledgeParts: number;
        questions: number;
        questionSets: number;
      };
    }>('/api/question-bank/import-remote', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  saveClassTaskConfig(classId: string, payload: ClassTaskConfig) {
    return request<ClassTaskConfig>(`/api/class-tasks/${classId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  saveBattleConfig(classId: string, payload: ClassBattleConfig) {
    return request<ClassBattleConfig>(`/api/battle-configs/${classId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  createBattleRoom(classId: string) {
    return request<BattleRoomState>('/api/battle-rooms', {
      method: 'POST',
      body: JSON.stringify({ classId }),
    });
  },

  joinBattleRoom(roomId: string, studentId: string) {
    return request<BattleRoomState>(`/api/battle-rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({ studentId }),
    });
  },

  startBattleRoom(roomId: string) {
    return request<BattleRoomState>(`/api/battle-rooms/${roomId}/start`, {
      method: 'POST',
    });
  },

  simulateBattleStep(roomId: string) {
    return request<BattleRoomState>(`/api/battle-rooms/${roomId}/simulate-step`, {
      method: 'POST',
    });
  },

  finishBattleRoom(roomId: string) {
    return request<BattleRoomState>(`/api/battle-rooms/${roomId}/finish`, {
      method: 'POST',
    });
  },

  resetBattleRoom(roomId: string) {
    return request<BattleRoomState>(`/api/battle-rooms/${roomId}/reset`, {
      method: 'POST',
    });
  },
};
