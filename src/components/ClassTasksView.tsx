import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import type {
  AdminDatabase,
  ClassTaskConfig,
  ClassTaskItem,
  IC3Level,
  IC3Module,
  KnowledgeCategory,
  QuizMode,
} from '../types/ic3';
import { api, type SafeTeacher } from '../utils/api';
import {
  evaluateTaskCompletion,
  formatDuration,
  isStudentBreakUnlocked,
} from '../utils/ic3Rules';

interface ClassTasksViewProps {
  db: Omit<AdminDatabase, 'teachers'>;
  currentTeacher: SafeTeacher;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const ClassTasksView: React.FC<ClassTasksViewProps> = ({
  db,
  currentTeacher,
  onRefresh,
  onNotify,
}) => {
  const scopedClasses = useMemo(() => {
    if (currentTeacher.role === 'super_admin' || !currentTeacher.schoolId) {
      return db.classes;
    }
    return db.classes.filter((c) => c.schoolId === currentTeacher.schoolId);
  }, [db.classes, currentTeacher]);

  const [selectedClassId, setSelectedClassId] = useState(
    scopedClasses[0]?.id ?? ''
  );

  const effectiveClassId = scopedClasses.some((c) => c.id === selectedClassId)
    ? selectedClassId
    : scopedClasses[0]?.id ?? '';

  const schoolMap = new Map(db.schools.map((s) => [s.id, s.name]));

  const buildDraft = (classId: string): ClassTaskConfig => {
    const existing = db.classTaskConfigs.find((c) => c.classId === classId);
    if (existing) {
      return JSON.parse(JSON.stringify(existing)) as ClassTaskConfig;
    }
    const cls = db.classes.find((c) => c.id === classId);
    return {
      classId,
      assignmentTitle: `Nhiệm vụ Ôn tập — Lớp ${cls?.name ?? ''}`,
      teacherName: currentTeacher.fullName,
      breakRewardMinutes: 10,
      updatedAt: new Date().toISOString(),
      tasks: [],
    };
  };

  const [draft, setDraft] = useState<ClassTaskConfig>(() =>
    buildDraft(effectiveClassId)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(buildDraft(effectiveClassId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveClassId, db.classTaskConfigs]);

  const classStudents = useMemo(
    () => db.students.filter((s) => s.classId === effectiveClassId),
    [db.students, effectiveClassId]
  );

  function addTask() {
    const defaultSet = db.questionSets[0];
    const nextTask: ClassTaskItem = {
      id: `task_${Date.now()}`,
      classId: effectiveClassId,
      orderIndex: draft.tasks.length + 1,
      title: defaultSet?.title ?? 'Nhiệm vụ luyện thi IC3 mới',
      description: 'Hoàn thành bài làm đạt điểm sàn quy định.',
      level: defaultSet?.level ?? 'LV1',
      category: defaultSet?.category ?? 'GM',
      contentCode: defaultSet?.contentCode ?? 'GM1',
      moduleFilter: 'all',
      quizMode: 'practice',
      questionIds: defaultSet?.questionIds ?? db.questions.slice(0, 5).map((q) => q.id),
      estimatedMinutes: 10,
      requiredAttempts: 1,
      minScore: 700,
    };
    setDraft((prev) => ({ ...prev, tasks: [...prev.tasks, nextTask] }));
  }

  function moveTask(idx: number, dir: -1 | 1) {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= draft.tasks.length) return;
    const next = [...draft.tasks];
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    setDraft((prev) => ({
      ...prev,
      tasks: next.map((t, i) => ({ ...t, orderIndex: i + 1 })),
    }));
  }

  function updateTask(idx: number, patch: Partial<ClassTaskItem>) {
    setDraft((prev) => {
      const next = [...prev.tasks];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, tasks: next };
    });
  }

  function removeTask(idx: number) {
    setDraft((prev) => ({
      ...prev,
      tasks: prev.tasks
        .filter((_, i) => i !== idx)
        .map((t, i) => ({ ...t, orderIndex: i + 1 })),
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveClassId) return;
    setSaving(true);
    try {
      await api.saveClassTaskConfig(effectiveClassId, draft);
      await onRefresh();
      onNotify('Đã lưu cấu hình Bài tập và Phần thưởng Giải lao cho lớp.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi lưu bài tập.', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Class Selector + Save Button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label htmlFor="task-class-select" className="text-sm font-medium">
            Chọn lớp giao bài:
          </label>
          <select
            id="task-class-select"
            value={effectiveClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium"
          >
            {scopedClasses.map((c) => (
              <option key={c.id} value={c.id}>
                Lớp {c.name} — {schoolMap.get(c.schoolId)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addTask}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm Nhiệm vụ</span>
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Đang lưu...' : 'Lưu Cấu hình Lớp'}</span>
          </button>
        </div>
      </div>

      {/* Assignment Header Settings */}
      <form
        onSubmit={handleSave}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4"
      >
        <div className="md:col-span-2">
          <label htmlFor="assign-title" className="block text-xs font-medium mb-1">
            Tiêu đề đợt bài tập (hiển thị trên trang chủ học sinh)
          </label>
          <input
            id="assign-title"
            type="text"
            required
            value={draft.assignmentTitle}
            onChange={(e) =>
              setDraft({ ...draft, assignmentTitle: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
        <div>
          <label htmlFor="assign-teacher" className="block text-xs font-medium mb-1">
            Giáo viên giao bài
          </label>
          <input
            id="assign-teacher"
            type="text"
            required
            value={draft.teacherName}
            onChange={(e) =>
              setDraft({ ...draft, teacherName: e.target.value })
            }
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
        <div>
          <label htmlFor="assign-break" className="block text-xs font-medium mb-1">
            Thưởng Giải lao khi đạt 100% (phút)
          </label>
          <input
            id="assign-break"
            type="number"
            min={0}
            max={120}
            value={draft.breakRewardMinutes}
            onChange={(e) =>
              setDraft({
                ...draft,
                breakRewardMinutes: Number(e.target.value),
              })
            }
            className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
      </form>

      {/* Tasks List */}
      <section className="space-y-4">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Danh sách Nhiệm vụ của Lớp ({draft.tasks.length})
        </h2>

        {draft.tasks.map((task, idx) => (
          <div
            key={task.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                Nhiệm vụ #{idx + 1} · {task.questionIds.length} câu hỏi
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`Di chuyển nhiệm vụ ${idx + 1} lên`}
                  disabled={idx === 0}
                  onClick={() => moveTask(idx, -1)}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Di chuyển nhiệm vụ ${idx + 1} xuống`}
                  disabled={idx === draft.tasks.length - 1}
                  onClick={() => moveTask(idx, 1)}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Xóa nhiệm vụ ${idx + 1}`}
                  onClick={() => removeTask(idx)}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  Tên nhiệm vụ
                </label>
                <input
                  type="text"
                  value={task.title}
                  onChange={(e) => updateTask(idx, { title: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Áp nhanh từ Bộ đề
                </label>
                <select
                  aria-label={`Chọn bộ đề cho nhiệm vụ ${idx + 1}`}
                  value=""
                  onChange={(e) => {
                    const set = db.questionSets.find(
                      (qs) => qs.id === e.target.value
                    );
                    if (set) {
                      updateTask(idx, {
                        title: set.title,
                        level: set.level ?? task.level,
                        category: set.category ?? task.category,
                        contentCode: set.contentCode ?? task.contentCode,
                        questionIds: set.questionIds,
                      });
                    }
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="">-- Chọn bộ đề mẫu --</option>
                  {db.questionSets.map((qs) => (
                    <option key={qs.id} value={qs.id}>
                      {qs.title} ({qs.questionIds.length} câu)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Chế độ làm bài
                </label>
                <select
                  value={task.quizMode}
                  onChange={(e) =>
                    updateTask(idx, { quizMode: e.target.value as QuizMode })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="practice">Luyện tập (Practice)</option>
                  <option value="exam">Thi thử (Exam)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Cấp độ</label>
                <select
                  value={task.level}
                  onChange={(e) =>
                    updateTask(idx, { level: e.target.value as IC3Level })
                  }
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="LV1">LV1</option>
                  <option value="LV2">LV2</option>
                  <option value="LV3">LV3</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nhóm</label>
                <select
                  value={task.category}
                  onChange={(e) =>
                    updateTask(idx, {
                      category: e.target.value as KnowledgeCategory,
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="GM">GM</option>
                  <option value="OT">OT</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Mã nội dung</label>
                <input
                  type="text"
                  value={task.contentCode}
                  onChange={(e) =>
                    updateTask(idx, { contentCode: e.target.value })
                  }
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Số lượt yêu cầu
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={task.requiredAttempts}
                  onChange={(e) =>
                    updateTask(idx, {
                      requiredAttempts: Number(e.target.value),
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Điểm sàn (0–1000)
                </label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={50}
                  value={task.minScore}
                  onChange={(e) =>
                    updateTask(idx, { minScore: Number(e.target.value) })
                  }
                  className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Dự kiến (phút)
                </label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={task.estimatedMinutes}
                  onChange={(e) =>
                    updateTask(idx, {
                      estimatedMinutes: Number(e.target.value),
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Mô tả hướng dẫn</label>
                <input
                  type="text"
                  value={task.description}
                  onChange={(e) =>
                    updateTask(idx, { description: e.target.value })
                  }
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Bộ lọc Mô-đun</label>
                <select
                  value={task.moduleFilter}
                  onChange={(e) =>
                    updateTask(idx, {
                      moduleFilter: e.target.value as 'all' | IC3Module,
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="all">Tất cả mô-đun</option>
                  <option value="computing_fundamentals">Máy tính căn bản (LV1)</option>
                  <option value="key_applications">Ứng dụng chủ chốt (LV2)</option>
                  <option value="living_online">Cuộc sống trực tuyến (LV3)</option>
                </select>
              </div>
            </div>
          </div>
        ))}

        {draft.tasks.length === 0 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Lớp này chưa có nhiệm vụ nào. Nhấn "Thêm Nhiệm vụ" để giao bài tập.
          </div>
        )}
      </section>

      {/* Class Student Completion & Break Monitor */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Theo dõi Hoàn thành & Trạng thái Giải lao của Học sinh
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Chỉ tính các lượt nộp bài có điểm ≥ điểm sàn ({draft.tasks.length} nhiệm vụ).
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Mã HS</th>
                <th className="py-2 pr-4 font-medium">Họ và tên</th>
                <th className="py-2 pr-4 font-medium">Tiến độ nhiệm vụ</th>
                <th className="py-2 pr-4 font-medium">Điểm cao nhất</th>
                <th className="py-2 font-medium text-right">Khu vực Giải lao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {classStudents.map((st) => {
                const completedTasks = draft.tasks.filter(
                  (t) => evaluateTaskCompletion(db.submissions, st.id, t).completed
                ).length;
                const unlocked =
                  st.alwaysBreakReady ||
                  isStudentBreakUnlocked(draft.tasks, db.submissions, st.id);
                const breakState = db.breakStates.find(
                  (b) => b.studentId === st.id
                );
                const bestScore = db.submissions
                  .filter((s) => s.studentId === st.id)
                  .reduce((max, s) => Math.max(max, s.score), 0);

                return (
                  <tr key={st.id} className="h-11">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                      {st.studentCode}
                    </td>
                    <td className="py-2 pr-4 font-medium">{st.fullName}</td>
                    <td className="py-2 pr-4 font-mono text-xs tabular-nums">
                      {completedTasks}/{draft.tasks.length} nhiệm vụ
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs tabular-nums">
                      {bestScore > 0 ? `${bestScore}/1000` : '—'}
                    </td>
                    <td className="py-2 text-right text-xs">
                      {st.alwaysBreakReady ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          Luôn mở (Demo)
                        </span>
                      ) : unlocked ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium tabular-nums">
                          Đang mở ({formatDuration(breakState?.remainingSeconds ?? draft.breakRewardMinutes * 60)})
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">
                          Đang khóa
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
