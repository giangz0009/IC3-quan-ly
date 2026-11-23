import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronRight,
  GraduationCap,
  KeyRound,
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AdminDatabase,
  School,
  SchoolClass,
  StudentProfile,
} from '../types/ic3';
import { api, type SafeTeacher } from '../utils/api';
import {
  filterClassesByGradeAndQuery,
  filterSchools,
  filterStudentsByStatusAndQuery,
  getTeacherPermissions,
  normalizeVietnamesePassword,
  parseStudentsCsv,
  summarizeClassStudentStats,
  summarizeSchoolHierarchyStats,
  type StudentStatusFilter,
} from '../utils/ic3Rules';

interface SchoolsStudentsViewProps {
  db: Omit<AdminDatabase, 'teachers'> & { teachers: SafeTeacher[] };
  currentTeacher: SafeTeacher;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
  onOpenTeachersTab?: () => void;
}

type ConfirmAction =
  | { type: 'delete_school'; school: School; classCount: number; studentCount: number }
  | { type: 'delete_class'; schoolClass: SchoolClass; studentCount: number }
  | { type: 'delete_student'; student: StudentProfile }
  | { type: 'reset_class_passwords'; schoolClass: SchoolClass; studentCount: number };

export const SchoolsStudentsView: React.FC<SchoolsStudentsViewProps> = ({
  db,
  currentTeacher,
  onRefresh,
  onNotify,
  onOpenTeachersTab,
}) => {
  const permissions = getTeacherPermissions(currentTeacher.role);
  const scopedSchools = db.schools;

  // 3-step drill-down state: null -> Step 1 (Schools), schoolId -> Step 2 (Classes), classId -> Step 3 (Students)
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  // Per-tier search & filter state
  const [schoolSearch, setSchoolSearch] = useState('');
  const [classSearch, setClassSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [studentSearch, setStudentSearch] = useState('');
  const [studentStatusFilter, setStudentStatusFilter] =
    useState<StudentStatusFilter>('all');

  // Add / Edit Modals
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [schoolForm, setSchoolForm] = useState({ name: '', district: '' });

  const [showClassModal, setShowClassModal] = useState(false);
  const [editingClass, setEditingClass] = useState<SchoolClass | null>(null);
  const [classForm, setClassForm] = useState({ name: '', grade: 'Khối 6' });

  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentProfile | null>(null);
  const [studentForm, setStudentForm] = useState({
    fullName: '',
    studentCode: '',
    alwaysBreakReady: false,
  });

  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState(
    'Họ tên,Mã HS\nNguyễn Hoàng Nam,6A1-06\nTrần Ngọc Hân,6A1-07'
  );

  // Confirm Modal for destructive / bulk operations
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hasOpenModal =
      showSchoolModal ||
      showClassModal ||
      showStudentModal ||
      showCsvModal ||
      confirmAction !== null;
    if (!hasOpenModal) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy) return;
      if (confirmAction) {
        setConfirmAction(null);
      } else if (showCsvModal) {
        setShowCsvModal(false);
      } else if (showStudentModal) {
        setShowStudentModal(false);
        setEditingStudent(null);
      } else if (showClassModal) {
        setShowClassModal(false);
        setEditingClass(null);
      } else if (showSchoolModal) {
        setShowSchoolModal(false);
        setEditingSchool(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    showSchoolModal,
    showClassModal,
    showStudentModal,
    showCsvModal,
    confirmAction,
    busy,
  ]);

  const activeSchool: School | null = useMemo(
    () =>
      selectedSchoolId
        ? scopedSchools.find((s) => s.id === selectedSchoolId) ?? null
        : null,
    [scopedSchools, selectedSchoolId]
  );

  const schoolClasses = useMemo(
    () =>
      activeSchool
        ? db.classes.filter((c) => c.schoolId === activeSchool.id)
        : [],
    [db.classes, activeSchool]
  );

  const activeClass: SchoolClass | null = useMemo(
    () =>
      activeSchool && selectedClassId
        ? schoolClasses.find((c) => c.id === selectedClassId) ?? null
        : null,
    [activeSchool, schoolClasses, selectedClassId]
  );

  const classStudents = useMemo(
    () =>
      activeClass
        ? db.students.filter((st) => st.classId === activeClass.id)
        : [],
    [db.students, activeClass]
  );

  const filteredSchools = useMemo(
    () => filterSchools(scopedSchools, schoolSearch),
    [scopedSchools, schoolSearch]
  );

  const availableGrades = useMemo(() => {
    const baseGrades = ['Khối 6', 'Khối 7', 'Khối 8', 'Khối 9'];
    const present = new Set(schoolClasses.map((c) => c.grade));
    const extras = Array.from(present).filter((g) => !baseGrades.includes(g));
    const merged = [...baseGrades.filter((g) => present.has(g)), ...extras];
    return merged;
  }, [schoolClasses]);

  const filteredClasses = useMemo(
    () => filterClassesByGradeAndQuery(schoolClasses, gradeFilter, classSearch),
    [schoolClasses, gradeFilter, classSearch]
  );

  const filteredStudents = useMemo(
    () =>
      filterStudentsByStatusAndQuery(
        classStudents,
        studentStatusFilter,
        studentSearch
      ),
    [classStudents, studentStatusFilter, studentSearch]
  );

  const activeSchoolStats = useMemo(
    () =>
      activeSchool
        ? summarizeSchoolHierarchyStats(activeSchool.id, db.classes, db.students)
        : { classCount: 0, studentCount: 0, classNames: [] },
    [activeSchool, db.classes, db.students]
  );

  function selectSchool(schoolId: string) {
    setSelectedSchoolId(schoolId);
    setSelectedClassId(null);
    setClassSearch('');
    setGradeFilter('all');
    setStudentSearch('');
    setStudentStatusFilter('all');
  }

  function selectClass(classId: string) {
    setSelectedClassId(classId);
    setStudentSearch('');
    setStudentStatusFilter('all');
  }

  function handleStepBack() {
    if (activeClass) {
      setSelectedClassId(null);
      setStudentSearch('');
      setStudentStatusFilter('all');
      return;
    }
    if (activeSchool) {
      setSelectedSchoolId(null);
      setClassSearch('');
      setGradeFilter('all');
    }
  }

  function openCreateSchoolModal() {
    setEditingSchool(null);
    setSchoolForm({ name: '', district: '' });
    setShowSchoolModal(true);
  }

  function openEditSchoolModal(school: School) {
    setEditingSchool(school);
    setSchoolForm({ name: school.name, district: school.district });
    setShowSchoolModal(true);
  }

  async function handleSaveSchool(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editingSchool) {
        const updated = await api.updateSchool(editingSchool.id, schoolForm);
        await onRefresh();
        setShowSchoolModal(false);
        setEditingSchool(null);
        setSchoolForm({ name: '', district: '' });
        onNotify(`Đã cập nhật trường ${updated.name}.`);
      } else {
        const created = await api.createSchool(schoolForm);
        await onRefresh();
        setShowSchoolModal(false);
        setSchoolForm({ name: '', district: '' });
        onNotify(`Đã thêm trường ${created.name}.`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : editingSchool
            ? 'Lỗi cập nhật trường.'
            : 'Lỗi tạo trường.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  function openCreateClassModal() {
    if (!activeSchool) return;
    setEditingClass(null);
    setClassForm({ name: '', grade: 'Khối 6' });
    setShowClassModal(true);
  }

  function openEditClassModal(cls: SchoolClass) {
    setEditingClass(cls);
    setClassForm({ name: cls.name, grade: cls.grade });
    setShowClassModal(true);
  }

  async function handleSaveClass(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSchool && !editingClass) return;
    setBusy(true);
    try {
      if (editingClass) {
        const updated = await api.updateClass(editingClass.id, classForm);
        await onRefresh();
        setShowClassModal(false);
        setEditingClass(null);
        setClassForm({ name: '', grade: 'Khối 6' });
        onNotify(`Đã cập nhật lớp ${updated.name}.`);
      } else if (activeSchool) {
        const created = await api.createClass({
          schoolId: activeSchool.id,
          ...classForm,
        });
        await onRefresh();
        setShowClassModal(false);
        setClassForm({ name: '', grade: 'Khối 6' });
        onNotify(`Đã thêm lớp ${created.name}.`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : editingClass
            ? 'Lỗi cập nhật lớp.'
            : 'Lỗi tạo lớp.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  function openCreateStudentModal() {
    if (!activeClass) return;
    setEditingStudent(null);
    setStudentForm({ fullName: '', studentCode: '', alwaysBreakReady: false });
    setShowStudentModal(true);
  }

  function openEditStudentModal(student: StudentProfile) {
    setEditingStudent(student);
    setStudentForm({
      fullName: student.fullName,
      studentCode: student.studentCode,
      alwaysBreakReady: Boolean(student.alwaysBreakReady),
    });
    setShowStudentModal(true);
  }

  async function handleSaveStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!activeClass && !editingStudent) return;
    setBusy(true);
    try {
      if (editingStudent) {
        const updated = await api.updateStudent(editingStudent.id, studentForm);
        await onRefresh();
        setShowStudentModal(false);
        setEditingStudent(null);
        setStudentForm({ fullName: '', studentCode: '', alwaysBreakReady: false });
        onNotify(`Đã cập nhật thông tin học sinh ${updated.fullName}.`);
      } else if (activeClass) {
        const created = await api.createStudent({
          classId: activeClass.id,
          ...studentForm,
        });
        await onRefresh();
        setShowStudentModal(false);
        setStudentForm({ fullName: '', studentCode: '', alwaysBreakReady: false });
        onNotify(
          `Đã thêm học sinh ${created.fullName} (mật khẩu mặc định: ${created.passwordHash}).`
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : editingStudent
            ? 'Lỗi cập nhật học sinh.'
            : 'Lỗi thêm học sinh.',
        true
      );
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
    if (!activeClass || parsedCsv.rows.length === 0) return;
    setBusy(true);
    try {
      const res = await api.batchImportStudents(
        activeClass.id,
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

  async function handleExecuteConfirmAction() {
    if (!confirmAction) return;
    setBusy(true);
    try {
      if (confirmAction.type === 'delete_school') {
        await api.deleteSchool(confirmAction.school.id);
        if (selectedSchoolId === confirmAction.school.id) {
          setSelectedSchoolId(null);
          setSelectedClassId(null);
        }
        await onRefresh();
        onNotify(`Đã xóa trường ${confirmAction.school.name}.`);
      } else if (confirmAction.type === 'delete_class') {
        await api.deleteClass(confirmAction.schoolClass.id);
        if (selectedClassId === confirmAction.schoolClass.id) {
          setSelectedClassId(null);
        }
        await onRefresh();
        onNotify(`Đã xóa lớp ${confirmAction.schoolClass.name}.`);
      } else if (confirmAction.type === 'delete_student') {
        await api.deleteStudent(confirmAction.student.id);
        await onRefresh();
        onNotify(`Đã xóa học sinh ${confirmAction.student.fullName}.`);
      } else if (confirmAction.type === 'reset_class_passwords') {
        const res = await api.resetClassPasswords(confirmAction.schoolClass.id);
        await onRefresh();
        onNotify(
          `Đã đặt lại mật khẩu mặc định cho ${res.count} học sinh lớp ${confirmAction.schoolClass.name}.`
        );
      }
      setConfirmAction(null);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể thực hiện thao tác.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Bar: Hierarchy Overview Metadata + Contextual Primary CTA */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
          <span>
            <strong className="text-slate-900 dark:text-white">{db.schools.length}</strong>{' '}
            trường học
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="text-slate-900 dark:text-white">{db.classes.length}</strong>{' '}
            lớp học
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="text-slate-900 dark:text-white">{db.students.length}</strong>{' '}
            học sinh
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {permissions.canManageTeachers && onOpenTeachersTab && (
            <button
              type="button"
              onClick={onOpenTeachersTab}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Quản lý Giáo viên ({db.teachers.length})</span>
            </button>
          )}

          {!activeSchool && permissions.canManageSchools && (
            <button
              type="button"
              onClick={openCreateSchoolModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Thêm Trường học</span>
            </button>
          )}

          {activeSchool && !activeClass && (
            <button
              type="button"
              onClick={openCreateClassModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <GraduationCap className="w-3.5 h-3.5" />
              <span>Thêm Lớp học</span>
            </button>
          )}

          {activeSchool && activeClass && (
            <>
              <button
                type="button"
                onClick={() => setShowCsvModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Nhập CSV</span>
              </button>
              <button
                type="button"
                onClick={openCreateStudentModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Thêm Học sinh</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Hierarchical Breadcrumb Bar */}
      {activeSchool && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Đường dẫn phân cấp trường lớp học sinh"
            className="flex flex-wrap items-center gap-1.5 text-xs"
          >
            <button
              type="button"
              onClick={() => {
                setSelectedSchoolId(null);
                setSelectedClassId(null);
              }}
              className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              Tất cả Trường học
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <button
              type="button"
              onClick={() => setSelectedClassId(null)}
              className={`cursor-pointer whitespace-nowrap ${
                activeClass
                  ? 'font-medium text-blue-600 dark:text-blue-400 hover:underline'
                  : 'font-semibold text-slate-900 dark:text-white'
              }`}
            >
              {activeSchool.name}
            </button>
            {activeClass && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                  Lớp {activeClass.name} ({activeClass.grade})
                </span>
              </>
            )}
          </nav>

          <button
            type="button"
            onClick={handleStepBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Quay lại</span>
          </button>
        </div>
      )}

      {/* STEP 1: Trường học (Tổng quát nhất) */}
      {!activeSchool && (
        <section aria-label="Chọn Trường học" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Bước 1: Chọn hoặc Quản lý Trường học
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Chọn một trường học để quản lý danh sách các lớp và học sinh trực thuộc, hoặc thêm/chỉnh sửa thông tin trường học.
              </p>
            </div>

            {scopedSchools.length > 0 && (
              <div className="relative w-full sm:w-72 shrink-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={schoolSearch}
                  onChange={(e) => setSchoolSearch(e.target.value)}
                  placeholder="Tìm trường theo tên, quận/huyện..."
                  aria-label="Tìm kiếm trường học"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}
          </div>

          {scopedSchools.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Hệ thống chưa có trường học nào.
              </p>
              {permissions.canManageSchools && (
                <button
                  type="button"
                  onClick={openCreateSchoolModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Thêm Trường học đầu tiên</span>
                </button>
              )}
            </div>
          ) : filteredSchools.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-2">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Không tìm thấy trường học nào khớp từ khóa "{schoolSearch}".
              </p>
              <button
                type="button"
                onClick={() => setSchoolSearch('')}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Xóa từ khóa tìm kiếm
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSchools.map((school) => {
                const stats = summarizeSchoolHierarchyStats(
                  school.id,
                  db.classes,
                  db.students
                );
                return (
                  <article
                    key={school.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl flex flex-col justify-between transition-colors group"
                  >
                    <button
                      type="button"
                      onClick={() => selectSchool(school.id)}
                      className="w-full flex-1 text-left p-5 space-y-2 cursor-pointer rounded-t-xl"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 truncate">
                          {school.district}
                        </span>
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                          {stats.classCount} lớp · {stats.studentCount} học sinh
                        </span>
                      </div>
                      <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {school.name}
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400 pt-1">
                        {stats.classNames.length > 0 ? (
                          <span>
                            Các lớp:{' '}
                            <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                              {stats.classNames.join(' · ')}
                            </span>
                          </span>
                        ) : (
                          'Chưa có lớp học nào'
                        )}
                      </div>
                    </button>

                    <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        {permissions.canManageSchools && (
                          <>
                            <button
                              type="button"
                              aria-label={`Sửa trường ${school.name}`}
                              onClick={() => openEditSchoolModal(school)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Sửa</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Xóa trường ${school.name}`}
                              onClick={() =>
                                setConfirmAction({
                                  type: 'delete_school',
                                  school,
                                  classCount: stats.classCount,
                                  studentCount: stats.studentCount,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Xóa</span>
                            </button>
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => selectSchool(school.id)}
                        className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer ml-auto whitespace-nowrap"
                      >
                        <span>Mở danh sách lớp</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* STEP 2: Lớp học thuộc Trường đang chọn */}
      {activeSchool && !activeClass && (
        <section aria-label="Chọn Lớp học" className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Bước 2: Chọn hoặc Quản lý Lớp học — {activeSchool.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {activeSchool.district} · {activeSchoolStats.classCount} lớp ·{' '}
                {activeSchoolStats.studentCount} học sinh. Chọn một lớp để quản lý danh sách học sinh và mật khẩu.
              </p>
            </div>
          </div>

          {schoolClasses.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={classSearch}
                  onChange={(e) => setClassSearch(e.target.value)}
                  placeholder="Tìm lớp học (VD: 6A1, 7A2)..."
                  aria-label="Tìm kiếm lớp học"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {availableGrades.length > 1 && (
                <div
                  role="group"
                  aria-label="Lọc theo khối lớp"
                  className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80"
                >
                  <button
                    type="button"
                    onClick={() => setGradeFilter('all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      gradeFilter === 'all'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Tất cả ({schoolClasses.length})
                  </button>
                  {availableGrades.map((grade) => {
                    const count = schoolClasses.filter((c) => c.grade === grade).length;
                    return (
                      <button
                        key={grade}
                        type="button"
                        onClick={() => setGradeFilter(grade)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          gradeFilter === grade
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {grade} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {schoolClasses.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Trường {activeSchool.name} hiện chưa có lớp học nào.
              </p>
              <button
                type="button"
                onClick={openCreateClassModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
              >
                <GraduationCap className="w-3.5 h-3.5" />
                <span>Thêm Lớp học đầu tiên</span>
              </button>
            </div>
          ) : filteredClasses.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-2">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Không có lớp học nào khớp bộ lọc hiện tại.
              </p>
              <button
                type="button"
                onClick={() => {
                  setClassSearch('');
                  setGradeFilter('all');
                }}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredClasses.map((cls) => {
                const stats = summarizeClassStudentStats(cls.id, db.students);
                return (
                  <article
                    key={cls.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl flex flex-col justify-between transition-colors group"
                  >
                    <button
                      type="button"
                      onClick={() => selectClass(cls.id)}
                      className="w-full flex-1 text-left p-5 space-y-2 cursor-pointer rounded-t-xl"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                          {cls.grade}
                        </span>
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                          {stats.studentCount} học sinh
                        </span>
                      </div>
                      <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        Lớp {cls.name}
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums pt-1">
                        {stats.studentCount > 0 ? (
                          <span>
                            {stats.customPasswordCount} đã tự đổi MK ·{' '}
                            {stats.breakReadyCount} bật giải lao demo
                          </span>
                        ) : (
                          'Chưa có học sinh nào trong lớp'
                        )}
                      </div>
                    </button>

                    <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`Sửa lớp ${cls.name}`}
                          onClick={() => openEditClassModal(cls)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Sửa</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Xóa lớp ${cls.name}`}
                          onClick={() =>
                            setConfirmAction({
                              type: 'delete_class',
                              schoolClass: cls,
                              studentCount: stats.studentCount,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Xóa</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => selectClass(cls.id)}
                        className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer ml-auto whitespace-nowrap"
                      >
                        <span>Mở danh sách học sinh</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* STEP 3: Danh sách Học sinh của Lớp đang chọn (Chi tiết nhất) */}
      {activeSchool && activeClass && (
        <section aria-label="Danh sách Học sinh của lớp" className="space-y-4">
          {/* Class Summary Header Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {activeSchool.name} · {activeClass.grade} · Lớp{' '}
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  {activeClass.name}
                </span>{' '}
                · {classStudents.length} học sinh
              </div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Danh sách Học sinh · Lớp {activeClass.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Mật khẩu mặc định: Họ tên viết thường không dấu, bỏ khoảng trắng (vd: Đỗ Gia Huy → dogiahuy).
              </p>
            </div>

            {classStudents.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setConfirmAction({
                    type: 'reset_class_passwords',
                    schoolClass: activeClass,
                    studentCount: classStudents.length,
                  })
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start lg:self-auto"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Reset mật khẩu cả lớp</span>
              </button>
            )}
          </div>

          {/* Search & Status Filter Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-8 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Tìm học sinh theo họ tên hoặc mã số..."
                aria-label="Tìm kiếm học sinh"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <select
              aria-label="Lọc theo trạng thái học sinh"
              value={studentStatusFilter}
              onChange={(e) =>
                setStudentStatusFilter(e.target.value as StudentStatusFilter)
              }
              className="sm:col-span-4 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">Tất cả học sinh ({classStudents.length})</option>
              <option value="default_pw">Dùng mật khẩu mặc định</option>
              <option value="custom_pw">Đã tự đổi mật khẩu</option>
              <option value="break_ready">Đang bật giải lao demo</option>
            </select>
          </div>

          {/* Students Data Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 whitespace-nowrap">
                    <th className="py-3 pl-5 pr-4 font-medium">Mã HS</th>
                    <th className="py-3 pr-4 font-medium">Họ và tên</th>
                    <th className="py-3 pr-4 font-medium">Mật khẩu hiện hành</th>
                    <th className="py-3 pr-4 font-medium">Giải lao demo</th>
                    <th className="py-3 pl-4 pr-5 text-right font-medium">Thao tác</th>
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
                        <td className="py-2.5 pl-5 pr-4 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
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
                            disabled={busy}
                            onClick={() => handleToggleBreakReady(st)}
                            className={`text-xs font-medium hover:underline disabled:opacity-50 cursor-pointer whitespace-nowrap ${
                              st.alwaysBreakReady
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {st.alwaysBreakReady ? 'Luôn mở khóa' : 'Theo nhiệm vụ'}
                          </button>
                        </td>
                        <td className="py-2.5 pl-4 pr-5 text-right whitespace-nowrap space-x-3">
                          <button
                            type="button"
                            aria-label={`Sửa học sinh ${st.fullName}`}
                            onClick={() => openEditStudentModal(st)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Sửa</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleResetPassword(st)}
                            className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            Reset MK
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Xóa học sinh ${st.fullName}`}
                            onClick={() =>
                              setConfirmAction({
                                type: 'delete_student',
                                student: st,
                              })
                            }
                            className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 cursor-pointer"
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
                        className="py-10 px-6 text-center text-sm text-slate-500 dark:text-slate-400 space-y-3"
                      >
                        <div>
                          {classStudents.length === 0
                            ? `Lớp ${activeClass.name} chưa có học sinh nào.`
                            : 'Chưa có học sinh nào khớp bộ lọc hiện tại.'}
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {classStudents.length === 0 ? (
                            <>
                              <button
                                type="button"
                                onClick={openCreateStudentModal}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                                <span>Thêm Học sinh</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowCsvModal(true)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                <span>Nhập CSV</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setStudentSearch('');
                                setStudentStatusFilter('all');
                              }}
                              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              Đặt lại bộ lọc
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Modal: Thêm / Sửa Trường học */}
      {showSchoolModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-school-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => {
            if (!busy) {
              setShowSchoolModal(false);
              setEditingSchool(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <h3
                id="modal-school-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingSchool ? 'Chỉnh sửa Trường học' : 'Thêm Trường học mới'}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại trường học"
                disabled={busy}
                onClick={() => {
                  setShowSchoolModal(false);
                  setEditingSchool(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={handleSaveSchool}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div>
                <label
                  htmlFor="school-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label
                  htmlFor="school-district"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setShowSchoolModal(false);
                    setEditingSchool(null);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingSchool ? 'Lưu thay đổi' : 'Lưu Trường học'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Thêm / Sửa Lớp học */}
      {showClassModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-class-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => {
            if (!busy) {
              setShowClassModal(false);
              setEditingClass(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <h3
                id="modal-class-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingClass
                  ? `Chỉnh sửa Lớp ${editingClass.name}`
                  : `Thêm Lớp học · ${activeSchool?.name ?? ''}`}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại lớp học"
                disabled={busy}
                onClick={() => {
                  setShowClassModal(false);
                  setEditingClass(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={handleSaveClass}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div>
                <label
                  htmlFor="class-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label
                  htmlFor="class-grade"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Khối lớp
                </label>
                <select
                  id="class-grade"
                  value={classForm.grade}
                  onChange={(e) =>
                    setClassForm({ ...classForm, grade: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                  disabled={busy}
                  onClick={() => {
                    setShowClassModal(false);
                    setEditingClass(null);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingClass ? 'Lưu thay đổi' : 'Tạo Lớp học'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Thêm / Sửa Học sinh */}
      {showStudentModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-student-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => {
            if (!busy) {
              setShowStudentModal(false);
              setEditingStudent(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <h3
                id="modal-student-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingStudent
                  ? `Chỉnh sửa Học sinh · ${editingStudent.fullName}`
                  : `Thêm Học sinh · Lớp ${activeClass?.name ?? ''}`}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại học sinh"
                disabled={busy}
                onClick={() => {
                  setShowStudentModal(false);
                  setEditingStudent(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={handleSaveStudent}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div>
                <label
                  htmlFor="st-fullname"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label
                  htmlFor="st-code"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {!editingStudent && (
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
              )}

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
                  disabled={busy}
                  onClick={() => {
                    setShowStudentModal(false);
                    setEditingStudent(null);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingStudent ? 'Lưu thay đổi' : 'Lưu Học sinh'}</span>
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
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => !busy && setShowCsvModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <h3
                id="modal-csv-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                Nhập danh sách Học sinh từ CSV · Lớp {activeClass?.name}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại nhập CSV"
                disabled={busy}
                onClick={() => setShowCsvModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={handleImportCsv}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dán danh sách mỗi học sinh một dòng theo định dạng: Họ tên, Mã HS. Hệ thống tự động chuẩn hóa mật khẩu mặc định tiếng Việt không dấu.
              </p>
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                aria-label="Nội dung CSV danh sách học sinh"
                className="w-full p-3 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <div className="max-h-44 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
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
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowCsvModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={busy || parsedCsv.rows.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Nhập {parsedCsv.rows.length} học sinh</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Modal Box (Xóa Trường / Lớp / Học sinh / Reset mật khẩu lớp) */}
      {confirmAction && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="schools-confirm-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => !busy && setConfirmAction(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-lg shrink-0 ${
                    confirmAction.type === 'reset_class_passwords'
                      ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                      : 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1.5">
                  <h3
                    id="schools-confirm-modal-title"
                    className="font-display text-base font-semibold text-slate-900 dark:text-white"
                  >
                    {confirmAction.type === 'delete_school' &&
                      'Xác nhận xóa Trường học'}
                    {confirmAction.type === 'delete_class' &&
                      'Xác nhận xóa Lớp học'}
                    {confirmAction.type === 'delete_student' &&
                      'Xác nhận xóa Học sinh'}
                    {confirmAction.type === 'reset_class_passwords' &&
                      'Xác nhận Reset mật khẩu cả lớp'}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {confirmAction.type === 'delete_school' && (
                      <>
                        Bạn có chắc chắn muốn xóa trường{' '}
                        <strong className="text-slate-900 dark:text-white">
                          {confirmAction.school.name}
                        </strong>
                        ? Toàn bộ{' '}
                        <strong className="tabular-nums">
                          {confirmAction.classCount} lớp học
                        </strong>{' '}
                        và{' '}
                        <strong className="tabular-nums">
                          {confirmAction.studentCount} học sinh
                        </strong>{' '}
                        thuộc trường này sẽ bị xóa vĩnh viễn.
                      </>
                    )}
                    {confirmAction.type === 'delete_class' && (
                      <>
                        Bạn có chắc chắn muốn xóa{' '}
                        <strong className="text-slate-900 dark:text-white">
                          Lớp {confirmAction.schoolClass.name}
                        </strong>
                        ? Toàn bộ{' '}
                        <strong className="tabular-nums">
                          {confirmAction.studentCount} học sinh
                        </strong>{' '}
                        và dữ liệu bài tập, thi đấu của lớp này sẽ bị xóa vĩnh viễn.
                      </>
                    )}
                    {confirmAction.type === 'delete_student' && (
                      <>
                        Bạn có chắc chắn muốn xóa học sinh{' '}
                        <strong className="text-slate-900 dark:text-white">
                          {confirmAction.student.fullName}
                        </strong>{' '}
                        (mã{' '}
                        <span className="font-mono">
                          {confirmAction.student.studentCode}
                        </span>
                        ) khỏi lớp?
                      </>
                    )}
                    {confirmAction.type === 'reset_class_passwords' && (
                      <>
                        Toàn bộ{' '}
                        <strong className="tabular-nums">
                          {confirmAction.studentCount} học sinh
                        </strong>{' '}
                        của{' '}
                        <strong className="text-slate-900 dark:text-white">
                          Lớp {confirmAction.schoolClass.name}
                        </strong>{' '}
                        sẽ được đặt lại về mật khẩu mặc định (họ tên viết thường không dấu).
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleExecuteConfirmAction}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-50 cursor-pointer ${
                    confirmAction.type === 'reset_class_passwords'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {confirmAction.type === 'reset_class_passwords'
                      ? 'Xác nhận Reset'
                      : 'Xác nhận xóa'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
