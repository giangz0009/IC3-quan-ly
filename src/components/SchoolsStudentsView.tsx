import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronRight,
  Download,
  FileSpreadsheet,
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
  formatClassesToCsv,
  formatStudentsToCsv,
  getTeacherPermissions,
  normalizeVietnamesePassword,
  parseClassesCsv,
  parseStudentsCsv,
  summarizeClassStudentStats,
  summarizeSchoolHierarchyStats,
  type ParsedClassRow,
  type ParsedStudentRow,
  type StudentStatusFilter,
} from '../utils/ic3Rules';
import {
  buildClassesExcelBuffer,
  buildClassesSampleExcelBuffer,
  buildStudentsExcelBuffer,
  buildStudentsSampleExcelBuffer,
  parseClassesExcelSheet,
  parseStudentsExcelSheet,
  readTabularExcelWorkbookBuffer,
  type ParsedExcelWorkbookData,
} from '../utils/ic3Excel';
import { CardGridSkeleton, TableSkeletonRows } from './TableSkeleton';

function slugifyFilePart(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'du-lieu'
  );
}

function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createExcelBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

interface SchoolsStudentsViewProps {
  db: Omit<AdminDatabase, 'teachers'> & { teachers: SafeTeacher[] };
  currentTeacher: SafeTeacher;
  loading?: boolean;
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
  loading = false,
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

  // Class Import / Export state
  const [showClassImportModal, setShowClassImportModal] = useState(false);
  const [classImportMode, setClassImportMode] = useState<'file' | 'paste'>('file');
  const [classPasteText, setClassPasteText] = useState(
    'Tên lớp,Khối\n6A3,Khối 6\n6A4,Khối 6\n7A3,Khối 7'
  );
  const [classExcelWb, setClassExcelWb] =
    useState<ParsedExcelWorkbookData | null>(null);
  const [classExcelSheet, setClassExcelSheet] = useState('');
  const [classImportFileName, setClassImportFileName] = useState('');
  const [classFileCsvText, setClassFileCsvText] = useState<string | null>(null);
  const [classFileError, setClassFileError] = useState<string | null>(null);
  const classFileInputRef = useRef<HTMLInputElement | null>(null);

  const [showClassExportModal, setShowClassExportModal] = useState(false);
  const [classExportScope, setClassExportScope] = useState<'all' | 'filtered'>('all');
  const [classExportFormat, setClassExportFormat] = useState<'xlsx' | 'csv'>('xlsx');

  // Student Import / Export state
  const [showStudentImportModal, setShowStudentImportModal] = useState(false);
  const [studentImportMode, setStudentImportMode] = useState<'file' | 'paste'>('file');
  const [csvText, setCsvText] = useState(
    'Họ và tên\nNguyễn Hoàng Nam\nTrần Ngọc Hân\nLê Minh Khôi'
  );
  const [studentExcelWb, setStudentExcelWb] =
    useState<ParsedExcelWorkbookData | null>(null);
  const [studentExcelSheet, setStudentExcelSheet] = useState('');
  const [studentImportFileName, setStudentImportFileName] = useState('');
  const [studentFileCsvText, setStudentFileCsvText] = useState<string | null>(null);
  const [studentFileError, setStudentFileError] = useState<string | null>(null);
  const studentFileInputRef = useRef<HTMLInputElement | null>(null);

  const [showStudentExportModal, setShowStudentExportModal] = useState(false);
  const [studentExportScope, setStudentExportScope] = useState<'all' | 'filtered'>('all');
  const [studentExportFormat, setStudentExportFormat] = useState<'xlsx' | 'csv'>('xlsx');

  // Confirm Modal for destructive / bulk operations
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hasOpenModal =
      showSchoolModal ||
      showClassModal ||
      showStudentModal ||
      showClassImportModal ||
      showClassExportModal ||
      showStudentImportModal ||
      showStudentExportModal ||
      confirmAction !== null;
    if (!hasOpenModal) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy) return;
      if (confirmAction) {
        setConfirmAction(null);
      } else if (showStudentExportModal) {
        setShowStudentExportModal(false);
      } else if (showStudentImportModal) {
        setShowStudentImportModal(false);
      } else if (showClassExportModal) {
        setShowClassExportModal(false);
      } else if (showClassImportModal) {
        setShowClassImportModal(false);
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
    showClassImportModal,
    showClassExportModal,
    showStudentImportModal,
    showStudentExportModal,
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

  const existingClassNamesSet = useMemo(
    () => new Set(schoolClasses.map((c) => c.name.trim().toLowerCase())),
    [schoolClasses]
  );

  const parsedClassImport = useMemo<{
    rows: ParsedClassRow[];
    warnings: string[];
    errors: string[];
  }>(() => {
    if (classImportMode === 'paste') {
      return parseClassesCsv(classPasteText);
    }
    if (classExcelWb) {
      return parseClassesExcelSheet(classExcelWb, classExcelSheet);
    }
    if (classFileCsvText !== null) {
      return parseClassesCsv(classFileCsvText);
    }
    return { rows: [], warnings: [], errors: [] };
  }, [
    classImportMode,
    classPasteText,
    classExcelWb,
    classExcelSheet,
    classFileCsvText,
  ]);

  const validNewClassRows = useMemo(
    () =>
      parsedClassImport.rows.filter(
        (r) => !existingClassNamesSet.has(r.name.trim().toLowerCase())
      ),
    [parsedClassImport.rows, existingClassNamesSet]
  );

  function openClassImportModal() {
    setClassImportMode('file');
    setClassExcelWb(null);
    setClassExcelSheet('');
    setClassImportFileName('');
    setClassFileCsvText(null);
    setClassFileError(null);
    setShowClassImportModal(true);
  }

  function openClassExportModal() {
    const hasFilter = Boolean(classSearch.trim()) || gradeFilter !== 'all';
    setClassExportScope(hasFilter ? 'filtered' : 'all');
    setClassExportFormat('xlsx');
    setShowClassExportModal(true);
  }

  async function handleSelectClassImportFile(file: File | undefined | null) {
    if (!file) return;
    setClassFileError(null);
    setClassImportFileName(file.name);
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        setClassExcelWb(null);
        setClassExcelSheet('');
        setClassFileCsvText(text);
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const wb = readTabularExcelWorkbookBuffer(buf, [
          'danhsachlop',
          'lop',
          'classes',
        ]);
        setClassFileCsvText(null);
        setClassExcelWb(wb);
        setClassExcelSheet(wb.activeSheetName);
        if (wb.sheetNames.length === 0) {
          setClassFileError('Tệp Excel không có sheet dữ liệu lớp học.');
        }
      } else {
        setClassExcelWb(null);
        setClassFileCsvText(null);
        setClassFileError('Chỉ hỗ trợ định dạng tệp .xlsx, .xls hoặc .csv.');
      }
    } catch {
      setClassExcelWb(null);
      setClassFileCsvText(null);
      setClassFileError('Không thể đọc tệp đã chọn. Vui lòng kiểm tra lại định dạng.');
    }
  }

  function handleDownloadClassSampleExcel() {
    const bytes = buildClassesSampleExcelBuffer(activeSchool?.name ?? '');
    triggerFileDownload(
      createExcelBlob(bytes),
      'mau-nhap-danh-sach-lop.xlsx'
    );
    onNotify('Đã tải file Excel mẫu danh sách lớp học.');
  }

  async function handleImportClasses(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSchool || validNewClassRows.length === 0) return;
    setBusy(true);
    try {
      const res = await api.batchImportClasses(activeSchool.id, validNewClassRows);
      await onRefresh();
      setShowClassImportModal(false);
      onNotify(
        `Đã nhập ${res.created.length} lớp học${
          res.skipped.length > 0 ? ` (bỏ qua ${res.skipped.length} lớp trùng tên)` : ''
        }.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Lỗi nhập danh sách lớp học.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  function handleExportClasses() {
    if (!activeSchool) return;
    const rowsToExport =
      classExportScope === 'filtered' ? filteredClasses : schoolClasses;
    if (rowsToExport.length === 0) {
      onNotify('Không có lớp học nào trong phạm vi xuất.', true);
      return;
    }
    const slug = slugifyFilePart(activeSchool.name);
    if (classExportFormat === 'xlsx') {
      const bytes = buildClassesExcelBuffer(
        rowsToExport,
        db.students,
        activeSchool.name
      );
      triggerFileDownload(
        createExcelBlob(bytes),
        `danh-sach-lop-${slug}.xlsx`
      );
    } else {
      const csv = formatClassesToCsv(rowsToExport, db.students, activeSchool.name);
      triggerFileDownload(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `danh-sach-lop-${slug}.csv`
      );
    }
    setShowClassExportModal(false);
    onNotify(
      `Đã xuất ${rowsToExport.length} lớp học ra định dạng ${classExportFormat.toUpperCase()}.`
    );
  }

  const existingStudentNamesSet = useMemo(
    () => new Set(classStudents.map((s) => s.fullName.trim().toLowerCase())),
    [classStudents]
  );

  const parsedStudentImport = useMemo<{
    rows: ParsedStudentRow[];
    warnings: string[];
    errors: string[];
  }>(() => {
    const prefix = activeClass?.name || 'HS';
    const existingList = classStudents.map((s) => s.studentCode);
    if (studentImportMode === 'paste') {
      return parseStudentsCsv(csvText, prefix, existingList);
    }
    if (studentExcelWb) {
      return parseStudentsExcelSheet(
        studentExcelWb,
        studentExcelSheet,
        prefix,
        existingList
      );
    }
    if (studentFileCsvText !== null) {
      return parseStudentsCsv(studentFileCsvText, prefix, existingList);
    }
    return { rows: [], warnings: [], errors: [] };
  }, [
    studentImportMode,
    csvText,
    studentExcelWb,
    studentExcelSheet,
    studentFileCsvText,
    activeClass?.name,
    classStudents,
  ]);

  function openStudentImportModal() {
    setStudentImportMode('file');
    setStudentExcelWb(null);
    setStudentExcelSheet('');
    setStudentImportFileName('');
    setStudentFileCsvText(null);
    setStudentFileError(null);
    setCsvText('Họ và tên\nNguyễn Hoàng Nam\nTrần Ngọc Hân\nLê Minh Khôi');
    setShowStudentImportModal(true);
  }

  function openStudentExportModal() {
    const hasFilter =
      Boolean(studentSearch.trim()) || studentStatusFilter !== 'all';
    setStudentExportScope(hasFilter ? 'filtered' : 'all');
    setStudentExportFormat('xlsx');
    setShowStudentExportModal(true);
  }

  async function handleSelectStudentImportFile(file: File | undefined | null) {
    if (!file) return;
    setStudentFileError(null);
    setStudentImportFileName(file.name);
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        setStudentExcelWb(null);
        setStudentExcelSheet('');
        setStudentFileCsvText(text);
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const wb = readTabularExcelWorkbookBuffer(buf, [
          'danhsachhocsinh',
          'hocsinh',
          'students',
        ]);
        setStudentFileCsvText(null);
        setStudentExcelWb(wb);
        setStudentExcelSheet(wb.activeSheetName);
        if (wb.sheetNames.length === 0) {
          setStudentFileError('Tệp Excel không có sheet dữ liệu học sinh.');
        }
      } else {
        setStudentExcelWb(null);
        setStudentFileCsvText(null);
        setStudentFileError('Chỉ hỗ trợ định dạng tệp .xlsx, .xls hoặc .csv.');
      }
    } catch {
      setStudentExcelWb(null);
      setStudentFileCsvText(null);
      setStudentFileError('Không thể đọc tệp đã chọn. Vui lòng kiểm tra lại định dạng.');
    }
  }

  function handleDownloadStudentSampleExcel() {
    const clsName = activeClass?.name || '6A1';
    const bytes = buildStudentsSampleExcelBuffer(clsName);
    triggerFileDownload(
      createExcelBlob(bytes),
      `mau-nhap-hoc-sinh-lop-${slugifyFilePart(clsName)}.xlsx`
    );
    onNotify('Đã tải file Excel mẫu danh sách học sinh.');
  }

  async function handleImportStudents(e: React.FormEvent) {
    e.preventDefault();
    if (!activeClass || parsedStudentImport.rows.length === 0) return;
    setBusy(true);
    try {
      const res = await api.batchImportStudents(
        activeClass.id,
        parsedStudentImport.rows.map((r) => ({
          fullName: r.fullName,
        }))
      );
      await onRefresh();
      setShowStudentImportModal(false);
      onNotify(
        `Đã nhập ${res.created.length} học sinh vào lớp ${activeClass.name}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Lỗi nhập danh sách học sinh.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  function handleExportStudents() {
    if (!activeClass) return;
    const rowsToExport =
      studentExportScope === 'filtered' ? filteredStudents : classStudents;
    if (rowsToExport.length === 0) {
      onNotify('Không có học sinh nào trong phạm vi xuất.', true);
      return;
    }
    const slug = slugifyFilePart(activeClass.name);
    if (studentExportFormat === 'xlsx') {
      const bytes = buildStudentsExcelBuffer(
        rowsToExport,
        activeClass.name,
        activeSchool?.name ?? ''
      );
      triggerFileDownload(
        createExcelBlob(bytes),
        `danh-sach-hoc-sinh-lop-${slug}.xlsx`
      );
    } else {
      const csv = formatStudentsToCsv(
        rowsToExport,
        activeClass.name,
        activeSchool?.name ?? ''
      );
      triggerFileDownload(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `danh-sach-hoc-sinh-lop-${slug}.csv`
      );
    }
    setShowStudentExportModal(false);
    onNotify(
      `Đã xuất ${rowsToExport.length} học sinh ra định dạng ${studentExportFormat.toUpperCase()}.`
    );
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
            <>
              <button
                type="button"
                disabled={schoolClasses.length === 0}
                onClick={openClassExportModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Xuất DS lớp</span>
              </button>
              <button
                type="button"
                onClick={openClassImportModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Nhập DS lớp</span>
              </button>
              <button
                type="button"
                onClick={openCreateClassModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <GraduationCap className="w-3.5 h-3.5" />
                <span>Thêm Lớp học</span>
              </button>
            </>
          )}

          {activeSchool && activeClass && (
            <>
              <button
                type="button"
                disabled={classStudents.length === 0}
                onClick={openStudentExportModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Xuất DS học sinh</span>
              </button>
              <button
                type="button"
                onClick={openStudentImportModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Nhập DS học sinh</span>
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

          {loading ? (
            <CardGridSkeleton
              count={6}
              ariaLabel="Đang tải danh sách trường học..."
            />
          ) : scopedSchools.length === 0 ? (
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

          {loading ? (
            <CardGridSkeleton
              count={6}
              ariaLabel="Đang tải danh sách lớp học..."
            />
          ) : schoolClasses.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Trường {activeSchool.name} hiện chưa có lớp học nào.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openCreateClassModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  <GraduationCap className="w-3.5 h-3.5" />
                  <span>Thêm Lớp học đầu tiên</span>
                </button>
                <button
                  type="button"
                  onClick={openClassImportModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Nhập DS lớp</span>
                </button>
              </div>
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
                {loading ? (
                  <TableSkeletonRows
                    rows={6}
                    ariaLabel="Đang tải danh sách học sinh..."
                    columns={[
                      { variant: 'mono', widths: ['w-16', 'w-20'], cellClassName: 'py-2.5 pl-5 pr-4' },
                      { variant: 'text', widths: ['w-36', 'w-44', 'w-32'], cellClassName: 'py-2.5 pr-4' },
                      { variant: 'mono', widths: ['w-24', 'w-32', 'w-28'], cellClassName: 'py-2.5 pr-4' },
                      { variant: 'text', widths: ['w-24', 'w-28'], cellClassName: 'py-2.5 pr-4' },
                      { variant: 'actions', align: 'right', cellClassName: 'py-2.5 pl-4 pr-5 text-right' },
                    ]}
                  />
                ) : (
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
                                  onClick={openStudentImportModal}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                                >
                                  <Upload className="w-3.5 h-3.5" />
                                  <span>Nhập DS học sinh</span>
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
                )}
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

      {/* Modal: Nhập danh sách Lớp học (Excel / CSV) */}
      {showClassImportModal && activeSchool && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-class-import-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => !busy && setShowClassImportModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div>
                <h3
                  id="modal-class-import-title"
                  className="font-display text-base font-semibold text-slate-900 dark:text-white"
                >
                  Nhập danh sách Lớp học · {activeSchool.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Hỗ trợ tải tệp Excel (.xlsx/.xls), CSV (.csv) hoặc dán trực tiếp danh sách lớp.
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng hộp thoại nhập danh sách lớp"
                disabled={busy}
                onClick={() => setShowClassImportModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleImportClasses}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label="Phương thức nhập danh sách lớp"
                  className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-slate-800"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={classImportMode === 'file'}
                    onClick={() => setClassImportMode('file')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      classImportMode === 'file'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Tải tệp Excel / CSV
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={classImportMode === 'paste'}
                    onClick={() => setClassImportMode('paste')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      classImportMode === 'paste'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Dán văn bản CSV
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadClassSampleExcel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Tải file Excel mẫu</span>
                </button>
              </div>

              {classImportMode === 'file' ? (
                <div className="space-y-3">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void handleSelectClassImportFile(e.dataTransfer.files?.[0]);
                    }}
                    className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-5 text-center space-y-2 bg-slate-50/60 dark:bg-slate-950/60"
                  >
                    <input
                      ref={classFileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,.txt"
                      aria-label="Chọn tệp Excel hoặc CSV danh sách lớp"
                      onChange={(e) => {
                        void handleSelectClassImportFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <FileSpreadsheet className="w-7 h-7 mx-auto text-blue-600 dark:text-blue-400" />
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {classImportFileName ? (
                        <span>
                          Đã chọn:{' '}
                          <strong className="font-mono text-slate-900 dark:text-white">
                            {classImportFileName}
                          </strong>
                        </span>
                      ) : (
                        'Kéo thả tệp .xlsx, .xls, .csv vào đây hoặc nhấn để chọn tệp'
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => classFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{classImportFileName ? 'Chọn tệp khác' : 'Chọn tệp từ máy'}</span>
                    </button>
                  </div>

                  {classExcelWb && classExcelWb.sheetNames.length > 1 && (
                    <div className="flex items-center gap-3">
                      <label
                        htmlFor="class-sheet-select"
                        className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap"
                      >
                        Sheet dữ liệu:
                      </label>
                      <select
                        id="class-sheet-select"
                        value={classExcelSheet}
                        onChange={(e) => setClassExcelSheet(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        {classExcelWb.sheetNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {classFileError && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                      {classFileError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Mỗi lớp một dòng theo định dạng: Tên lớp, Khối (VD: 6A3, Khối 6 hoặc chỉ nhập tên lớp để tự nhận khối).
                  </p>
                  <textarea
                    rows={4}
                    value={classPasteText}
                    onChange={(e) => setClassPasteText(e.target.value)}
                    aria-label="Nội dung CSV danh sách lớp học"
                    className="w-full p-3 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              {(parsedClassImport.errors.length > 0 ||
                parsedClassImport.warnings.length > 0) && (
                <div className="p-3 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-xs space-y-1">
                  {parsedClassImport.errors.map((err, i) => (
                    <div key={`ce-${i}`} className="text-red-600 dark:text-red-400">
                      {err}
                    </div>
                  ))}
                  {parsedClassImport.warnings.map((w, i) => (
                    <div key={`cw-${i}`} className="text-amber-700 dark:text-amber-300">
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {parsedClassImport.rows.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                    <span>
                      Xem trước ({parsedClassImport.rows.length} dòng)
                    </span>
                    <span>
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {validNewClassRows.length} lớp mới
                      </strong>
                      {parsedClassImport.rows.length - validNewClassRows.length > 0 && (
                        <>
                          {' '}
                          ·{' '}
                          <strong className="text-amber-600 dark:text-amber-400">
                            {parsedClassImport.rows.length - validNewClassRows.length} trùng tên
                          </strong>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                          <th className="py-2 px-3">Tên lớp</th>
                          <th className="py-2 px-3">Khối (chuẩn hóa)</th>
                          <th className="py-2 px-3 text-right">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {parsedClassImport.rows.map((r, i) => {
                          const isDup = existingClassNamesSet.has(
                            r.name.trim().toLowerCase()
                          );
                          return (
                            <tr key={`${r.name}-${i}`}>
                              <td className="py-1.5 px-3 font-mono font-semibold">
                                {r.name}
                              </td>
                              <td className="py-1.5 px-3">{r.grade}</td>
                              <td className="py-1.5 px-3 text-right whitespace-nowrap">
                                {isDup ? (
                                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                                    Đã tồn tại (bỏ qua)
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    Hợp lệ
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowClassImportModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={busy || validNewClassRows.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Nhập {validNewClassRows.length} lớp mới</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Xuất danh sách Lớp học (Excel / CSV) */}
      {showClassExportModal && activeSchool && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-class-export-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowClassExportModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <h3
                id="modal-class-export-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                Xuất danh sách Lớp học · {activeSchool.name}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại xuất danh sách lớp"
                onClick={() => setShowClassExportModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Phạm vi dữ liệu
                </span>
                <div className="space-y-1.5 text-xs">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="class-export-scope"
                      checked={classExportScope === 'all'}
                      onChange={() => setClassExportScope('all')}
                    />
                    <span>
                      Toàn bộ lớp của trường ({schoolClasses.length} lớp)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="class-export-scope"
                      checked={classExportScope === 'filtered'}
                      onChange={() => setClassExportScope('filtered')}
                    />
                    <span>
                      Theo bộ lọc hiện tại ({filteredClasses.length} lớp)
                    </span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Định dạng tệp
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setClassExportFormat('xlsx')}
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      classExportFormat === 'xlsx'
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-semibold">Excel (.xlsx)</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Kèm sheet Hướng dẫn & thống kê sĩ số
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setClassExportFormat('csv')}
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      classExportFormat === 'csv'
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-semibold">CSV (.csv)</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      UTF-8 BOM chuẩn tiếng Việt
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowClassExportModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleExportClasses}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Tải xuống {classExportFormat.toUpperCase()}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nhập danh sách Học sinh (Excel / CSV) */}
      {showStudentImportModal && activeClass && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-student-import-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => !busy && setShowStudentImportModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div>
                <h3
                  id="modal-student-import-title"
                  className="font-display text-base font-semibold text-slate-900 dark:text-white"
                >
                  Nhập danh sách Học sinh · Lớp {activeClass.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Tải tệp Excel/CSV hoặc dán cột Họ và tên. Mã HS được tự đánh nối tiếp và Giải lao demo đặt mặc định.
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng hộp thoại nhập học sinh"
                disabled={busy}
                onClick={() => setShowStudentImportModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleImportStudents}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label="Phương thức nhập danh sách học sinh"
                  className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-slate-800"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={studentImportMode === 'file'}
                    onClick={() => setStudentImportMode('file')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      studentImportMode === 'file'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Tải tệp Excel / CSV
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={studentImportMode === 'paste'}
                    onClick={() => setStudentImportMode('paste')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      studentImportMode === 'paste'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Dán văn bản CSV
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadStudentSampleExcel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Tải file Excel mẫu</span>
                </button>
              </div>

              {studentImportMode === 'file' ? (
                <div className="space-y-3">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void handleSelectStudentImportFile(
                        e.dataTransfer.files?.[0]
                      );
                    }}
                    className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-5 text-center space-y-2 bg-slate-50/60 dark:bg-slate-950/60"
                  >
                    <input
                      ref={studentFileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,.txt"
                      aria-label="Chọn tệp Excel hoặc CSV danh sách học sinh"
                      onChange={(e) => {
                        void handleSelectStudentImportFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <FileSpreadsheet className="w-7 h-7 mx-auto text-blue-600 dark:text-blue-400" />
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {studentImportFileName ? (
                        <span>
                          Đã chọn:{' '}
                          <strong className="font-mono text-slate-900 dark:text-white">
                            {studentImportFileName}
                          </strong>
                        </span>
                      ) : (
                        'Kéo thả tệp .xlsx, .xls, .csv vào đây hoặc nhấn để chọn tệp'
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => studentFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {studentImportFileName ? 'Chọn tệp khác' : 'Chọn tệp từ máy'}
                      </span>
                    </button>
                  </div>

                  {studentExcelWb && studentExcelWb.sheetNames.length > 1 && (
                    <div className="flex items-center gap-3">
                      <label
                        htmlFor="student-sheet-select"
                        className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap"
                      >
                        Sheet dữ liệu:
                      </label>
                      <select
                        id="student-sheet-select"
                        value={studentExcelSheet}
                        onChange={(e) => setStudentExcelSheet(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        {studentExcelWb.sheetNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {studentFileError && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                      {studentFileError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chỉ cần dán danh sách Họ và tên (mỗi học sinh một dòng). Hệ thống tự đánh Mã HS nối tiếp (vd:{' '}
                    <span className="font-mono">{activeClass.name}-01</span>), sinh mật khẩu không dấu và đặt Giải lao demo về mặc định.
                  </p>
                  <textarea
                    rows={4}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    aria-label="Nội dung CSV danh sách học sinh"
                    className="w-full p-3 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              {(parsedStudentImport.errors.length > 0 ||
                parsedStudentImport.warnings.length > 0) && (
                <div className="p-3 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-xs space-y-1">
                  {parsedStudentImport.errors.map((err, i) => (
                    <div key={`se-${i}`} className="text-red-600 dark:text-red-400">
                      {err}
                    </div>
                  ))}
                  {parsedStudentImport.warnings.map((w, i) => (
                    <div key={`sw-${i}`} className="text-amber-700 dark:text-amber-300">
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {parsedStudentImport.rows.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                    <span>
                      Xem trước ({parsedStudentImport.rows.length} học sinh)
                    </span>
                    <span>
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {parsedStudentImport.rows.length} học sinh sẵn sàng nhập
                      </strong>
                    </span>
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                          <th className="py-2 px-3">Mã HS (Tự sinh)</th>
                          <th className="py-2 px-3">Họ và tên</th>
                          <th className="py-2 px-3">Mật khẩu mặc định</th>
                          <th className="py-2 px-3 text-right">Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {parsedStudentImport.rows.map((r, i) => {
                          const hasSameName = existingStudentNamesSet.has(
                            r.fullName.trim().toLowerCase()
                          );
                          return (
                            <tr key={`${r.studentCode}-${i}`}>
                              <td className="py-1.5 px-3 font-mono">{r.studentCode}</td>
                              <td className="py-1.5 px-3">{r.fullName}</td>
                              <td className="py-1.5 px-3 font-mono text-blue-600 dark:text-blue-400">
                                {r.defaultPassword}
                              </td>
                              <td className="py-1.5 px-3 text-right whitespace-nowrap">
                                {hasSameName ? (
                                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                                    Trùng tên (vẫn nhập)
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    Sẵn sàng
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowStudentImportModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={busy || parsedStudentImport.rows.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Nhập {parsedStudentImport.rows.length} học sinh</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Xuất danh sách Học sinh (Excel / CSV) */}
      {showStudentExportModal && activeClass && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-student-export-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowStudentExportModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <h3
                id="modal-student-export-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                Xuất danh sách Học sinh · Lớp {activeClass.name}
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại xuất danh sách học sinh"
                onClick={() => setShowStudentExportModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Phạm vi dữ liệu
                </span>
                <div className="space-y-1.5 text-xs">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="student-export-scope"
                      checked={studentExportScope === 'all'}
                      onChange={() => setStudentExportScope('all')}
                    />
                    <span>
                      Toàn bộ học sinh của lớp ({classStudents.length} học sinh)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="student-export-scope"
                      checked={studentExportScope === 'filtered'}
                      onChange={() => setStudentExportScope('filtered')}
                    />
                    <span>
                      Theo bộ lọc hiện tại ({filteredStudents.length} học sinh)
                    </span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Định dạng tệp
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setStudentExportFormat('xlsx')}
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      studentExportFormat === 'xlsx'
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-semibold">Excel (.xlsx)</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Đầy đủ Mã HS, MK hiện hành & Hướng dẫn
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentExportFormat('csv')}
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      studentExportFormat === 'csv'
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-semibold">CSV (.csv)</div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      UTF-8 BOM mở chuẩn trên Excel
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStudentExportModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleExportStudents}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Tải xuống {studentExportFormat.toUpperCase()}</span>
                </button>
              </div>
            </div>
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
