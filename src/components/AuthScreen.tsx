import React, { useState } from 'react';
import { Lock, Mail, Moon, ShieldCheck, Sun } from 'lucide-react';
import { api, type SafeTeacher } from '../utils/api';
import {
  getSavedSupabaseSettings,
  isSupabaseConfigured,
} from '../utils/supabaseClient';

interface AuthScreenProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onAuthenticated: (
    teacher: SafeTeacher,
    authSource?: 'supabase' | 'local'
  ) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  isDark,
  onToggleTheme,
  onAuthenticated,
}) => {
  const [email, setEmail] = useState('admin@ic3master.edu.vn');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabaseConfigured = isSupabaseConfigured();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { teacher, authSource } = await api.login(
        email,
        password,
        getSavedSupabaseSettings()
      );
      onAuthenticated(teacher, authSource);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  }

  async function quickLogin(presetEmail: string, presetPassword: string) {
    setEmail(presetEmail);
    setPassword(presetPassword);
    setError(null);
    setLoading(true);
    try {
      const { teacher, authSource } = await api.login(
        presetEmail,
        presetPassword,
        getSavedSupabaseSettings()
      );
      onAuthenticated(teacher, authSource);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-dvh overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="shrink-0 max-w-6xl w-full mx-auto flex items-center justify-between px-6 pt-6 pb-2">
        <div className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
          IC3 Master Admin
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>{isDark ? 'Giao diện sáng' : 'Giao diện tối'}</span>
        </button>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-6 py-6 flex">
        <div className="max-w-5xl w-full mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-6 space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
              Hệ thống Quản trị Luyện thi IC3
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
              Điều phối ngân hàng đề, bài tập lớp và đấu trường Realtime
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
              Cổng quản trị dành cho giáo viên tin học và quản trị viên trường học. Đồng bộ cấu trúc dữ liệu chuẩn với ứng dụng học sinh IC3 Master và Supabase PostgreSQL.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                5 dạng câu hỏi IC3 chuẩn
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Trắc nghiệm, nhiều lựa chọn, Đúng/Sai từng ý, Ghép nối và khoanh vùng Hotspot trực quan.
              </p>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Cơ chế Giải lao & Thi đấu
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Thiết lập điểm sàn 0–1000, số lượt đạt chuẩn và điều phối thẻ kỹ năng phòng thi đấu.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8 max-w-md mx-auto w-full">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                  Đăng nhập Giáo viên
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Xác thực 3 cấp phân quyền quản lý liên trường (LV1, LV2, Master)
                </p>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Email giáo viên
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="teacher@school.edu.vn"
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Mật khẩu
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu"
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                {loading ? 'Đang xác thực...' : 'Đăng nhập hệ thống'}
              </button>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                {supabaseConfigured
                  ? 'Đang bật xác thực đồng bộ với Supabase (public.admin_teachers) và bộ đệm cục bộ.'
                  : 'Xác thực qua máy chủ nội bộ (tự động đồng bộ Supabase khi đã cấu hình).'}
              </p>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Truy cập nhanh 3 nhóm phân quyền mẫu:
              </p>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => quickLogin('admin@ic3master.edu.vn', 'admin123')}
                  className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Giáo viên Master
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Không giới hạn quyền trên toàn hệ thống
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400 shrink-0">
                    Master
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => quickLogin('chuyenmon.lv2@ic3master.edu.vn', 'teacher123')}
                  className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      GV Chuyên môn (LV2)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Toàn quyền Ngân hàng đề + Bài tập + Thi đấu Realtime
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
                    LV2
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => quickLogin('giangday.lv1@ic3master.edu.vn', 'teacher123')}
                  className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      GV Giảng dạy (LV1)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Chỉ xem Ngân hàng đề + Giao bài tập (không thi đấu)
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400 shrink-0">
                    LV1
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </main>

      <footer className="shrink-0 max-w-6xl w-full mx-auto text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-800">
        <span>IC3 Master Admin Console</span>
        <span>Chuẩn chấm điểm IC3 1000 điểm · Hỗ trợ Supabase PostgreSQL</span>
      </footer>
    </div>
  );
};
