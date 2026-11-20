import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { AdminDatabase } from '../types/ic3';
import { formatDuration, formatSubmissionsToCsv } from '../utils/ic3Rules';

interface ReportsViewProps {
  db: Omit<AdminDatabase, 'teachers'>;
  scopedSchoolId: string | null;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  db,
  scopedSchoolId,
}) => {
  const visibleClasses = useMemo(
    () =>
      scopedSchoolId
        ? db.classes.filter((c) => c.schoolId === scopedSchoolId)
        : db.classes,
    [db.classes, scopedSchoolId]
  );

  const [classFilter, setClassFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pass' | 'fail'>('all');

  const visibleClassIds = new Set(visibleClasses.map((c) => c.id));
  const classMap = new Map(db.classes.map((c) => [c.id, c]));

  const filteredSubmissions = useMemo(() => {
    return db.submissions.filter((s) => {
      if (!visibleClassIds.has(s.classId)) return false;
      if (classFilter !== 'all' && s.classId !== classFilter) return false;
      if (statusFilter === 'pass' && !s.metMinScore) return false;
      if (statusFilter === 'fail' && s.metMinScore) return false;
      return true;
    });
  }, [db.submissions, visibleClassIds, classFilter, statusFilter]);

  const studentSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        studentId: string;
        studentName: string;
        studentCode: string;
        className: string;
        attempts: number;
        qualifying: number;
        bestScore: number;
        totalScore: number;
        totalDuration: number;
      }
    >();

    for (const sub of filteredSubmissions) {
      const prev = map.get(sub.studentId) ?? {
        studentId: sub.studentId,
        studentName: sub.studentName,
        studentCode: sub.studentCode,
        className: classMap.get(sub.classId)?.name ?? sub.classId,
        attempts: 0,
        qualifying: 0,
        bestScore: 0,
        totalScore: 0,
        totalDuration: 0,
      };
      prev.attempts += 1;
      if (sub.metMinScore) prev.qualifying += 1;
      prev.bestScore = Math.max(prev.bestScore, sub.score);
      prev.totalScore += sub.score;
      prev.totalDuration += sub.durationSeconds;
      map.set(sub.studentId, prev);
    }

    return Array.from(map.values()).sort((a, b) => b.bestScore - a.bestScore);
  }, [filteredSubmissions, classMap]);

  const finishedBattles = useMemo(
    () =>
      db.battleRooms.filter(
        (r) =>
          r.status === 'finished' &&
          visibleClassIds.has(r.classId) &&
          (classFilter === 'all' || r.classId === classFilter)
      ),
    [db.battleRooms, visibleClassIds, classFilter]
  );

  function handleExportCsv() {
    const csv = formatSubmissionsToCsv(
      filteredSubmissions,
      db.classes,
      db.students
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ic3-bao-cao-diem-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Filter & Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Lọc báo cáo theo lớp"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="all">Tất cả các lớp</option>
            {visibleClasses.map((c) => (
              <option key={c.id} value={c.id}>
                Lớp {c.name}
              </option>
            ))}
          </select>

          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800/80">
            {[
              { id: 'all', label: 'Tất cả lượt' },
              { id: 'pass', label: 'Đạt điểm sàn' },
              { id: 'fail', label: 'Chưa đạt' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() =>
                  setStatusFilter(tab.id as 'all' | 'pass' | 'fail')
                }
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filteredSubmissions.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Xuất CSV (Excel)</span>
        </button>
      </div>

      {/* Aggregated Student Performance */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Tổng hợp Thành tích Học sinh
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Thống kê điểm cao nhất, điểm trung bình, tỷ lệ đạt điểm sàn và thời gian trung bình.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Mã HS</th>
                <th className="py-2 pr-4 font-medium">Họ và tên</th>
                <th className="py-2 pr-4 font-medium">Lớp</th>
                <th className="py-2 pr-4 font-medium text-right">Số lượt</th>
                <th className="py-2 pr-4 font-medium text-right">Đạt chuẩn</th>
                <th className="py-2 pr-4 font-medium text-right">Điểm cao nhất</th>
                <th className="py-2 pr-4 font-medium text-right">Điểm TB</th>
                <th className="py-2 font-medium text-right">Thời gian TB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {studentSummary.map((row) => (
                <tr key={row.studentId} className="h-11">
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                    {row.studentCode}
                  </td>
                  <td className="py-2 pr-4 font-medium">{row.studentName}</td>
                  <td className="py-2 pr-4 text-xs text-slate-600 dark:text-slate-400">
                    {row.className}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums text-right">
                    {row.attempts}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums text-right">
                    {row.qualifying}/{row.attempts}
                  </td>
                  <td className="py-2 pr-4 font-mono font-semibold tabular-nums text-right text-blue-600 dark:text-blue-400">
                    {row.bestScore}
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-right">
                    {Math.round(row.totalScore / row.attempts)}
                  </td>
                  <td className="py-2 font-mono text-xs tabular-nums text-right text-slate-500">
                    {formatDuration(Math.round(row.totalDuration / row.attempts))}
                  </td>
                </tr>
              ))}
              {studentSummary.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="py-8 text-center text-sm text-slate-500"
                  >
                    Chưa có dữ liệu thống kê phù hợp.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Submission Details */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Chi tiết Lịch sử Nộp bài ({filteredSubmissions.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Học sinh</th>
                <th className="py-2 pr-4 font-medium">Nhiệm vụ</th>
                <th className="py-2 pr-4 font-medium text-right">Lần</th>
                <th className="py-2 pr-4 font-medium text-right">Đúng/Tổng</th>
                <th className="py-2 pr-4 font-medium text-right">Điểm</th>
                <th className="py-2 pr-4 font-medium text-right">Thời gian</th>
                <th className="py-2 font-medium text-right">Kết quả</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredSubmissions.map((s) => (
                <tr key={s.id} className="h-10">
                  <td className="py-2 pr-4">
                    <span className="font-medium">{s.studentName}</span>
                    <span className="text-xs text-slate-400 ml-1.5 font-mono">
                      {s.studentCode}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-600 dark:text-slate-300">
                    {s.taskTitle}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums text-right">
                    {s.attemptNumber}/{s.requiredAttempts}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums text-right">
                    {s.correctCount}/{s.totalCount}
                  </td>
                  <td className="py-2 pr-4 font-mono font-semibold tabular-nums text-right">
                    {s.score}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums text-right text-slate-500">
                    {formatDuration(s.durationSeconds)}
                  </td>
                  <td className="py-2 text-right text-xs font-medium">
                    {s.metMinScore ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Đạt (≥{s.minScore})
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">
                        Chưa đạt ({s.minScore})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Finished Battle Archive */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Lịch sử Các trận Thi đấu đã Kết thúc ({finishedBattles.length})
        </h2>
        <div className="space-y-3">
          {finishedBattles.map((room) => (
            <div
              key={room.id}
              className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-sm">
                  {room.configSnapshot.title} · Lớp{' '}
                  {classMap.get(room.classId)?.name}
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {room.finishedAt
                    ? new Date(room.finishedAt).toLocaleString('vi-VN')
                    : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                {(room.rankedResults ?? []).slice(0, 3).map((r) => (
                  <span key={r.studentId}>
                    <strong>#{r.rank} {r.studentName}</strong>: {r.score} điểm (
                    {formatDuration(r.durationSeconds)})
                    {r.rewardedBreakMinutes > 0
                      ? ` · +${r.rewardedBreakMinutes}p`
                      : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {finishedBattles.length === 0 && (
            <p className="text-sm text-slate-500">Chưa có trận thi đấu nào kết thúc.</p>
          )}
        </div>
      </section>
    </div>
  );
};
