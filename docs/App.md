# Lưu trữ Kiến trúc Frontend: `src/App.tsx`

**Nguồn gốc:** `src/App.tsx` (539 dòng)  
**Cập nhật bản lưu:** 2026-11-24

---

## 1. Tổng quan Vai trò
`src/App.tsx` là khung điều phối gốc của toàn bộ ứng dụng React **IC3 Master Admin**:
- Quản lý chế độ giao diện Sáng/Tối (`ic3_admin_theme` trong `localStorage`).
- Bảo vệ phiên đăng nhập trong bộ nhớ (`teacher: SafeTeacher | null`, render `AuthScreen` nếu chưa đăng nhập, hoặc hỗ trợ `?autostart=1` cho kiểm thử nhanh).
- Tự đồng bộ dữ liệu khởi động từ Supabase khi server chạy chế độ cục bộ (`!health?.supabaseConfigured && getQuestionBankSupabaseEnabled()`), sau đó gọi `api.bootstrap()`.
- Tính quyền truy cập 8 tab (`overview`, `schools`, `teachers`, `questions`, `tasks`, `battle`, `reports`, `supabase`) theo `getTeacherPermissions(teacher.role)`.
- Render bố cục cố định (`h-dvh overflow-hidden`), thanh bên Desktop (`260px`), Mobile drawer, Header (kèm nút **Làm mới** `data-testid="header-refresh-btn"` và nút đổi giao diện Sáng/Tối), **Skeleton Loading theo ngữ cảnh tab** khi bootstrap hoặc refetch (`isFetchingData = loadingDb || syncingStartupSupabase`), vùng nội dung cuộn độc lập, **Modal Loading Supabase toàn màn hình (`z-[100]`)** và hệ thống **ToastContainer**.

---

## 2. Cấu hình Điều hướng & Phân quyền Tab

```tsx
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
```

Quy tắc lọc tab theo quyền:
```tsx
const permissions = getTeacherPermissions(teacher.role);
const visibleNavItems = NAV_ITEMS.filter((item) => {
  if (item.id === 'teachers') return permissions.canManageTeachers;
  if (item.id === 'battle') return permissions.canHostBattle;
  if (item.id === 'supabase') return permissions.canManageSupabase;
  return true;
});
```

---

## 3. Khởi tạo, Bootstrap & Đăng xuất (Core Hooks)

```tsx
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

useEffect(() => {
  if (teacher) {
    let cancelled = false;
    (async () => {
      const health = await api.health().catch(() => null);
      if (!cancelled && !health?.supabaseConfigured && getQuestionBankSupabaseEnabled()) {
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
      .login('admin@ic3master.edu.vn', 'admin123', getSavedSupabaseSettings())
      .then(({ teacher: t }) => {
        setTeacher(t);
      })
      .catch(() => {});
  }
}, [teacher, refreshData]);

function handleAuthenticated(
  loggedTeacher: SafeTeacher,
  authSource?: 'supabase' | 'local'
) {
  setActiveTab('overview');
  setTeacher(loggedTeacher);
  if (authSource === 'supabase') {
    notify('Đã đăng nhập và đồng bộ thông tin tài khoản từ Supabase.');
  }
}

function handleLogout() {
  void api.logout();
  setAuthToken(null);
  setTeacher(null);
  setDb(null);
  setActiveTab('overview');
}
```

---

## 4. Ánh xạ Component theo Tab & Global Overlays

```tsx
{effectiveTab === 'overview' && (
  <OverviewView
    db={db}
    scopedSchoolId={scopedSchoolId}
    loading={isFetchingData}
    onNavigate={setActiveTab}
  />
)}
{effectiveTab === 'schools' && (
  <SchoolsStudentsView
    db={db}
    currentTeacher={teacher}
    loading={isFetchingData}
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
    loading={isFetchingData}
    onRefresh={refreshData}
    onNotify={notify}
    onOpenSupabase={
      permissions.canManageSupabase
        ? () => setActiveTab('supabase')
        : undefined
    }
  />
)}
{effectiveTab === 'questions' && (
  <QuestionBankView
    db={db}
    canEdit={permissions.canEditQuestionBank}
    loading={isFetchingData}
    onRefresh={refreshData}
    onNotify={notify}
  />
)}
{effectiveTab === 'tasks' && (
  <ClassTasksView
    db={db}
    currentTeacher={teacher}
    loading={isFetchingData}
    onRefresh={refreshData}
    onNotify={notify}
  />
)}
{effectiveTab === 'battle' && permissions.canHostBattle && (
  <BattleControlView
    db={db}
    currentTeacher={teacher}
    loading={isFetchingData}
    onRefresh={refreshData}
    onNotify={notify}
  />
)}
{effectiveTab === 'reports' && (
  <ReportsView db={db} scopedSchoolId={scopedSchoolId} loading={isFetchingData} />
)}
{effectiveTab === 'supabase' && permissions.canManageSupabase && (
  <SupabaseView
    db={db}
    loading={isFetchingData}
    onRefresh={refreshData}
    onNotify={notify}
  />
)}
```

### Skeleton Loading & Modal Loading Supabase Toàn màn hình & Toast
- Khi `!db && isFetchingData`, hiển thị `data-testid="bootstrap-skeleton"` với `TableSkeletonCard` / `CardGridSkeleton` / `ListSkeleton` tương ứng theo `effectiveTab`.
- Khi `db` đã có và người dùng bấm **Làm mới** (`refreshData()`), `loading={isFetchingData}` được truyền xuống từng view con để hiển thị skeleton ngay trong phần thân bảng (`<tbody>` via `TableSkeletonRows`) hoặc danh sách.
- `subscribeSupabaseActivity(setActiveSupabaseTasks)` theo dõi các tác vụ đang chạy qua `formatSupabaseLoadingStatus(activeSupabaseTasks)`.
- Render Modal `data-testid="supabase-loading-modal"` (`fixed inset-0 z-[100]`) khi `supabaseStatusText || syncingStartupSupabase` khác rỗng.
- `<ToastContainer toasts={toasts} onDismiss={dismissToast} />` tự phân loại biến thể thông báo qua `resolveToastVariant(msg, variantOrIsError)` và tự ẩn sau `4.5s` (`6.5s` đối với `error`/`warning`).
