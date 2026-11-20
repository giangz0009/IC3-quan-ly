import React, { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Plus,
  RotateCcw,
  Save,
  Shield,
  Square,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';
import type { AdminDatabase, ClassBattleConfig } from '../types/ic3';
import { api, type SafeTeacher } from '../utils/api';
import { formatDuration } from '../utils/ic3Rules';

interface BattleControlViewProps {
  db: Omit<AdminDatabase, 'teachers'>;
  currentTeacher: SafeTeacher;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const BattleControlView: React.FC<BattleControlViewProps> = ({
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

  const buildConfig = (classId: string): ClassBattleConfig => {
    const existing = db.battleConfigs.find((b) => b.classId === classId);
    if (existing) return { ...existing };
    const cls = db.classes.find((c) => c.id === classId);
    const defaultSet = db.questionSets[0];
    return {
      classId,
      isEnabled: false,
      title: `Đấu trường IC3 — Lớp ${cls?.name ?? ''}`,
      questionSetId: defaultSet?.id ?? null,
      questionSetName: defaultSet?.title ?? 'Bộ đề tổng hợp',
      teacherName: currentTeacher.fullName,
      moduleFilter: 'all',
      questionIds: defaultSet?.questionIds ?? [],
      fastComboWindowSeconds: 15,
      topRewardCount: 3,
      breakRewardMinutes: 10,
      timeLimitSeconds: 300,
      updatedAt: new Date().toISOString(),
    };
  };

  const [config, setConfig] = useState<ClassBattleConfig>(() =>
    buildConfig(effectiveClassId)
  );
  const [busy, setBusy] = useState(false);
  const [joinStudentId, setJoinStudentId] = useState('');

  useEffect(() => {
    setConfig(buildConfig(effectiveClassId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveClassId, db.battleConfigs]);

  const classRooms = useMemo(
    () => db.battleRooms.filter((r) => r.classId === effectiveClassId),
    [db.battleRooms, effectiveClassId]
  );

  const activeRoom =
    classRooms.find((r) => r.status === 'playing' || r.status === 'lobby') ??
    classRooms[0] ??
    null;

  const classStudents = useMemo(
    () => db.students.filter((s) => s.classId === effectiveClassId),
    [db.students, effectiveClassId]
  );

  const availableToJoin = useMemo(() => {
    if (!activeRoom) return [];
    const inRoom = new Set(activeRoom.participants.map((p) => p.studentId));
    return classStudents.filter((s) => !inRoom.has(s.id));
  }, [activeRoom, classStudents]);

  async function saveBattleConfig(nextCfg: ClassBattleConfig, msg: string) {
    setBusy(true);
    try {
      await api.saveBattleConfig(effectiveClassId, nextCfg);
      await onRefresh();
      onNotify(msg);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi lưu cấu hình thi đấu.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled() {
    const next = { ...config, isEnabled: !config.isEnabled };
    setConfig(next);
    await saveBattleConfig(
      next,
      next.isEnabled
        ? 'Đã BẬT nút Thi đấu trên giao diện học sinh của lớp.'
        : 'Đã TẮT (khóa) nút Thi đấu của lớp.'
    );
  }

  async function handleCreateRoom() {
    setBusy(true);
    try {
      await api.createBattleRoom(effectiveClassId);
      await onRefresh();
      onNotify('Đã mở Phòng chờ Thi đấu mới cho lớp.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể tạo phòng.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleStartRoom() {
    if (!activeRoom) return;
    setBusy(true);
    try {
      await api.startBattleRoom(activeRoom.id);
      await onRefresh();
      onNotify('Trận đấu đã BẮT ĐẦU!');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể bắt đầu trận.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSimulateStep() {
    if (!activeRoom) return;
    setBusy(true);
    try {
      await api.simulateBattleStep(activeRoom.id);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi mô phỏng.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleFinishRoom() {
    if (!activeRoom) return;
    setBusy(true);
    try {
      await api.finishBattleRoom(activeRoom.id);
      await onRefresh();
      onNotify('Đã kết thúc trận đấu và cộng phút giải lao cho Top xếp hạng.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể kết thúc trận.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetRoom() {
    if (!activeRoom) return;
    setBusy(true);
    try {
      await api.resetBattleRoom(activeRoom.id);
      await onRefresh();
      onNotify('Đã đặt lại phòng về trạng thái Phòng chờ.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể đặt lại phòng.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinStudent() {
    if (!activeRoom || !joinStudentId) return;
    setBusy(true);
    try {
      await api.joinBattleRoom(activeRoom.id, joinStudentId);
      await onRefresh();
      setJoinStudentId('');
      onNotify('Đã đưa học sinh vào phòng chờ.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi thêm học sinh.', true);
    } finally {
      setBusy(false);
    }
  }

  const sortedParticipants = useMemo(() => {
    if (!activeRoom) return [];
    return [...activeRoom.participants].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.durationSeconds - b.durationSeconds;
    });
  }, [activeRoom]);

  return (
    <div className="space-y-6">
      {/* Top Bar: Class Selector & Master Enable Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label htmlFor="battle-class-select" className="text-sm font-medium">
            Điều phối Lớp:
          </label>
          <select
            id="battle-class-select"
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

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={handleToggleEnabled}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              config.isEnabled
                ? 'border-amber-500 bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Swords className="w-3.5 h-3.5" />
            <span>
              {config.isEnabled
                ? 'Nút Thi đấu Học sinh: ĐANG BẬT'
                : 'Nút Thi đấu Học sinh: ĐANG KHÓA'}
            </span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleCreateRoom}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tạo Phòng mới</span>
          </button>
        </div>
      </div>

      {/* Config Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveBattleConfig(config, 'Đã lưu luật thi đấu cho lớp.');
        }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Cấu hình Luật & Bộ đề Thi đấu
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Trả lời đúng 2 câu liên tiếp trong ngưỡng giây Combo để nhận Thẻ Phòng Thủ (+2 Khiên) hoặc Thẻ Tấn Công (6s).
            </p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-blue-600 text-white hover:opacity-90 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Lưu Cấu hình</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="bt-title" className="block text-xs font-medium mb-1">
              Tên giải đấu lớp
            </label>
            <input
              id="bt-title"
              type="text"
              value={config.title}
              onChange={(e) => setConfig({ ...config, title: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="bt-set" className="block text-xs font-medium mb-1">
              Bộ đề thi đấu
            </label>
            <select
              id="bt-set"
              value={config.questionSetId ?? ''}
              onChange={(e) => {
                const set = db.questionSets.find((s) => s.id === e.target.value);
                setConfig({
                  ...config,
                  questionSetId: set?.id ?? null,
                  questionSetName: set?.title ?? '',
                  questionIds: set?.questionIds ?? [],
                });
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              {db.questionSets.map((qs) => (
                <option key={qs.id} value={qs.id}>
                  {qs.title} ({qs.questionIds.length} câu)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bt-teacher" className="block text-xs font-medium mb-1">
              Giáo viên tổ chức
            </label>
            <input
              id="bt-teacher"
              type="text"
              value={config.teacherName}
              onChange={(e) =>
                setConfig({ ...config, teacherName: e.target.value })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label htmlFor="bt-time" className="block text-xs font-medium mb-1">
              Thời gian trận (giây)
            </label>
            <input
              id="bt-time"
              type="number"
              min={30}
              value={config.timeLimitSeconds}
              onChange={(e) =>
                setConfig({ ...config, timeLimitSeconds: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="bt-combo" className="block text-xs font-medium mb-1">
              Ngưỡng Combo 2 câu (giây)
            </label>
            <input
              id="bt-combo"
              type="number"
              min={5}
              value={config.fastComboWindowSeconds}
              onChange={(e) =>
                setConfig({
                  ...config,
                  fastComboWindowSeconds: Number(e.target.value),
                })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="bt-top" className="block text-xs font-medium mb-1">
              Số hạng Top X nhận thưởng
            </label>
            <input
              id="bt-top"
              type="number"
              min={1}
              value={config.topRewardCount}
              onChange={(e) =>
                setConfig({ ...config, topRewardCount: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label htmlFor="bt-reward" className="block text-xs font-medium mb-1">
              Thưởng giải lao Top X (phút)
            </label>
            <input
              id="bt-reward"
              type="number"
              min={0}
              value={config.breakRewardMinutes}
              onChange={(e) =>
                setConfig({
                  ...config,
                  breakRewardMinutes: Number(e.target.value),
                })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
        </div>
      </form>

      {/* Live Room Monitor */}
      {activeRoom ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Trạng thái phòng:{' '}
                  <strong
                    className={
                      activeRoom.status === 'playing'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : activeRoom.status === 'lobby'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }
                  >
                    {activeRoom.status === 'lobby'
                      ? 'Phòng chờ (Lobby)'
                      : activeRoom.status === 'playing'
                      ? 'Đang thi đấu (Playing)'
                      : 'Đã kết thúc (Finished)'}
                  </strong>
                  {' · '}
                  <span className="font-mono tabular-nums">
                    {activeRoom.questionIds.length} câu hỏi
                  </span>
                </div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white mt-0.5">
                  {activeRoom.configSnapshot.title}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {activeRoom.status === 'lobby' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleStartRoom}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Bắt đầu Trận đấu</span>
                  </button>
                )}
                {activeRoom.status === 'playing' && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSimulateStep}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Mô phỏng lượt trả lời</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleFinishRoom}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-700 text-white hover:opacity-90 cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5" />
                      <span>Kết thúc & Trao giải</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleResetRoom}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {activeRoom.status === 'lobby' && availableToJoin.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Chọn học sinh vào phòng chờ"
                  value={joinStudentId}
                  onChange={(e) => setJoinStudentId(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="">-- Thêm học sinh vào phòng chờ --</option>
                  {availableToJoin.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.studentCode})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!joinStudentId || busy}
                  onClick={handleJoinStudent}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                >
                  Vào phòng
                </button>
              </div>
            )}

            {/* Finished Podium */}
            {activeRoom.status === 'finished' && activeRoom.rankedResults && (
              <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-300">
                  <Trophy className="w-4 h-4" />
                  <span>Bảng Vinh Danh Kết Quả Chung Cuộc</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {activeRoom.rankedResults.slice(0, 3).map((r) => (
                    <div
                      key={r.studentId}
                      className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-slate-800"
                    >
                      <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                        Hạng #{r.rank}
                        {r.rewardedBreakMinutes > 0
                          ? ` · +${r.rewardedBreakMinutes}p giải lao`
                          : ''}
                      </div>
                      <div className="text-sm font-semibold mt-0.5">{r.studentName}</div>
                      <div className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                        {r.score} điểm · {formatDuration(r.durationSeconds)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Ranking Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 pr-3 font-medium">Hạng</th>
                    <th className="py-2 pr-3 font-medium">Học sinh</th>
                    <th className="py-2 pr-3 font-medium">Tiến độ</th>
                    <th className="py-2 pr-3 font-medium">Điểm</th>
                    <th className="py-2 pr-3 font-medium">Thời gian</th>
                    <th className="py-2 font-medium text-right">Kỹ năng & Hiệu ứng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedParticipants.map((p, index) => (
                    <tr key={p.studentId} className="h-11">
                      <td className="py-2 pr-3 font-mono text-xs font-semibold tabular-nums">
                        #{index + 1}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {p.studentName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {p.studentCode}
                        </div>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums">
                        {p.answeredCount}/{activeRoom.questionIds.length} (đúng {p.correctCount})
                      </td>
                      <td className="py-2 pr-3 font-mono font-semibold tabular-nums">
                        {p.score}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
                        {formatDuration(p.durationSeconds)}
                      </td>
                      <td className="py-2 text-right text-xs">
                        <span className="inline-flex items-center gap-1 font-mono text-slate-700 dark:text-slate-300">
                          <Shield className="w-3.5 h-3.5 text-blue-600" />
                          {p.shieldCharges}
                        </span>
                        {p.activeDebuffs.length > 0 && (
                          <span className="ml-2 text-red-600 dark:text-red-400 font-medium">
                            [{p.activeDebuffs.map((d) => d.type).join(', ')}]
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sortedParticipants.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-8 text-center text-xs text-slate-500"
                      >
                        Chưa có học sinh tham gia phòng này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Realtime Event Feed */}
          <aside className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-800">
              Nhật ký Sự kiện Realtime
            </h3>
            <div className="mt-3 space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {activeRoom.events.map((ev) => (
                <div
                  key={ev.id}
                  className="text-xs pb-2.5 border-b border-slate-100 dark:border-slate-800/80 last:border-0"
                >
                  <div className="font-mono text-[11px] text-slate-400">
                    {new Date(ev.createdAt).toLocaleTimeString('vi-VN')}
                  </div>
                  <p className="text-slate-700 dark:text-slate-200 mt-0.5 leading-relaxed">
                    {ev.message}
                  </p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Lớp này chưa có phòng thi đấu nào được mở.
          </p>
          <button
            type="button"
            onClick={handleCreateRoom}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Mở Phòng chờ ngay</span>
          </button>
        </div>
      )}
    </div>
  );
};
