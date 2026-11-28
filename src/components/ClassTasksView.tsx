import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
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
import { ListSkeleton, TableSkeletonRows } from './TableSkeleton';

interface ClassTasksViewProps {
  db: Omit<AdminDatabase, 'teachers'>;
  currentTeacher: SafeTeacher;
  loading?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const ClassTasksView: React.FC<ClassTasksViewProps> = ({
  db,
  currentTeacher,
  loading = false,
  onRefresh,
  onNotify,
}) => {
  const scopedClasses = db.classes;

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

  // Modal 1: Edit Header Config Modal
  const [showHeaderModal, setShowHeaderModal] = useState(false);
  const [headerForm, setHeaderForm] = useState({
    assignmentTitle: '',
    teacherName: '',
    breakRewardMinutes: 10,
  });

  // Modal 2: Add / Edit Task Modal
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTaskIdx, setEditingTaskIdx] = useState<number | null>(null);
  const [taskForm, setTaskForm] = useState<ClassTaskItem | null>(null);

  useEffect(() => {
    setDraft(buildDraft(effectiveClassId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveClassId, db.classTaskConfigs]);

  const classStudents = useMemo(
    () => db.students.filter((s) => s.classId === effectiveClassId),
    [db.students, effectiveClassId]
  );

  const availableModules = useMemo(() => {
    const base = db.modules ?? [];
    if (base.length > 0) return base;
    return [
      { id: 'm1', code: 'computing_fundamentals', level: 'LV1', title: 'Máy tính căn bản (LV1)', description: '', orderIndex: 1 },
      { id: 'm2', code: 'key_applications', level: 'LV2', title: 'Ứng dụng chủ chốt (LV2)', description: '', orderIndex: 2 },
      { id: 'm3', code: 'living_online', level: 'LV3', title: 'Cuộc sống trực tuyến (LV3)', description: '', orderIndex: 3 },
    ];
  }, [db.modules]);

  function openHeaderEditModal() {
    setHeaderForm({
      assignmentTitle: draft.assignmentTitle,
      teacherName: draft.teacherName,
      breakRewardMinutes: draft.breakRewardMinutes,
    });
    setShowHeaderModal(true);
  }

  async function handleSaveHeaderModal(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveClassId) return;
    const nextConfig: ClassTaskConfig = {
      ...draft,
      assignmentTitle: headerForm.assignmentTitle.trim(),
      teacherName: headerForm.teacherName.trim(),
      breakRewardMinutes: Math.max(0, Math.min(120, Number(headerForm.breakRewardMinutes) || 0)),
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    try {
      await api.saveClassTaskConfig(effectiveClassId, nextConfig);
      setDraft(nextConfig);
      await onRefresh();
      setShowHeaderModal(false);
      onNotify('Đã cập nhật thông tin chung của đợt bài tập lớp.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Lỗi lưu thông tin đợt bài tập.',
        true
      );
    } finally {
      setSaving(false);
    }
  }

  function openAddTaskModal() {
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
      questionIds:
        defaultSet?.questionIds ?? db.questions.slice(0, 5).map((q) => q.id),
      estimatedMinutes: 10,
      requiredAttempts: 1,
      minScore: 700,
    };
    setEditingTaskIdx(null);
    setTaskForm(nextTask);
    setShowTaskModal(true);
  }

  function openEditTaskModal(idx: number) {
    const target = draft.tasks[idx];
    if (!target) return;
    setEditingTaskIdx(idx);
    setTaskForm({ ...target, questionIds: [...target.questionIds] });
    setShowTaskModal(true);
  }

  async function handleSaveTaskModal(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveClassId || !taskForm) return;
    const nextTasks = [...draft.tasks];
    if (editingTaskIdx === null) {
      nextTasks.push({
        ...taskForm,
        orderIndex: nextTasks.length + 1,
      });
    } else {
      nextTasks[editingTaskIdx] = {
        ...taskForm,
        orderIndex: editingTaskIdx + 1,
      };
    }
    const nextConfig: ClassTaskConfig = {
      ...draft,
      tasks: nextTasks.map((t, i) => ({ ...t, orderIndex: i + 1 })),
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    try {
      await api.saveClassTaskConfig(effectiveClassId, nextConfig);
      setDraft(nextConfig);
      await onRefresh();
      setShowTaskModal(false);
      setTaskForm(null);
      setEditingTaskIdx(null);
      onNotify(
        editingTaskIdx === null
          ? 'Đã thêm nhiệm vụ mới và lưu cấu hình lớp.'
          : 'Đã cập nhật nhiệm vụ và lưu cấu hình lớp.'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi lưu nhiệm vụ.', true);
    } finally {
      setSaving(false);
    }
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

  function removeTask(idx: number) {
    setDraft((prev) => ({
      ...prev,
      tasks: prev.tasks
        .filter((_, i) => i !== idx)
        .map((t, i) => ({ ...t, orderIndex: i + 1 })),
    }));
  }

  async function handleSaveAll() {
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
      {/* Class Selector + Action Buttons */}
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
            disabled={!effectiveClassId}
            onClick={openAddTaskModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm Nhiệm vụ</span>
          </button>
          <button
            type="button"
            disabled={saving || !effectiveClassId}
            onClick={handleSaveAll}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Đang lưu...' : 'Lưu Cấu hình Lớp'}</span>
          </button>
        </div>
      </div>

      {/* Assignment Header Summary Card */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 min-w-[260px]">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Tiêu đề đợt bài tập
            </div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white mt-1">
              {draft.assignmentTitle}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Giáo viên giao bài
            </div>
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-1">
              {draft.teacherName}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Thưởng Giải lao khi đạt 100%
            </div>
            <div className="text-sm font-mono font-semibold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
              +{draft.breakRewardMinutes} phút
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!effectiveClassId}
          onClick={openHeaderEditModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Pencil className="w-3.5 h-3.5" />
          <span>Sửa Thông tin chung</span>
        </button>
      </section>

      {/* Tasks Summary Cards */}
      <section className="space-y-4">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Danh sách Nhiệm vụ của Lớp ({draft.tasks.length})
        </h2>

        {loading ? (
          <ListSkeleton
            variant="questionCard"
            rows={3}
            ariaLabel="Đang tải danh sách nhiệm vụ của lớp..."
          />
        ) : (
          <>
            <div className="space-y-3">
              {draft.tasks.map((task, idx) => (
                <article
                  key={task.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-start justify-between gap-4"
                >
                  <div className="space-y-1.5 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span className="font-bold text-blue-600 dark:text-blue-400">
                        Nhiệm vụ #{idx + 1}
                      </span>
                      <span>·</span>
                      <span>
                        {task.level} · {task.category} · {task.contentCode}
                      </span>
                      <span>·</span>
                      <span>
                        {task.quizMode === 'exam' ? 'Thi thử (Exam)' : 'Luyện tập (Practice)'}
                      </span>
                      <span>·</span>
                      <span>{task.questionIds.length} câu hỏi</span>
                    </div>
                    <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                      {task.title}
                    </h3>
                    {task.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {task.description}
                      </p>
                    )}
                    <div className="text-xs text-slate-500 dark:text-slate-400 pt-1 tabular-nums">
                      Điểm sàn:{' '}
                      <strong className="text-slate-700 dark:text-slate-200 font-mono">
                        {task.minScore}/1000
                      </strong>{' '}
                      · Số lượt yêu cầu:{' '}
                      <strong className="text-slate-700 dark:text-slate-200 font-mono">
                        {task.requiredAttempts}
                      </strong>{' '}
                      · Thời lượng dự kiến:{' '}
                      <strong className="text-slate-700 dark:text-slate-200 font-mono">
                        {task.estimatedMinutes} phút
                      </strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      aria-label={`Di chuyển nhiệm vụ ${idx + 1} lên`}
                      disabled={idx === 0}
                      onClick={() => moveTask(idx, -1)}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Di chuyển nhiệm vụ ${idx + 1} xuống`}
                      disabled={idx === draft.tasks.length - 1}
                      onClick={() => moveTask(idx, 1)}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Sửa nhiệm vụ ${idx + 1}`}
                      onClick={() => openEditTaskModal(idx)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Sửa</span>
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
                </article>
              ))}
            </div>

            {draft.tasks.length === 0 && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Lớp này chưa có nhiệm vụ nào. Nhấn "Thêm Nhiệm vụ" để giao bài tập.
              </div>
            )}
          </>
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
            {loading ? (
              <TableSkeletonRows
                rows={6}
                ariaLabel="Đang tải tiến độ hoàn thành nhiệm vụ của học sinh..."
                columns={[
                  { variant: 'mono', widths: ['w-16', 'w-20'], cellClassName: 'py-2 pr-4' },
                  { variant: 'text', widths: ['w-36', 'w-44', 'w-32'], cellClassName: 'py-2 pr-4' },
                  { variant: 'mono', widths: ['w-24', 'w-28'], cellClassName: 'py-2 pr-4' },
                  { variant: 'mono', widths: ['w-16', 'w-20'], cellClassName: 'py-2 pr-4' },
                  { variant: 'text', align: 'right', widths: ['w-24', 'w-28'], cellClassName: 'py-2 text-right' },
                ]}
              />
            ) : (
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
            )}
          </table>
        </div>
      </section>

      {/* Modal 1: Chỉnh sửa Thông tin chung đợt bài tập */}
      {showHeaderModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-header-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => !saving && setShowHeaderModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <h3
                id="task-header-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                Chỉnh sửa Thông tin chung Đợt bài tập
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại thông tin chung"
                disabled={saving}
                onClick={() => setShowHeaderModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveHeaderModal} className="p-6 space-y-4">
              <div>
                <label htmlFor="assign-title" className="block text-xs font-medium mb-1">
                  Tiêu đề đợt bài tập (hiển thị trên trang chủ học sinh)
                </label>
                <input
                  id="assign-title"
                  type="text"
                  required
                  value={headerForm.assignmentTitle}
                  onChange={(e) =>
                    setHeaderForm({ ...headerForm, assignmentTitle: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="assign-teacher" className="block text-xs font-medium mb-1">
                    Giáo viên giao bài
                  </label>
                  <input
                    id="assign-teacher"
                    type="text"
                    required
                    value={headerForm.teacherName}
                    onChange={(e) =>
                      setHeaderForm({ ...headerForm, teacherName: e.target.value })
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
                    value={headerForm.breakRewardMinutes}
                    onChange={(e) =>
                      setHeaderForm({
                        ...headerForm,
                        breakRewardMinutes: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowHeaderModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Đang lưu...' : 'Lưu thông tin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Thêm / Sửa Nhiệm vụ */}
      {showTaskModal && taskForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-item-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => {
            if (!saving) {
              setShowTaskModal(false);
              setTaskForm(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <h3
                id="task-item-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingTaskIdx === null
                  ? 'Thêm Nhiệm vụ mới cho lớp'
                  : `Chỉnh sửa Nhiệm vụ #${editingTaskIdx + 1}`}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại nhiệm vụ"
                disabled={saving}
                onClick={() => {
                  setShowTaskModal(false);
                  setTaskForm(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTaskModal} className="overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="task-modal-title-input" className="block text-xs font-medium mb-1">
                    Tên nhiệm vụ
                  </label>
                  <input
                    id="task-modal-title-input"
                    type="text"
                    required
                    value={taskForm.title}
                    onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="task-modal-set-select" className="block text-xs font-medium mb-1">
                    Áp nhanh từ Bộ đề
                  </label>
                  <select
                    id="task-modal-set-select"
                    value=""
                    onChange={(e) => {
                      const set = db.questionSets.find((qs) => qs.id === e.target.value);
                      if (set) {
                        setTaskForm({
                          ...taskForm,
                          title: set.title,
                          level: set.level ?? taskForm.level,
                          category: set.category ?? taskForm.category,
                          contentCode: set.contentCode ?? taskForm.contentCode,
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
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="task-modal-mode" className="block text-xs font-medium mb-1">
                    Chế độ làm bài
                  </label>
                  <select
                    id="task-modal-mode"
                    value={taskForm.quizMode}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, quizMode: e.target.value as QuizMode })
                    }
                    className="w-full px-2.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="practice">Luyện tập</option>
                    <option value="exam">Thi thử</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="task-modal-level" className="block text-xs font-medium mb-1">
                    Cấp độ
                  </label>
                  <select
                    id="task-modal-level"
                    value={taskForm.level}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, level: e.target.value as IC3Level })
                    }
                    className="w-full px-2.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {Array.from(
                      new Set([...availableModules.map((m) => m.level), taskForm.level])
                    ).map((lv) => (
                      <option key={lv} value={lv}>
                        {lv}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="task-modal-cat" className="block text-xs font-medium mb-1">
                    Nhóm
                  </label>
                  <select
                    id="task-modal-cat"
                    value={taskForm.category}
                    onChange={(e) =>
                      setTaskForm({
                        ...taskForm,
                        category: e.target.value as KnowledgeCategory,
                      })
                    }
                    className="w-full px-2.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {Array.from(
                      new Set([
                        'GM',
                        'OT',
                        ...(db.knowledgeCategories ?? []).map((c) => c.code),
                        taskForm.category,
                      ])
                    ).map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="task-modal-code" className="block text-xs font-medium mb-1">
                    Mã nội dung
                  </label>
                  <input
                    id="task-modal-code"
                    type="text"
                    value={taskForm.contentCode}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, contentCode: e.target.value })
                    }
                    className="w-full px-2.5 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="task-modal-attempts" className="block text-xs font-medium mb-1">
                    Số lượt yêu cầu
                  </label>
                  <input
                    id="task-modal-attempts"
                    type="number"
                    min={1}
                    max={20}
                    value={taskForm.requiredAttempts}
                    onChange={(e) =>
                      setTaskForm({
                        ...taskForm,
                        requiredAttempts: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="task-modal-score" className="block text-xs font-medium mb-1">
                    Điểm sàn (0–1000)
                  </label>
                  <input
                    id="task-modal-score"
                    type="number"
                    min={0}
                    max={1000}
                    step={50}
                    value={taskForm.minScore}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, minScore: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="task-modal-minutes" className="block text-xs font-medium mb-1">
                    Dự kiến (phút)
                  </label>
                  <input
                    id="task-modal-minutes"
                    type="number"
                    min={1}
                    max={120}
                    value={taskForm.estimatedMinutes}
                    onChange={(e) =>
                      setTaskForm({
                        ...taskForm,
                        estimatedMinutes: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="task-modal-desc" className="block text-xs font-medium mb-1">
                    Mô tả hướng dẫn
                  </label>
                  <input
                    id="task-modal-desc"
                    type="text"
                    value={taskForm.description}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, description: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label htmlFor="task-modal-module" className="block text-xs font-medium mb-1">
                    Bộ lọc Mô-đun
                  </label>
                  <select
                    id="task-modal-module"
                    value={taskForm.moduleFilter}
                    onChange={(e) =>
                      setTaskForm({
                        ...taskForm,
                        moduleFilter: e.target.value as 'all' | IC3Module,
                      })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="all">Tất cả mô-đun</option>
                    {availableModules.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400">
                Số câu hỏi đang gắn với nhiệm vụ:{' '}
                <strong className="font-mono text-slate-800 dark:text-slate-200">
                  {taskForm.questionIds.length} câu
                </strong>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setShowTaskModal(false);
                    setTaskForm(null);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {saving
                    ? 'Đang lưu...'
                    : editingTaskIdx === null
                      ? 'Thêm & Lưu Nhiệm vụ'
                      : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
