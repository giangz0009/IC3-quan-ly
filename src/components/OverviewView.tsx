import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { AdminDatabase } from '../types/ic3';
import { formatDuration, isStudentBreakUnlocked } from '../utils/ic3Rules';

type NavTab =
  | 'overview'
  | 'schools'
  | 'questions'
  | 'tasks'
  | 'battle'
  | 'reports'
  | 'supabase';

interface OverviewViewProps {
  db: Omit<AdminDatabase, 'teachers'>;
  scopedSchoolId: string | null;
  onNavigate: (tab: NavTab) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  db,
  scopedSchoolId,
  onNavigate,
}) => {
  const visibleClasses = scopedSchoolId
    ? db.classes.filter((c) => c.schoolId === scopedSchoolId)
    : db.classes;
  const visibleClassIds = new Set(visibleClasses.map((c) => c.id));
  const visibleStudents = db.students.filter((s) => visibleClassIds.has(s.classId));
  const visibleSubmissions = db.submissions.filter((sub) =>
    visibleClassIds.has(sub.classId)
  );

  const avgScore =
    visibleSubmissions.length > 0
      ? Math.round(
          visibleSubmissions.reduce((acc, s) => acc + s.score, 0) /
            visibleSubmissions.length
        )
      : 0;

  const passCount = visibleSubmissions.filter((s) => s.score >= 700).length;
  const passRate =
    visibleSubmissions.length > 0
      ? Math.round((passCount / visibleSubmissions.length) * 100)
      : 0;

  const activeBattleCount = db.battleConfigs.filter(
    (b) => visibleClassIds.has(b.classId) && b.isEnabled
  ).length;

  const classMap = new Map(db.classes.map((c) => [c.id, c]));
  const schoolMap = new Map(db.schools.map((s) => [s.id, s]));

  return (
    <div className="space-y-8">
      {/* KPI Strip */}
      <section aria-label="Chỉ số tổng quan" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Học sinh đang quản lý
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {visibleStudents.length}
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {visibleClasses.length} lớp · {scopedSchoolId ? '1 trường' : `${db.schools.length} trường`}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Ngân hàng câu hỏi IC3
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {db.questions.length}
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {db.questionSets.length} bộ đề · 5 dạng tương tác
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Điểm trung bình lượt nộp
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {avgScore}
            <span className="text-base font-normal text-slate-400">/1000</span>
          </p>
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 tabular-nums">
            Tỷ lệ đạt ≥700: {passRate}% ({passCount}/{visibleSubmissions.length} lượt)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Phòng Thi đấu Realtime
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {activeBattleCount}
          </p>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Lớp đang bật nút Thi đấu
          </p>
        </div>
      </section>

      {/* Main Split: Class Progress + Recent Submissions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Tiến độ Bài tập & Mở khóa Giải lao theo Lớp
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Học sinh cần hoàn thành đủ lượt và đạt điểm sàn để nhận phút giải lao
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Giao bài tập</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
            {visibleClasses.map((cls) => {
              const school = schoolMap.get(cls.schoolId);
              const students = db.students.filter((s) => s.classId === cls.id);
              const taskCfg = db.classTaskConfigs.find((c) => c.classId === cls.id);
              const battleCfg = db.battleConfigs.find((b) => b.classId === cls.id);
              const completedStudents = taskCfg
                ? students.filter((st) =>
                    isStudentBreakUnlocked(taskCfg.tasks, db.submissions, st.id)
                  ).length
                : 0;
              const pct =
                students.length > 0
                  ? Math.round((completedStudents / students.length) * 100)
                  : 0;

              return (
                <div key={cls.id} className="py-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Lớp {cls.name}
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        {' '}· {school?.name} · {students.length} học sinh
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {taskCfg
                        ? `${taskCfg.tasks.length} nhiệm vụ · Thưởng ${taskCfg.breakRewardMinutes}p`
                        : 'Chưa giao bài tập'}
                      {' · '}
                      <span
                        className={
                          battleCfg?.isEnabled
                            ? 'text-amber-600 dark:text-amber-400 font-medium'
                            : ''
                        }
                      >
                        {battleCfg?.isEnabled ? 'Thi đấu: Đang bật' : 'Thi đấu: Tắt'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300 w-24 text-right">
                      {completedStudents}/{students.length} đạt ({pct}%)
                    </span>
                  </div>
                </div>
              );
            })}
            {visibleClasses.length === 0 && (
              <p className="py-8 text-sm text-slate-500 dark:text-slate-400 text-center">
                Chưa có lớp học nào trong phạm vi quản lý.
              </p>
            )}
          </div>
        </section>

        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Lượt nộp bài gần nhất
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Cập nhật điểm thang 1000 và trạng thái đạt điểm sàn
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Xem báo cáo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
            {visibleSubmissions.slice(0, 6).map((sub) => {
              const cls = classMap.get(sub.classId);
              return (
                <div
                  key={sub.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {sub.studentName}
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                        {' '}· Lớp {cls?.name ?? sub.classId}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {sub.taskTitle} · Lần {sub.attemptNumber}/{sub.requiredAttempts} ·{' '}
                      {formatDuration(sub.durationSeconds)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {sub.score}
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        sub.metMinScore
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {sub.metMinScore ? 'Đạt chuẩn' : `Dưới sàn ${sub.minScore}`}
                    </div>
                  </div>
                </div>
              );
            })}
            {visibleSubmissions.length === 0 && (
              <p className="py-8 text-sm text-slate-500 dark:text-slate-400 text-center">
                Chưa có lượt nộp bài nào.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
