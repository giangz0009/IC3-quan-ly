import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpenCheck,
  Building2,
  ClipboardList,
  Database,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Swords,
  X,
} from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { BattleControlView } from './components/BattleControlView';
import { ClassTasksView } from './components/ClassTasksView';
import { OverviewView } from './components/OverviewView';
import { QuestionBankView } from './components/QuestionBankView';
import { ReportsView } from './components/ReportsView';
import { SchoolsStudentsView } from './components/SchoolsStudentsView';
import { SupabaseView } from './components/SupabaseView';
import { TeacherManagementView } from './components/TeacherManagementView';
import { ToastContainer, type ToastItem } from './components/ToastContainer';
import type { AdminDatabase } from './types/ic3';
import { api, setAuthToken, type SafeTeacher } from './utils/api';
import {
  formatSupabaseLoadingStatus,
  getTeacherPermissions,
  resolveToastVariant,
  type SupabasePendingTask,
  type ToastVariant,
} from './utils/ic3Rules';
import {
  fetchQuestionBankFromSupabase,
  getActiveSupabaseTasks,
  getQuestionBankSupabaseEnabled,
  subscribeSupabaseActivity,
} from './utils/supabaseClient';

type NavTab =
  | 'overview'
  | 'schools'
  | 'teachers'
  | 'questions'
  | 'tasks'
  | 'battle'
  | 'reports'
  | 'supabase';

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'schools', label: 'Trường & Học sinh', icon: Building2 },
  { id: 'teachers', label: 'Quản lý Giáo viên', icon: ShieldCheck },
  { id: 'questions', label: 'Ngân hàng Câu hỏi', icon: BookOpenCheck },
  { id: 'tasks', label: 'Giao Bài tập Lớp', icon: ClipboardList },
  { id: 'battle', label: 'Thi đấu Realtime', icon: Swords },
  { id: 'reports', label: 'Thống kê & Báo cáo', icon: BarChart3 },
  { id: 'supabase', label: 'Kết nối Supabase', icon: Database },
];

const THEME_KEY = 'ic3_admin_theme';

export default function App() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(THEME_KEY) === 'dark';
  });

  const [teacher, setTeacher] = useState<SafeTeacher | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [db, setDb] = useState<
    (Omit<AdminDatabase, 'teachers'> & { teachers: SafeTeacher[] }) | null
  >(null);
  const [loadingDb, setLoadingDb] = useState(false);
  const [syncingStartupSupabase, setSyncingStartupSupabase] = useState(false);
  const [activeSupabaseTasks, setActiveSupabaseTasks] = useState<
    SupabasePendingTask[]
  >(() => getActiveSupabaseTasks());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeSupabaseActivity(setActiveSupabaseTasks);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      window.localStorage.setItem(THEME_KEY, 'dark');
    } else {
      root.classList.remove('dark');
      window.localStorage.setItem(THEME_KEY, 'light');
    }
  }, [isDark]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (msg: string, variantOrIsError: boolean | ToastVariant = false) => {
      const variant = resolveToastVariant(msg, variantOrIsError);
      const id = Date.now() + Math.floor(Math.random() * 10000);
      setToasts((prev) => [...prev.slice(-3), { id, msg, variant }]);
      const durationMs =
        variant === 'error' || variant === 'warning' ? 6500 : 4500;
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, durationMs);
    },
    []
  );

  const refreshData = useCallback(async () => {
    setLoadingDb(true);
    setLoadError(null);
    try {
      const data = await api.bootstrap();
      setDb(data);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Không thể tải dữ liệu từ máy chủ.'
      );
    } finally {
      setLoadingDb(false);
    }
  }, []);

  // Support ?autostart=1 for immediate inspection & optional auto-pull from Supabase
  useEffect(() => {
    if (teacher) {
      let cancelled = false;
      (async () => {
        if (getQuestionBankSupabaseEnabled()) {
          setSyncingStartupSupabase(true);
          try {
            const pulled = await fetchQuestionBankFromSupabase();
            if (
              !cancelled &&
              pulled.ok &&
              (pulled.modules.length > 0 ||
                pulled.knowledgeCategories.length > 0 ||
                pulled.knowledgeParts.length > 0 ||
                pulled.questions.length > 0 ||
                pulled.questionSets.length > 0)
            ) {
              await api.importQuestionBankFromRemote({
                modules: pulled.modules,
                knowledgeCategories: pulled.knowledgeCategories,
                knowledgeParts: pulled.knowledgeParts,
                questions: pulled.questions,
                questionSets: pulled.questionSets,
              });
            }
          } catch {
            // Giữ dữ liệu cục bộ nếu Supabase tạm thời không khả dụng
          } finally {
            if (!cancelled) {
              setSyncingStartupSupabase(false);
            }
          }
        }
        if (!cancelled) {
          await refreshData();
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      api
        .login('admin@ic3master.edu.vn', 'admin123')
        .then(({ teacher: t }) => {
          setTeacher(t);
        })
        .catch(() => {});
    }
  }, [teacher, refreshData]);

  function handleAuthenticated(loggedTeacher: SafeTeacher) {
    setActiveTab('overview');
    setTeacher(loggedTeacher);
  }

  function handleLogout() {
    void api.logout();
    setAuthToken(null);
    setTeacher(null);
    setDb(null);
    setActiveTab('overview');
  }

  if (!teacher) {
    return (
      <AuthScreen
        isDark={isDark}
        onToggleTheme={() => setIsDark((v) => !v)}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const permissions = getTeacherPermissions(teacher.role);
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.id === 'teachers') return permissions.canManageTeachers;
    if (item.id === 'battle') return permissions.canHostBattle;
    if (item.id === 'supabase') return permissions.canManageSupabase;
    return true;
  });
  const effectiveTab: NavTab = visibleNavItems.some((n) => n.id === activeTab)
    ? activeTab
    : 'overview';
  const currentNav = visibleNavItems.find((n) => n.id === effectiveTab)!;
  const scopedSchoolId: string | null = null;
  const supabaseStatusText = formatSupabaseLoadingStatus(activeSupabaseTasks);

  return (
    <div className="h-dvh overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar (260px) */}
      <aside className="hidden lg:flex lg:w-[260px] lg:shrink-0 lg:flex-col h-full overflow-hidden border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="h-16 shrink-0 px-5 flex items-center border-b border-slate-200 dark:border-slate-800">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            IC3 Master Admin
          </span>
        </div>

        <nav aria-label="Điều hướng chính" className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = effectiveTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
              {teacher.fullName}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {permissions.shortLabel} · Liên trường
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] h-full overflow-hidden bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-10">
            <div className="h-14 shrink-0 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-display text-base font-bold">
                IC3 Master Admin
              </span>
              <button
                type="button"
                aria-label="Đóng menu"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav aria-label="Điều hướng di động" className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = effectiveTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg ${
                      active
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
        <header className="h-16 shrink-0 px-4 sm:px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Mở menu điều hướng"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Quản trị Học vụ / {currentNav.label}
              </div>
              <h1 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setIsDark((v) => !v)}
              aria-label={isDark ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isDark ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {isDark ? 'Nền sáng' : 'Nền tối'}
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto w-full">
          <div className="p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {loadError && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-4"
            >
              <span>{loadError}</span>
              <button
                type="button"
                onClick={refreshData}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white cursor-pointer"
              >
                Thử lại
              </button>
            </div>
          )}

          {!db && (loadingDb || syncingStartupSupabase) ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-600 dark:text-slate-300">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
                <span>
                  {syncingStartupSupabase
                    ? 'Đang tải và đồng bộ Ngân hàng Câu hỏi từ Supabase...'
                    : 'Đang tải dữ liệu hệ thống...'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
                  />
                ))}
              </div>
              <div className="h-72 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
            </div>
          ) : db ? (
            <>
              {effectiveTab === 'overview' && (
                <OverviewView
                  db={db}
                  scopedSchoolId={scopedSchoolId}
                  onNavigate={setActiveTab}
                />
              )}
              {effectiveTab === 'schools' && (
                <SchoolsStudentsView
                  db={db}
                  currentTeacher={teacher}
                  onRefresh={refreshData}
                  onNotify={notify}
                  onOpenTeachersTab={
                    permissions.canManageTeachers
                      ? () => setActiveTab('teachers')
                      : undefined
                  }
                />
              )}
              {effectiveTab === 'teachers' && permissions.canManageTeachers && (
                <TeacherManagementView
                  db={db}
                  currentTeacher={teacher}
                  onRefresh={refreshData}
                  onNotify={notify}
                />
              )}
              {effectiveTab === 'questions' && (
                <QuestionBankView
                  db={db}
                  canEdit={permissions.canEditQuestionBank}
                  canManageSupabase={permissions.canManageSupabase}
                  onRefresh={refreshData}
                  onNotify={notify}
                  onOpenSupabase={
                    permissions.canManageSupabase
                      ? () => setActiveTab('supabase')
                      : undefined
                  }
                />
              )}
              {effectiveTab === 'tasks' && (
                <ClassTasksView
                  db={db}
                  currentTeacher={teacher}
                  onRefresh={refreshData}
                  onNotify={notify}
                />
              )}
              {effectiveTab === 'battle' && permissions.canHostBattle && (
                <BattleControlView
                  db={db}
                  currentTeacher={teacher}
                  onRefresh={refreshData}
                  onNotify={notify}
                />
              )}
              {effectiveTab === 'reports' && (
                <ReportsView db={db} scopedSchoolId={scopedSchoolId} />
              )}
              {effectiveTab === 'supabase' && permissions.canManageSupabase && (
                <SupabaseView
                  db={{ ...db, teachers: [] }}
                  onRefresh={refreshData}
                  onNotify={notify}
                />
              )}
            </>
          ) : null}
          </div>
        </main>
      </div>

      {(supabaseStatusText || syncingStartupSupabase) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-labelledby="supabase-loading-modal-title"
          data-testid="supabase-loading-modal"
          className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
            <div className="space-y-1.5">
              <h2
                id="supabase-loading-modal-title"
                className="font-display text-base font-bold text-slate-900 dark:text-white"
              >
                Đang chờ phản hồi từ Supabase
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {supabaseStatusText ||
                  'Đang tải và đồng bộ Ngân hàng Câu hỏi từ Supabase...'}
              </p>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Vui lòng đợi trong giây lát, không đóng hoặc tải lại trang.
            </p>
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
