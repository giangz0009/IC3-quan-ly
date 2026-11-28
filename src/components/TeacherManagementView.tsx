import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  DownloadCloud,
  Eye,
  Lock,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  UploadCloud,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AdminDatabase,
  AdminRole,
  TeacherAccountStatus,
} from '../types/ic3';
import { api, type SafeTeacher } from '../utils/api';
import {
  ADMIN_ROLE_LIST,
  ADMIN_ROLE_PERMISSIONS,
  canDeleteOrDemoteMaster,
  filterTeachers,
  getTeacherPermissionDetails,
  getTeacherPermissions,
  normalizeAdminRole,
  normalizeTeacherStatus,
  summarizeTeachersByRole,
  summarizeTeacherStatuses,
} from '../utils/ic3Rules';
import {
  getSavedSupabaseSettings,
  isSupabaseConfigured,
  runTrackedSupabaseActivity,
} from '../utils/supabaseClient';
import { TableSkeletonRows } from './TableSkeleton';

interface TeacherManagementViewProps {
  db: Omit<AdminDatabase, 'teachers'> & { teachers: SafeTeacher[] };
  currentTeacher: SafeTeacher;
  loading?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
  onOpenSupabase?: () => void;
}

export const TeacherManagementView: React.FC<TeacherManagementViewProps> = ({
  db,
  currentTeacher,
  loading = false,
  onRefresh,
  onNotify,
  onOpenSupabase,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | AdminRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | TeacherAccountStatus>(
    'all'
  );

  // Modal 0: Create teacher modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'teacher_lv1' as AdminRole,
  });

  // Modal 1: Permission detail modal (by role tier)
  const [permissionModalRole, setPermissionModalRole] =
    useState<AdminRole | null>(null);

  // Modal 2: Edit teacher modal
  const [editingTeacher, setEditingTeacher] = useState<SafeTeacher | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'teacher_lv1' as AdminRole,
    status: 'active' as TeacherAccountStatus,
  });

  // Modal 3: Confirm delete modal
  const [deletingTeacher, setDeletingTeacher] = useState<SafeTeacher | null>(
    null
  );

  const [busy, setBusy] = useState(false);
  const supabaseConfigured = isSupabaseConfigured();

  const roleSummary = useMemo(
    () => summarizeTeachersByRole(db.teachers),
    [db.teachers]
  );

  const statusSummary = useMemo(
    () => summarizeTeacherStatuses(db.teachers),
    [db.teachers]
  );

  const filteredTeachers = useMemo(
    () => filterTeachers(db.teachers, searchQuery, roleFilter, statusFilter),
    [db.teachers, searchQuery, roleFilter, statusFilter]
  );

  async function handleCreateTeacher(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const settings = getSavedSupabaseSettings();
      const exec = () =>
        api.createTeacher(
          {
            ...createForm,
            status: 'active',
          },
          settings
        );
      const created = supabaseConfigured
        ? await runTrackedSupabaseActivity(
            'Đang cấp tài khoản & đồng bộ lên Supabase...',
            exec
          )
        : await exec();
      await onRefresh();
      setShowCreateModal(false);
      setCreateForm({
        fullName: '',
        email: '',
        password: '',
        role: 'teacher_lv1',
      });
      if (created.supabaseSync?.configured && !created.supabaseSync.ok) {
        onNotify(
          `Đã cấp tài khoản giáo viên cục bộ nhưng đồng bộ Supabase lỗi: ${created.supabaseSync.error}`,
          true
        );
      } else if (created.supabaseSync?.configured && created.supabaseSync.ok) {
        onNotify('Đã cấp tài khoản giáo viên mới và đồng bộ lên Supabase.');
      } else {
        onNotify('Đã cấp tài khoản giáo viên mới.');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Lỗi cấp tài khoản giáo viên.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  function openEditModal(teacher: SafeTeacher) {
    setEditingTeacher(teacher);
    setEditForm({
      fullName: teacher.fullName,
      email: teacher.email,
      password: '',
      role: normalizeAdminRole(teacher.role),
      status: normalizeTeacherStatus(teacher.status),
    });
  }

  async function handleSaveEditModal(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTeacher) return;
    setBusy(true);
    try {
      const settings = getSavedSupabaseSettings();
      const payload = {
        fullName: editForm.fullName,
        email: editForm.email,
        role: editForm.role,
        status: editForm.status,
        ...(editForm.password.trim() ? { password: editForm.password } : {}),
      };
      const exec = () =>
        api.updateTeacher(editingTeacher.userId, payload, settings);
      const updated = supabaseConfigured
        ? await runTrackedSupabaseActivity(
            'Đang cập nhật giáo viên lên Supabase...',
            exec
          )
        : await exec();
      await onRefresh();
      setEditingTeacher(null);
      if (updated.supabaseSync?.configured && !updated.supabaseSync.ok) {
        onNotify(
          `Đã cập nhật cục bộ nhưng đồng bộ Supabase lỗi: ${updated.supabaseSync.error}`,
          true
        );
      } else if (updated.supabaseSync?.configured && updated.supabaseSync.ok) {
        onNotify('Đã cập nhật thông tin, phân quyền và đồng bộ lên Supabase.');
      } else {
        onNotify('Đã cập nhật thông tin và phân quyền giáo viên.');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Lỗi cập nhật thông tin giáo viên.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleStatus(teacher: SafeTeacher) {
    const currentStatus = normalizeTeacherStatus(teacher.status);
    const nextStatus: TeacherAccountStatus =
      currentStatus === 'active' ? 'locked' : 'active';
    setBusy(true);
    try {
      const settings = getSavedSupabaseSettings();
      const exec = () =>
        api.updateTeacher(teacher.userId, { status: nextStatus }, settings);
      const updated = supabaseConfigured
        ? await runTrackedSupabaseActivity(
            'Đang cập nhật trạng thái giáo viên lên Supabase...',
            exec
          )
        : await exec();
      await onRefresh();
      if (updated.supabaseSync?.configured && !updated.supabaseSync.ok) {
        onNotify(
          `Đã đổi trạng thái cục bộ nhưng đồng bộ Supabase lỗi: ${updated.supabaseSync.error}`,
          true
        );
      } else {
        onNotify(
          nextStatus === 'locked'
            ? `Đã tạm khóa tài khoản ${teacher.fullName}.`
            : `Đã mở khóa tài khoản ${teacher.fullName}.`
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Không thể thay đổi trạng thái tài khoản.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingTeacher) return;
    setBusy(true);
    try {
      const targetName = deletingTeacher.fullName;
      const settings = getSavedSupabaseSettings();
      const exec = () => api.deleteTeacher(deletingTeacher.userId, settings);
      const deleted = supabaseConfigured
        ? await runTrackedSupabaseActivity(
            'Đang xóa giáo viên trên Supabase...',
            exec
          )
        : await exec();
      await onRefresh();
      setDeletingTeacher(null);
      if (deleted.supabaseSync?.configured && !deleted.supabaseSync.ok) {
        onNotify(
          `Đã xóa tài khoản ${targetName} cục bộ nhưng xóa trên Supabase lỗi: ${deleted.supabaseSync.error}`,
          true
        );
      } else if (deleted.supabaseSync?.configured && deleted.supabaseSync.ok) {
        onNotify(`Đã xóa tài khoản ${targetName} khỏi hệ thống và Supabase.`);
      } else {
        onNotify(`Đã xóa tài khoản ${targetName}.`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể xóa tài khoản giáo viên.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePushTeachersToSupabase() {
    setBusy(true);
    try {
      const res = await runTrackedSupabaseActivity(
        'Đang đẩy danh sách giáo viên lên Supabase...',
        () => api.syncTeachersToSupabase(getSavedSupabaseSettings())
      );
      onNotify(res.message);
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Không thể đẩy danh sách giáo viên lên Supabase.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePullTeachersFromSupabase() {
    setBusy(true);
    try {
      const res = await runTrackedSupabaseActivity(
        'Đang lấy danh sách giáo viên từ Supabase...',
        () => api.pullTeachersFromSupabase(getSavedSupabaseSettings())
      );
      await onRefresh();
      onNotify(res.message);
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Không thể lấy danh sách giáo viên từ Supabase.',
        true
      );
    } finally {
      setBusy(false);
    }
  }

  const editTargetIsProtected = editingTeacher
    ? editingTeacher.userId === currentTeacher.userId ||
      !canDeleteOrDemoteMaster(
        db.teachers,
        editingTeacher.userId,
        'teacher_lv1',
        normalizeTeacherStatus(editingTeacher.status)
      ).ok ||
      !canDeleteOrDemoteMaster(
        db.teachers,
        editingTeacher.userId,
        normalizeAdminRole(editingTeacher.role),
        'locked'
      ).ok
    : false;

  return (
    <div className="space-y-6">
      {/* Header & 3-Tier Permission Summary */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Quản lý Tài khoản & Phân quyền Giáo viên
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Quản lý danh sách tài khoản giáo viên, điều chỉnh vai trò theo 3 nhóm quyền và kiểm soát trạng thái hoạt động trong hệ thống.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
            <span>
              Tổng số:{' '}
              <strong className="text-slate-900 dark:text-white">
                {roleSummary.total}
              </strong>
            </span>
            <span className="text-emerald-700 dark:text-emerald-400">
              Hoạt động: <strong>{statusSummary.active}</strong>
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              Tạm khóa:{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {statusSummary.locked}
              </strong>
            </span>
          </div>
        </div>

        {/* 3-Tier Functional Summary + Icon-Only Permission Details Trigger */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1 border-t border-slate-100 dark:border-slate-800">
          {ADMIN_ROLE_LIST.map((roleKey) => {
            const meta = ADMIN_ROLE_PERMISSIONS[roleKey];
            const count = roleSummary[roleKey];
            return (
              <div key={roleKey} className="pt-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5">
                    <span
                      className={`text-sm font-semibold ${
                        roleKey === 'master'
                          ? 'text-blue-700 dark:text-blue-400'
                          : roleKey === 'teacher_lv2'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {meta.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPermissionModalRole(roleKey)}
                      aria-label={`Xem chi tiết quyền của ${meta.label}`}
                      title="Xem chi tiết quyền cụ thể"
                      className="relative group inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1 rounded-md bg-slate-900 dark:bg-slate-800 text-white text-[11px] font-medium whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-visible:opacity-100 group-focus-visible:visible transition-opacity shadow-lg z-30"
                      >
                        Xem chi tiết quyền cụ thể
                      </span>
                    </button>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                    {count} tài khoản
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {meta.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Teachers Table: Header with Create CTA + Read-only Role (Edit via Modal) + Icon Status + Modal Edit & Confirm Delete */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-baseline gap-2.5">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Danh sách Giáo viên
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {filteredTeachers.length} / {db.teachers.length} tài khoản
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {supabaseConfigured ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handlePullTeachersFromSupabase}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  <span>Kéo từ Supabase</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handlePushTeachersToSupabase}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Đẩy lên Supabase</span>
                </button>
              </>
            ) : (
              onOpenSupabase && (
                <button
                  type="button"
                  onClick={onOpenSupabase}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Kết nối Supabase</span>
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Cấp tài khoản</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-[1.5_1_393px]">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Tìm kiếm giáo viên"
                placeholder="Tìm theo họ tên hoặc email giáo viên..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <select
              aria-label="Lọc theo trạng thái tài khoản"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value === 'active' || e.target.value === 'locked'
                    ? e.target.value
                    : 'all'
                )
              }
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600 shrink-0"
            >
              <option value="all">Tất cả trạng thái ({statusSummary.total})</option>
              <option value="active">Đang hoạt động ({statusSummary.active})</option>
              <option value="locked">Tạm khóa ({statusSummary.locked})</option>
            </select>
          </div>

          <div
            role="group"
            aria-label="Lọc theo nhóm quyền"
            className="flex flex-1 min-w-fit flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80"
          >
            <button
              type="button"
              onClick={() => setRoleFilter('all')}
              className={`flex-1 min-w-fit px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap text-center cursor-pointer ${
                roleFilter === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Tất cả ({roleSummary.total})
            </button>
            {ADMIN_ROLE_LIST.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`flex-1 min-w-fit px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap text-center cursor-pointer ${
                  roleFilter === r
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {ADMIN_ROLE_PERMISSIONS[r].shortLabel} ({roleSummary[r]})
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 whitespace-nowrap">
                <th className="py-2.5 pr-4 font-medium">Giáo viên</th>
                <th className="py-2.5 pr-4 font-medium">Vai trò (Quyền)</th>
                <th className="py-2.5 px-4 font-medium text-center">
                  Trạng thái tài khoản
                </th>
                <th className="py-2.5 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeletonRows
                rows={6}
                rowHeightClass=""
                ariaLabel="Đang tải danh sách giáo viên..."
                columns={[
                  {
                    variant: 'twoLine',
                    widths: ['w-36', 'w-44', 'w-32', 'w-40'],
                    cellClassName: 'py-3 pr-4',
                  },
                  {
                    variant: 'text',
                    widths: ['w-36', 'w-28', 'w-32'],
                    cellClassName: 'py-3 pr-4',
                  },
                  {
                    variant: 'iconBox',
                    align: 'center',
                    cellClassName: 'py-3 px-4 text-center',
                  },
                  {
                    variant: 'actions',
                    align: 'right',
                    cellClassName: 'py-3 text-right',
                  },
                ]}
              />
            ) : (
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTeachers.map((t) => {
                  const rolePerm = getTeacherPermissions(t.role);
                  const status = normalizeTeacherStatus(t.status);
                  const isSelf = t.userId === currentTeacher.userId;
                  const canChangeRoleOrLock =
                    !isSelf &&
                    canDeleteOrDemoteMaster(
                      db.teachers,
                      t.userId,
                      'teacher_lv1',
                      status
                    ).ok &&
                    canDeleteOrDemoteMaster(
                      db.teachers,
                      t.userId,
                      rolePerm.role,
                      'locked'
                    ).ok;
                  const canRemove =
                    !isSelf && canDeleteOrDemoteMaster(db.teachers, t.userId).ok;

                  return (
                    <tr
                      key={t.userId}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {t.fullName}
                          {isSelf && (
                            <span className="ml-2 text-[11px] font-normal text-blue-600 dark:text-blue-400">
                              (Đang đăng nhập)
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t.email}
                        </div>
                      </td>

                      <td className="py-3 pr-4 whitespace-nowrap">
                        <span
                          title="Chỉ thay đổi vai trò khi chọn vào nút Sửa"
                          className={`text-xs font-semibold ${
                            rolePerm.role === 'master'
                              ? 'text-blue-700 dark:text-blue-400'
                              : rolePerm.role === 'teacher_lv2'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {rolePerm.label}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {status === 'active' ? (
                          <span
                            role="img"
                            aria-label={`Trạng thái tài khoản ${t.fullName}: Đang hoạt động`}
                            title="Đang hoạt động"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </span>
                        ) : (
                          <span
                            role="img"
                            aria-label={`Trạng thái tài khoản ${t.fullName}: Tạm khóa`}
                            title="Tạm khóa"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400"
                          >
                            <Lock className="w-4 h-4" />
                          </span>
                        )}
                      </td>

                      <td className="py-3 text-right whitespace-nowrap space-x-3">
                        <button
                          type="button"
                          aria-label={`Sửa giáo viên ${t.fullName}`}
                          onClick={() => openEditModal(t)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Sửa</span>
                        </button>

                        {canChangeRoleOrLock && (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={
                              status === 'active'
                                ? `Tạm khóa tài khoản ${t.fullName}`
                                : `Mở khóa tài khoản ${t.fullName}`
                            }
                            onClick={() => handleToggleStatus(t)}
                            className={`inline-flex items-center gap-1 text-xs font-medium hover:underline disabled:opacity-50 cursor-pointer ${
                              status === 'active'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {status === 'active' ? (
                              <>
                                <Lock className="w-3 h-3" />
                                <span>Khóa</span>
                              </>
                            ) : (
                              <>
                                <Unlock className="w-3 h-3" />
                                <span>Mở khóa</span>
                              </>
                            )}
                          </button>
                        )}

                        {canRemove ? (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Xóa giáo viên ${t.fullName}`}
                            onClick={() => setDeletingTeacher(t)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Xóa</span>
                          </button>
                        ) : (
                          <span
                            title={
                              isSelf
                                ? 'Không thể tự khóa hoặc xóa tài khoản đang đăng nhập'
                                : 'Phải giữ lại ít nhất 1 tài khoản Master đang hoạt động'
                            }
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            <span>Được bảo vệ</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {filteredTeachers.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-10 text-center text-sm text-slate-500 dark:text-slate-400 space-y-2"
                    >
                      <div>Không tìm thấy tài khoản giáo viên nào khớp bộ lọc.</div>
                      {(searchQuery || roleFilter !== 'all' || statusFilter !== 'all') && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setRoleFilter('all');
                            setStatusFilter('all');
                          }}
                          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          Đặt lại bộ lọc
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            )}
          </table>
        </div>
      </section>

      {/* Modal 0: Create New Teacher Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="teacher-create-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => !busy && setShowCreateModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3
                  id="teacher-create-modal-title"
                  className="font-display text-base font-semibold text-slate-900 dark:text-white"
                >
                  Cấp Tài khoản Giáo viên mới
                </h3>
              </div>
              <button
                type="button"
                aria-label="Đóng hộp thoại cấp tài khoản giáo viên"
                disabled={busy}
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTeacher} className="p-6 space-y-4">
              <div>
                <label
                  htmlFor="create-teacher-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Họ và tên giáo viên
                </label>
                <input
                  id="create-teacher-name"
                  type="text"
                  required
                  placeholder="VD: Nguyễn Minh Tâm"
                  value={createForm.fullName}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, fullName: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="create-teacher-email"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Email đăng nhập
                </label>
                <input
                  id="create-teacher-email"
                  type="email"
                  required
                  placeholder="VD: giaovien@ic3.edu.vn"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, email: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="create-teacher-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Mật khẩu đăng nhập
                </label>
                <input
                  id="create-teacher-password"
                  type="password"
                  required
                  placeholder="Nhập mật khẩu ban đầu..."
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, password: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="create-teacher-role"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Nhóm phân quyền giáo viên
                </label>
                <select
                  id="create-teacher-role"
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      role: normalizeAdminRole(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {ADMIN_ROLE_LIST.map((r) => (
                    <option key={r} value={r}>
                      {ADMIN_ROLE_PERMISSIONS[r].label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {ADMIN_ROLE_PERMISSIONS[createForm.role].description}
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 cursor-pointer"
                >
                  Cấp tài khoản
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 1: Detailed Role Permissions Modal */}
      {permissionModalRole && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="teacher-perm-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setPermissionModalRole(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
              <div>
                <h3
                  id="teacher-perm-modal-title"
                  className="font-display text-base font-semibold text-slate-900 dark:text-white"
                >
                  Chi tiết Quyền hạn · {ADMIN_ROLE_PERMISSIONS[permissionModalRole].label}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">
                    {roleSummary[permissionModalRole]} tài khoản
                  </span>{' '}
                  · {ADMIN_ROLE_PERMISSIONS[permissionModalRole].description}
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng hộp thoại chi tiết quyền"
                onClick={() => setPermissionModalRole(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {getTeacherPermissionDetails(permissionModalRole).map((item) => (
                <div
                  key={item.key}
                  className="py-3 first:pt-0 last:pb-0 flex items-start gap-3"
                >
                  {item.allowed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                  )}
                  <div className="space-y-0.5 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`text-sm font-medium ${
                          item.allowed
                            ? 'text-slate-900 dark:text-slate-100'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.label}
                      </span>
                      <span
                        className={`text-[11px] font-semibold whitespace-nowrap ${
                          item.allowed
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {item.allowed ? 'Được phép' : 'Không được phép'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setPermissionModalRole(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-blue-600 text-white hover:opacity-90 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Edit Teacher Modal */}
      {editingTeacher && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="teacher-edit-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => !busy && setEditingTeacher(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <h3
                id="teacher-edit-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                Chỉnh sửa Tài khoản Giáo viên
              </h3>
              <button
                type="button"
                aria-label="Đóng hộp thoại chỉnh sửa giáo viên"
                disabled={busy}
                onClick={() => setEditingTeacher(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditModal} className="p-6 space-y-4">
              <div>
                <label
                  htmlFor="edit-teacher-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Họ và tên giáo viên
                </label>
                <input
                  id="edit-teacher-name"
                  type="text"
                  required
                  value={editForm.fullName}
                  onChange={(e) =>
                    setEditForm({ ...editForm, fullName: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-teacher-email"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Email đăng nhập
                </label>
                <input
                  id="edit-teacher-email"
                  type="email"
                  required
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm({ ...editForm, email: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-teacher-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Mật khẩu mới (để trống nếu giữ nguyên mật khẩu hiện tại)
                </label>
                <input
                  id="edit-teacher-password"
                  type="password"
                  placeholder="Nhập mật khẩu mới nếu muốn đổi..."
                  value={editForm.password}
                  onChange={(e) =>
                    setEditForm({ ...editForm, password: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="edit-teacher-role"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Vai trò (Quyền)
                  </label>
                  <select
                    id="edit-teacher-role"
                    disabled={editTargetIsProtected}
                    value={editForm.role}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        role: normalizeAdminRole(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {ADMIN_ROLE_LIST.map((r) => (
                      <option key={r} value={r}>
                        {ADMIN_ROLE_PERMISSIONS[r].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="edit-teacher-status"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Trạng thái tài khoản
                  </label>
                  <select
                    id="edit-teacher-status"
                    disabled={editTargetIsProtected}
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        status: normalizeTeacherStatus(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="active">Đang hoạt động</option>
                    <option value="locked">Tạm khóa</option>
                  </select>
                </div>
              </div>

              {editTargetIsProtected && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Vai trò và trạng thái được khóa để bảo vệ tài khoản đang đăng nhập hoặc tài khoản Master hoạt động cuối cùng.
                </p>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditingTeacher(null)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 cursor-pointer"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Confirm Delete Teacher Modal */}
      {deletingTeacher && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="teacher-delete-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => !busy && setDeletingTeacher(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3
                  id="teacher-delete-modal-title"
                  className="font-display text-base font-semibold text-slate-900 dark:text-white"
                >
                  Xác nhận xóa tài khoản giáo viên
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Bạn có chắc chắn muốn xóa tài khoản{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {deletingTeacher.fullName}
                  </strong>{' '}
                  (<span className="font-mono">{deletingTeacher.email}</span>)?
                  Hành động này không thể hoàn tác.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeletingTeacher(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 cursor-pointer"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
