import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  DownloadCloud,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { SUPABASE_SCHEMA_SQL } from '../data/seedData';
import type { AdminDatabase } from '../types/ic3';
import { api, type SafeTeacher } from '../utils/api';
import {
  clearSupabaseSettings,
  fetchQuestionBankFromSupabase,
  fetchSupabaseSampleQuestions,
  getQuestionBankSupabaseEnabled,
  getSavedSupabaseSettings,
  isSupabaseConfigured,
  runTrackedSupabaseActivity,
  saveSupabaseSettings,
  setQuestionBankSupabaseEnabled,
  syncLocalDatabaseToSupabase,
  testSupabaseConnection,
  type SupabaseConnectionReport,
  type SupabaseRemoteSample,
} from '../utils/supabaseClient';

interface SupabaseViewProps {
  db: Omit<AdminDatabase, 'teachers'> & { teachers: SafeTeacher[] };
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const SupabaseView: React.FC<SupabaseViewProps> = ({
  db,
  onRefresh,
  onNotify,
}) => {
  const initial = getSavedSupabaseSettings();
  const [url, setUrl] = useState(initial.url);
  const [anonKey, setAnonKey] = useState(initial.anonKey);
  const [showKey, setShowKey] = useState(false);
  const [liveQbSync, setLiveQbSync] = useState(() =>
    isSupabaseConfigured() ? getQuestionBankSupabaseEnabled() : true
  );

  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pullingQb, setPullingQb] = useState(false);
  const [pullingTeachers, setPullingTeachers] = useState(false);
  const [sampling, setSampling] = useState(false);

  const [report, setReport] = useState<SupabaseConnectionReport | null>(null);
  const [sample, setSample] = useState<SupabaseRemoteSample | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);

  const isSupabaseBusy =
    testing || syncing || pullingQb || pullingTeachers || sampling;

  function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    saveSupabaseSettings({ url, anonKey });
    setQuestionBankSupabaseEnabled(liveQbSync);
    onNotify('Đã lưu cấu hình kết nối Supabase trên trình duyệt.');
  }

  function handleClearConfig() {
    clearSupabaseSettings();
    setUrl('');
    setAnonKey('');
    setLiveQbSync(false);
    setReport(null);
    setSample(null);
    setStatusMessage(null);
    onNotify('Đã xóa thông tin kết nối Supabase đã lưu trên trình duyệt.');
  }

  async function handleTestConnection() {
    setTesting(true);
    setStatusMessage(null);
    saveSupabaseSettings({ url, anonKey });
    const res = await testSupabaseConnection(
      { url, anonKey },
      db as unknown as AdminDatabase
    );
    setReport(res);
    setStatusMessage({ text: res.message, ok: res.ok });
    onNotify(res.message, !res.ok);
    setTesting(false);
  }

  async function handleSyncToSupabase() {
    setSyncing(true);
    saveSupabaseSettings({ url, anonKey });
    const res = await syncLocalDatabaseToSupabase(
      { url, anonKey },
      db as unknown as AdminDatabase
    );
    if (!res.ok) {
      setStatusMessage({ text: res.message, ok: false });
      onNotify(res.message, true);
      setSyncing(false);
      return;
    }

    let finalMessage = res.message;
    let finalOk = true;
    try {
      const teacherSync = await runTrackedSupabaseActivity(
        'Đang đồng bộ danh sách Giáo viên lên Supabase...',
        () => api.syncTeachersToSupabase({ url, anonKey })
      );
      finalMessage = `${res.message} ${teacherSync.message}`;
    } catch (err) {
      const teacherErr =
        err instanceof Error
          ? err.message
          : 'Không thể đồng bộ bảng admin_teachers.';
      finalMessage = `${res.message} Tuy nhiên phần Giáo viên chưa đồng bộ được: ${teacherErr}`;
      finalOk = false;
    }

    setStatusMessage({ text: finalMessage, ok: finalOk });
    onNotify(finalMessage, !finalOk);
    const refreshedReport = await testSupabaseConnection(
      { url, anonKey },
      db as unknown as AdminDatabase
    );
    setReport(refreshedReport);
    setSyncing(false);
  }

  async function handlePullTeachers() {
    setPullingTeachers(true);
    saveSupabaseSettings({ url, anonKey });
    try {
      const res = await runTrackedSupabaseActivity(
        'Đang kéo danh sách Giáo viên từ Supabase...',
        () => api.pullTeachersFromSupabase({ url, anonKey })
      );
      await onRefresh();
      const refreshedReport = await testSupabaseConnection(
        { url, anonKey },
        {
          ...(db as unknown as AdminDatabase),
          teachers: res.teachers as unknown as AdminDatabase['teachers'],
        }
      );
      setReport(refreshedReport);
      setStatusMessage({ text: res.message, ok: true });
      onNotify(res.message);
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Không thể lấy danh sách Giáo viên từ Supabase.';
      setStatusMessage({ text: errMsg, ok: false });
      onNotify(errMsg, true);
    } finally {
      setPullingTeachers(false);
    }
  }

  async function handlePullQuestionBank() {
    setPullingQb(true);
    saveSupabaseSettings({ url, anonKey });
    const pulled = await fetchQuestionBankFromSupabase({ url, anonKey });
    if (!pulled.ok) {
      setStatusMessage({ text: pulled.message, ok: false });
      onNotify(pulled.message, true);
      setPullingQb(false);
      return;
    }
    if (
      pulled.modules.length === 0 &&
      pulled.knowledgeCategories.length === 0 &&
      pulled.knowledgeParts.length === 0 &&
      pulled.questions.length === 0 &&
      pulled.questionSets.length === 0
    ) {
      const emptyMsg =
        'Không đọc được dữ liệu Ngân hàng Câu hỏi từ Supabase (0 dòng). Nếu bạn đã thêm dữ liệu trên Supabase, hãy chạy lại Lược đồ SQL bên phải để cấp quyền RLS cho Anon Key, hoặc bấm "Đồng bộ Dữ liệu lên Supabase".';
      setStatusMessage({ text: emptyMsg, ok: false });
      onNotify(emptyMsg, true);
      setPullingQb(false);
      return;
    }
    try {
      await api.importQuestionBankFromRemote({
        modules: pulled.modules,
        knowledgeCategories: pulled.knowledgeCategories,
        knowledgeParts: pulled.knowledgeParts,
        questions: pulled.questions,
        questionSets: pulled.questionSets,
      });
      setQuestionBankSupabaseEnabled(true);
      setLiveQbSync(true);
      await onRefresh();
      const refreshedReport = await testSupabaseConnection({ url, anonKey }, {
        ...(db as unknown as AdminDatabase),
        modules: pulled.modules,
        knowledgeCategories: pulled.knowledgeCategories,
        knowledgeParts: pulled.knowledgeParts,
        questions: pulled.questions,
        questionSets: pulled.questionSets,
      });
      setReport(refreshedReport);
      setStatusMessage({ text: pulled.message, ok: true });
      onNotify(pulled.message);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Không thể nạp dữ liệu Ngân hàng Câu hỏi.';
      setStatusMessage({ text: errMsg, ok: false });
      onNotify(errMsg, true);
    } finally {
      setPullingQb(false);
    }
  }

  async function handleFetchSample() {
    setSampling(true);
    saveSupabaseSettings({ url, anonKey });
    const res = await fetchSupabaseSampleQuestions({ url, anonKey });
    setSample(res);
    setStatusMessage({ text: res.message, ok: res.ok });
    onNotify(res.message, !res.ok);
    setSampling(false);
  }

  async function handleCopySql() {
    await navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
    setCopied(true);
    onNotify('Đã sao chép kịch bản PostgreSQL DDL vào bộ nhớ tạm.');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Credentials + Test Actions */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Kết nối Dự án Supabase
              </h2>
            </div>
            {(url || anonKey) && (
              <button
                type="button"
                disabled={isSupabaseBusy}
                onClick={handleClearConfig}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa</span>
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Dán <strong>Project URL</strong> và <strong>Anon / Public Key</strong> từ Supabase Dashboard (<em>Project Settings → API</em>) để kiểm tra bảng, kiểm tra cột phân cấp câu hỏi (<code className="font-mono">knowledge_parts</code>, <code className="font-mono">content_code</code>, <code className="font-mono">topic_order</code>) và đồng bộ dữ liệu mẫu.
          </p>

          <form onSubmit={handleSaveConfig} className="space-y-3">
            <div>
              <label htmlFor="sb-url" className="block text-xs font-medium mb-1">
                Supabase Project URL
              </label>
              <input
                id="sb-url"
                type="url"
                disabled={isSupabaseBusy}
                placeholder="https://xyzcompany.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor="sb-key" className="block text-xs font-medium mb-1">
                Supabase Anon / Public Key
              </label>
              <div className="relative">
                <input
                  id="sb-key"
                  type={showKey ? 'text' : 'password'}
                  disabled={isSupabaseBusy}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
                />
                <button
                  type="button"
                  aria-label={showKey ? 'Ẩn Anon Key' : 'Hiện Anon Key'}
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 text-xs cursor-pointer">
              <input
                type="checkbox"
                disabled={isSupabaseBusy}
                checked={liveQbSync}
                onChange={(e) => {
                  const next = e.target.checked;
                  setLiveQbSync(next);
                  saveSupabaseSettings({ url, anonKey });
                  setQuestionBankSupabaseEnabled(next);
                }}
                className="mt-0.5"
              />
              <span className="text-slate-700 dark:text-slate-300 leading-relaxed">
                <strong>Đồng bộ 2 chiều Ngân hàng Câu hỏi với Supabase:</strong> Tự động tải dữ liệu mới nhất khi mở ứng dụng và lưu mọi thay đổi Mô-đun/Nhóm/Phần/Câu hỏi/Bộ đề lên Supabase.
              </span>
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="submit"
                disabled={isSupabaseBusy}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Lưu cấu hình
              </button>
              <button
                type="button"
                disabled={isSupabaseBusy}
                onClick={handleTestConnection}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-700 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                <span>{testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối & Lược đồ'}</span>
              </button>
              <button
                type="button"
                disabled={isSupabaseBusy}
                onClick={handleSyncToSupabase}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {syncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <UploadCloud className="w-3.5 h-3.5" />
                )}
                <span>{syncing ? 'Đang đồng bộ...' : 'Đồng bộ Dữ liệu lên Supabase'}</span>
              </button>
              <button
                type="button"
                disabled={isSupabaseBusy}
                onClick={handlePullQuestionBank}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {pullingQb ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="w-3.5 h-3.5" />
                )}
                <span>{pullingQb ? 'Đang kéo về...' : 'Lấy Ngân hàng Câu hỏi từ Supabase'}</span>
              </button>
              <button
                type="button"
                disabled={isSupabaseBusy}
                onClick={handlePullTeachers}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {pullingTeachers ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="w-3.5 h-3.5" />
                )}
                <span>{pullingTeachers ? 'Đang kéo giáo viên...' : 'Lấy Giáo viên từ Supabase'}</span>
              </button>
              <button
                type="button"
                disabled={isSupabaseBusy}
                onClick={handleFetchSample}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {sampling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{sampling ? 'Đang truy vấn...' : 'Đọc thử 8 dòng'}</span>
              </button>
            </div>
          </form>

          {statusMessage && (
            <div
              role="status"
              className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                statusMessage.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300'
              }`}
            >
              {statusMessage.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Local DB Summary */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <div className="font-medium text-slate-700 dark:text-slate-300">
              Dữ liệu cục bộ sẵn sàng đồng bộ:
            </div>
            <div className="font-mono tabular-nums">
              {db.schools.length} trường · {db.classes.length} lớp · {db.students.length} học sinh ·{' '}
              {db.teachers.length} giáo viên · {db.modules?.length ?? 0} mô-đun ·{' '}
              {db.knowledgeCategories?.length ?? 0} nhóm · {db.knowledgeParts?.length ?? 0} phần ·{' '}
              {db.questions.length} câu hỏi · {db.questionSets.length} bộ đề
            </div>
          </div>
        </section>

        {/* Right Column: SQL Schema */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Lược đồ PostgreSQL Chuẩn (Supabase SQL Editor)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Bao gồm đầy đủ 17 bảng dùng chung cho Student App và Admin App (đã cập nhật <code className="font-mono">admin_teachers</code> kèm <code className="font-mono">password_hash</code> liên trường, <code className="font-mono">ic3_modules</code>, <code className="font-mono">knowledge_categories</code>, <code className="font-mono">knowledge_parts</code>, <code className="font-mono">content_code</code>, <code className="font-mono">topic_order</code>).
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopySql}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Đã sao chép</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Sao chép SQL</span>
                </>
              )}
            </button>
          </div>

          <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto max-h-[420px] overflow-y-auto leading-relaxed">
            <code>{SUPABASE_SCHEMA_SQL}</code>
          </pre>
        </section>
      </div>

      {/* Table-by-table Schema & Count Inspection Report */}
      {report && report.tableChecks.length > 0 && (
        <section
          aria-label="Kết quả kiểm tra chi tiết từng bảng Supabase"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Chi tiết Trạng thái Bảng & Dữ liệu trên Supabase
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {report.readyTables}/{report.tablesChecked} bảng sẵn sàng
                {report.latencyMs ? ` · Độ trễ: ${report.latencyMs}ms` : ''}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Tên bảng (PostgreSQL)</th>
                  <th className="py-2.5 px-4 font-semibold">Chức năng</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Cục bộ</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Trên Supabase</th>
                  <th className="py-2.5 px-4 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.tableChecks.map((row) => (
                  <tr key={row.table}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100">
                      public.{row.table}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                      {row.label}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {row.localCount ?? '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {row.remoteCount !== null ? row.remoteCount : '—'}
                    </td>
                    <td className="py-2.5 px-4">
                      {row.ok ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Sẵn sàng</span>
                        </span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">
                          {row.error || 'Chưa tạo bảng'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Remote Sample Query Preview */}
      {sample && (
        <section
          aria-label="Dữ liệu đọc thử từ Supabase"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Kết quả Đọc thử Trực tiếp từ Supabase
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{sample.message}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Bảng public.knowledge_parts ({sample.parts.length} dòng)
              </div>
              {sample.parts.length === 0 ? (
                <div className="text-xs text-slate-500">
                  Bảng chưa có dữ liệu. Hãy bấm "Đồng bộ Dữ liệu lên Supabase".
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {sample.parts.map((p) => (
                    <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {p.title}
                      </span>
                      <span className="font-mono text-blue-600 dark:text-blue-400 shrink-0">
                        {p.level} · {p.category} · {p.code}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Bảng public.questions ({sample.questions.length} dòng)
              </div>
              {sample.questions.length === 0 ? (
                <div className="text-xs text-slate-500">
                  Bảng chưa có dữ liệu. Hãy bấm "Đồng bộ Dữ liệu lên Supabase".
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {sample.questions.map((q) => (
                    <li key={q.id} className="py-2 space-y-0.5">
                      <div className="font-mono text-blue-600 dark:text-blue-400">
                        {q.level} · {q.category} · {q.content_code} · Câu {q.topic_order}
                      </div>
                      <div className="text-slate-800 dark:text-slate-200 truncate">
                        {q.prompt}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
