import React, { useMemo, useState } from 'react';
import {
  KeyRound,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Building2,
  GraduationCap,
} from 'lucide-react';
import type {
  AdminDatabase,
  School,
  SchoolClass,
  StudentProfile,
} from '../types/ic3';
import { api, type SafeTeacher } from '../utils/api';
import { normalizeVietnamesePassword, parseStudentsCsv } from '../utils/ic3Rules';

interface SchoolsStudentsViewProps {
  db: Omit<AdminDatabase, 'teachers'> & { teachers: SafeTeacher[] };
  currentTeacher: SafeTeacher;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const SchoolsStudentsView: React.FC<SchoolsStudentsViewProps> = ({
  db,
  currentTeacher,
  onRefresh,
  onNotify,
}) => {
  const scopedSchools = useMemo(
    () =>
      currentTeacher.role === 'super_admin' || !currentTeacher.schoolId
        ? db.schools
        : db.schools.filter((s) => s.id === currentTeacher.schoolId),
    [db.schools, currentTeacher]
  );

  const [selectedSchoolId, setSelectedSchoolId] = useState<string>(
    scopedSchools[0]?.id ?? ''
  );
  const effectiveSchoolId = scopedSchools.some((s) => s.id === selectedSchoolId)
    ? selectedSchoolId
    : scopedSchools[0]?.id ?? '';

  const schoolClasses = useMemo(
    () => db.classes.filter((c) => c.schoolId === effectiveSchoolId),
    [db.classes, effectiveSchoolId]
  );

  const [selectedClassId, setSelectedClassId] = useState<string>(
    schoolClasses[0]?.id ?? ''
  );
  const effectiveClassId = schoolClasses.some((c) => c.id === selectedClassId)
    ? selectedClassId
    : schoolClasses[0]?.id ?? '';

  const classStudents = useMemo(
    () => db.students.filter((st) => st.classId === effectiveClassId),
    [db.students, effectiveClassId]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return classStudents;
    return classStudents.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.studentCode.toLowerCase().includes(q)
    );
  }, [classStudents, searchQuery]);

  // Modals state
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [schoolForm, setSchoolForm] = useState({ name: '', district: '' });

  const [showClassModal, setShowClassModal] = useState(false);
  const [classForm, setClassForm] = useState({ name: '', grade: 'Khối 6' });

  const [showStudentModal, setShowStudentModal] = useState(false);
  const [studentForm, setStudentForm] = useState({
    fullName: '',
    studentCode: '',
    alwaysBreakReady: false,
  });

  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState(
    'Họ tên,Mã HS\nNguyễn Hoàng Nam,6A1-06\nTrần Ngọc Hân,6A1-07'
  );

  const [showTeachersPanel, setShowTeachersPanel] = useState(false);
  const [teacherForm, setTeacherForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'teacher' as 'super_admin' | 'teacher',
    schoolId: (effectiveSchoolId || null) as string | null,
  });

  const [busy, setBusy] = useState(false);

  const activeSchool: School | undefined = scopedSchools.find(
    (s) => s.id === effectiveSchoolId
  );
  const activeClass: SchoolClass | undefined = schoolClasses.find(
    (c) => c.id === effectiveClassId
  );

  async function handleCreateSchool(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.createSchool(schoolForm);
      await onRefresh();
      setSelectedSchoolId(created.id);
      setShowSchoolModal(false);
      setSchoolForm({ name: '', district: '' });
      onNotify(`Đã thêm trường ${created.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi tạo trường.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSchool(school: School) {
    setBusy(true);
    try {
      await api.deleteSchool(school.id);
      await onRefresh();
      onNotify(`Đã xóa trường ${school.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi xóa trường.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateClass(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveSchoolId) return;
    setBusy(true);
    try {
      const created = await api.createClass({
        schoolId: effectiveSchoolId,
        ...classForm,
      });
      await onRefresh();
      setSelectedClassId(created.id);
      setShowClassModal(false);
      setClassForm({ name: '', grade: 'Khối 6' });
      onNotify(`Đã thêm lớp ${created.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi tạo lớp.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteClass(cls: SchoolClass) {
    setBusy(true);
    try {
      await api.deleteClass(cls.id);
      await onRefresh();
      onNotify(`Đã xóa lớp ${cls.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi xóa lớp.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveClassId) return;
    setBusy(true);
    try {
      const created = await api.createStudent({
        classId: effectiveClassId,
        ...studentForm,
      });
      await onRefresh();
      setShowStudentModal(false);
      setStudentForm({ fullName: '', studentCode: '', alwaysBreakReady: false });
      onNotify(
        `Đã thêm học sinh ${created.fullName} (mật khẩu mặc định: ${created.passwordHash}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi thêm học sinh.', true);
    } finally {
      setBusy(false);
    }
  }

  const parsedCsv = useMemo(
    () => parseStudentsCsv(csvText, activeClass?.name || 'HS'),
    [csvText, activeClass?.name]
  );

  async function handleImportCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveClassId || parsedCsv.rows.length === 0) return;
    setBusy(true);
    try {
      const res = await api.batchImportStudents(
        effectiveClassId,
        parsedCsv.rows.map((r) => ({
          fullName: r.fullName,
          studentCode: r.studentCode,
        }))
      );
      await onRefresh();
      setShowCsvModal(false);
      onNotify(
        `Đã nhập ${res.created.length} học sinh${
          res.skipped.length > 0 ? ` (bỏ qua ${res.skipped.length} mã trùng)` : ''
        }.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi nhập CSV.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword(student: StudentProfile) {
    setBusy(true);
    try {
      const updated = await api.resetStudentPassword(student.id);
      await onRefresh();
      onNotify(
        `Đã đặt lại mật khẩu cho ${updated.fullName} về mặc định (${updated.passwordHash}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi đặt lại mật khẩu.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetClassPasswords() {
    if (!effectiveClassId) return;
    setBusy(true);
    try {
      const res = await api.resetClassPasswords(effectiveClassId);
      await onRefresh();
      onNotify(`Đã đặt lại mật khẩu mặc định cho ${res.count} học sinh trong lớp.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi đặt lại mật khẩu lớp.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleBreakReady(student: StudentProfile) {
    setBusy(true);
    try {
      await api.updateStudent(student.id, {
        alwaysBreakReady: !student.alwaysBreakReady,
      });
      await onRefresh();
      onNotify(
        `${student.fullName}: ${
          !student.alwaysBreakReady
            ? 'Đã bật chế độ luôn mở Khu vực Giải lao.'
            : 'Đã tắt chế độ kiểm thử giải lao.'
        }`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi cập nhật.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteStudent(student: StudentProfile) {
    setBusy(true);
    try {
      await api.deleteStudent(student.id);
      await onRefresh();
      onNotify(`Đã xóa học sinh ${student.fullName}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi xóa học sinh.', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTeacher(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createTeacher(teacherForm);
      await onRefresh();
      setTeacherForm({
        fullName: '',
        email: '',
        password: '',
        role: 'teacher',
        schoolId: effectiveSchoolId,
      });
      onNotify('Đã cấp tài khoản giáo viên mới.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi tạo giáo viên.', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Toolbar: Hierarchy Selection & Super Admin Teacher Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {currentTeacher.role === 'super_admin' && (
            <button
              type="button"
              onClick={() => setShowSchoolModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Thêm Trường học</span>
            </button>
          )}
          <button
            type="button"
            disabled={!effectiveSchoolId}
            onClick={() => setShowClassModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Thêm Lớp học</span>
          </button>
          {currentTeacher.role === 'super_admin' && (
            <button
              type="button"
              onClick={() => setShowTeachersPanel((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showTeachersPanel
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span>Phân quyền Giáo viên ({db.teachers.length})</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!effectiveClassId}
            onClick={() => setShowCsvModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Nhập CSV</span>
          </button>
          <button
            type="button"
            disabled={!effectiveClassId}
            onClick={() => setShowStudentModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Thêm Học sinh</span>
          </button>
        </div>
      </div>

      {/* Super Admin Teacher RBAC Panel */}
      {showTeachersPanel && currentTeacher.role === 'super_admin' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Quản lý Tài khoản Giáo viên & Phân quyền
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Super Admin quản lý toàn hệ thống; Teacher chỉ quản lý trường được gán.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleCreateTeacher}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2"
          >
            <input
              type="text"
              required
              placeholder="Họ và tên giáo viên"
              value={teacherForm.fullName}
              onChange={(e) =>
                setTeacherForm({ ...teacherForm, fullName: e.target.value })
              }
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="email"
              required
              placeholder="Email đăng nhập"
              value={teacherForm.email}
              onChange={(e) =>
                setTeacherForm({ ...teacherForm, email: e.target.value })
              }
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="password"
              required
              placeholder="Mật khẩu"
              value={teacherForm.password}
              onChange={(e) =>
                setTeacherForm({ ...teacherForm, password: e.target.value })
              }
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <select
              aria-label="Phạm vi quyền"
              value={teacherForm.role === 'super_admin' ? 'super_admin' : teacherForm.schoolId || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'super_admin') {
                  setTeacherForm({ ...teacherForm, role: 'super_admin', schoolId: null });
                } else {
                  setTeacherForm({ ...teacherForm, role: 'teacher', schoolId: val });
                }
              }}
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="super_admin">Super Admin (Toàn bộ)</option>
              {db.schools.map((s) => (
                <option key={s.id} value={s.id}>
                  Giáo viên · {s.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-blue-600 text-white hover:opacity-90 cursor-pointer"
            >
              Cấp tài khoản
            </button>
          </form>

          <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-800 pt-3">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-4 font-medium">Giáo viên</th>
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Vai trò</th>
                  <th className="py-2 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {db.teachers.map((t) => {
                  const sc = db.schools.find((s) => s.id === t.schoolId);
                  return (
                    <tr key={t.userId} className="h-10">
                      <td className="py-2 pr-4 font-medium">{t.fullName}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {t.email}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {t.role === 'super_admin'
                          ? 'Super Admin'
                          : `Giáo viên · ${sc?.name ?? 'Chưa gán'}`}
                      </td>
                      <td className="py-2 text-right">
                        {t.userId !== currentTeacher.userId && (
                          <button
                            type="button"
                            aria-label={`Xóa giáo viên ${t.fullName}`}
                            onClick={async () => {
                              await api.deleteTeacher(t.userId);
                              await onRefresh();
                              onNotify(`Đã xóa tài khoản ${t.fullName}.`);
                            }}
                            className="text-xs text-red-600 hover:underline cursor-pointer"
                          >
                            Xóa
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 12-Col Master-Detail Workspace: Schools/Classes (4) + Students Table (8) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className="lg:col-span-4 space-y-5">
          {/* Schools List */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white mb-3">
              Trường học ({scopedSchools.length})
            </h2>
            <div className="space-y-1.5">
              {scopedSchools.map((school) => {
                const isSelected = school.id === effectiveSchoolId;
                const countClasses = db.classes.filter(
                  (c) => c.schoolId === school.id
                ).length;
                return (
                  <div
                    key={school.id}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 border transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 dark:border-blue-500'
                        : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedSchoolId(school.id)}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {school.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {school.district} · {countClasses} lớp
                      </div>
                    </button>
                    {currentTeacher.role === 'super_admin' && (
                      <button
                        type="button"
                        aria-label={`Xóa trường ${school.name}`}
                        onClick={() => handleDeleteSchool(school)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Classes List */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Lớp thuộc {activeSchool?.name ?? 'Trường'} ({schoolClasses.length})
              </h2>
            </div>
            <div className="space-y-1.5">
              {schoolClasses.map((cls) => {
                const isSelected = cls.id === effectiveClassId;
                const countStudents = db.students.filter(
                  (s) => s.classId === cls.id
                ).length;
                return (
                  <div
                    key={cls.id}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 border transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 dark:border-blue-500'
                        : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedClassId(cls.id)}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Lớp {cls.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {cls.grade} · {countStudents} học sinh
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Xóa lớp ${cls.name}`}
                      onClick={() => handleDeleteClass(cls)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              {schoolClasses.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                  Trường này chưa có lớp học nào.
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* Students Data Table */}
        <section className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {activeClass
                  ? `Danh sách Học sinh · Lớp ${activeClass.name}`
                  : 'Danh sách Học sinh'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Mật khẩu mặc định: Họ tên viết thường không dấu, bỏ khoảng trắng (vd: Đỗ Gia Huy → dogiahuy).
              </p>
            </div>
            {activeClass && classStudents.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={handleResetClassPasswords}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Reset mật khẩu cả lớp</span>
              </button>
            )}
          </div>

          <div className="my-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm học sinh theo họ tên hoặc mã số..."
              aria-label="Tìm kiếm học sinh"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 whitespace-nowrap">
                  <th className="py-2.5 pr-4 font-medium">Mã HS</th>
                  <th className="py-2.5 pr-4 font-medium">Họ và tên</th>
                  <th className="py-2.5 pr-4 font-medium">Mật khẩu hiện hành</th>
                  <th className="py-2.5 pr-4 font-medium">Giải lao demo</th>
                  <th className="py-2.5 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredStudents.map((st) => {
                  const defaultPw = normalizeVietnamesePassword(st.fullName);
                  return (
                    <tr
                      key={st.id}
                      className="h-11 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 pr-4 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {st.studentCode}
                      </td>
                      <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {st.fullName}
                      </td>
                      <td className="py-2.5 pr-4 text-xs whitespace-nowrap">
                        {st.isCustomPassword ? (
                          <span className="text-amber-700 dark:text-amber-400 font-medium">
                            Đã tự đổi ({st.passwordHash})
                          </span>
                        ) : (
                          <span className="font-mono text-slate-600 dark:text-slate-400">
                            {defaultPw}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleBreakReady(st)}
                          className={`text-xs font-medium hover:underline cursor-pointer whitespace-nowrap ${
                            st.alwaysBreakReady
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {st.alwaysBreakReady ? 'Luôn mở khóa' : 'Theo nhiệm vụ'}
                        </button>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap space-x-3">
                        <button
                          type="button"
                          onClick={() => handleResetPassword(st)}
                          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          Reset MK
                        </button>
                        <button
                          type="button"
                          aria-label={`Xóa học sinh ${st.fullName}`}
                          onClick={() => handleDeleteStudent(st)}
                          className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredStudents.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      Chưa có học sinh nào khớp bộ lọc. Nhấn "Thêm Học sinh" hoặc "Nhập CSV".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Modal: Thêm Trường học */}
      {showSchoolModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-school-title"
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3
              id="modal-school-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-white"
            >
              Thêm Trường học mới
            </h3>
            <form onSubmit={handleCreateSchool} className="space-y-4">
              <div>
                <label
                  htmlFor="school-name"
                  className="block text-sm font-medium mb-1"
                >
                  Tên trường
                </label>
                <input
                  id="school-name"
                  type="text"
                  required
                  placeholder="VD: THCS Chu Văn An"
                  value={schoolForm.name}
                  onChange={(e) =>
                    setSchoolForm({ ...schoolForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label
                  htmlFor="school-district"
                  className="block text-sm font-medium mb-1"
                >
                  Quận / Huyện / Tỉnh thành
                </label>
                <input
                  id="school-district"
                  type="text"
                  required
                  placeholder="VD: Quận 5, TP.HCM"
                  value={schoolForm.district}
                  onChange={(e) =>
                    setSchoolForm({ ...schoolForm, district: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSchoolModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  Lưu Trường học
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Thêm Lớp học */}
      {showClassModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-class-title"
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3
              id="modal-class-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-white"
            >
              Thêm Lớp học · {activeSchool?.name}
            </h3>
            <form onSubmit={handleCreateClass} className="space-y-4">
              <div>
                <label htmlFor="class-name" className="block text-sm font-medium mb-1">
                  Tên lớp
                </label>
                <input
                  id="class-name"
                  type="text"
                  required
                  placeholder="VD: 6A3"
                  value={classForm.name}
                  onChange={(e) =>
                    setClassForm({ ...classForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="class-grade" className="block text-sm font-medium mb-1">
                  Khối lớp
                </label>
                <select
                  id="class-grade"
                  value={classForm.grade}
                  onChange={(e) =>
                    setClassForm({ ...classForm, grade: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="Khối 6">Khối 6</option>
                  <option value="Khối 7">Khối 7</option>
                  <option value="Khối 8">Khối 8</option>
                  <option value="Khối 9">Khối 9</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowClassModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  Tạo Lớp học
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Thêm Học sinh */}
      {showStudentModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-student-title"
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3
              id="modal-student-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-white"
            >
              Thêm Học sinh · Lớp {activeClass?.name}
            </h3>
            <form onSubmit={handleCreateStudent} className="space-y-4">
              <div>
                <label htmlFor="st-fullname" className="block text-sm font-medium mb-1">
                  Họ và tên học sinh
                </label>
                <input
                  id="st-fullname"
                  type="text"
                  required
                  placeholder="VD: Đỗ Minh Khôi"
                  value={studentForm.fullName}
                  onChange={(e) =>
                    setStudentForm({ ...studentForm, fullName: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label htmlFor="st-code" className="block text-sm font-medium mb-1">
                  Mã học sinh
                </label>
                <input
                  id="st-code"
                  type="text"
                  required
                  placeholder="VD: 6A1-08"
                  value={studentForm.studentCode}
                  onChange={(e) =>
                    setStudentForm({ ...studentForm, studentCode: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  Mật khẩu mặc định tự sinh:{' '}
                </span>
                <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                  {studentForm.fullName
                    ? normalizeVietnamesePassword(studentForm.fullName)
                    : '—'}
                </span>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={studentForm.alwaysBreakReady}
                  onChange={(e) =>
                    setStudentForm({
                      ...studentForm,
                      alwaysBreakReady: e.target.checked,
                    })
                  }
                />
                <span>Bật cờ always_break_ready (tài khoản kiểm thử giải lao)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStudentModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  Lưu Học sinh
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nhập CSV hàng loạt */}
      {showCsvModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-csv-title"
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl p-6 space-y-4">
            <h3
              id="modal-csv-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-white"
            >
              Nhập danh sách Học sinh từ CSV · Lớp {activeClass?.name}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dán danh sách mỗi học sinh một dòng theo định dạng: Họ tên, Mã HS. Hệ thống tự động chuẩn hóa mật khẩu mặc định tiếng Việt không dấu.
            </p>
            <form onSubmit={handleImportCsv} className="space-y-4">
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                aria-label="Nội dung CSV danh sách học sinh"
                className="w-full p-3 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 px-3">Mã HS</th>
                      <th className="py-2 px-3">Họ tên</th>
                      <th className="py-2 px-3">Mật khẩu mặc định</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsedCsv.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="py-1.5 px-3 font-mono">{r.studentCode}</td>
                        <td className="py-1.5 px-3">{r.fullName}</td>
                        <td className="py-1.5 px-3 font-mono text-blue-600 dark:text-blue-400">
                          {r.defaultPassword}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCsvModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={busy || parsedCsv.rows.length === 0}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  Nhập {parsedCsv.rows.length} học sinh
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
