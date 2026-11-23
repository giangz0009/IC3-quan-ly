import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  CATEGORY_LABELS,
  MODULE_LABELS,
  QUESTION_TYPE_LABELS,
  type HotspotTarget,
  type HotspotType,
  type IC3Level,
  type IC3Module,
  type IC3ModuleRecord,
  type KnowledgeCategory,
  type KnowledgeCategoryRecord,
  type KnowledgePart,
  type MatchingItem,
  type MatchingPair,
  type Question,
  type QuestionOption,
  type QuestionPayload,
  type QuestionType,
  type TrueFalseStatement,
} from '../types/ic3';
import { api } from '../utils/api';
import {
  extractImageFileFromClipboardData,
  getDefaultInstructionForQuestionType,
  shouldUploadHotspotFileOnSave,
} from '../utils/ic3Rules';
import {
  isSupabaseConfigured,
  uploadHotspotImageToSupabase,
} from '../utils/supabaseClient';
import { HotspotCanvas } from './HotspotCanvas';

async function fileToCompressedDataUrl(file: File): Promise<string> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh đã chọn.'));
    reader.readAsDataURL(file);
  });

  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return rawUrl;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxWidth = 1400;
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const output = canvas.toDataURL('image/webp', 0.86);
      resolve(output && output.length < rawUrl.length ? output : rawUrl);
    };
    img.onerror = () => resolve(rawUrl);
    img.src = rawUrl;
  });
}

export interface QuestionDefaultContext {
  module: IC3Module;
  level: IC3Level;
  category: KnowledgeCategory;
  contentCode: string;
  topicOrder: number;
}

interface QuestionEditorModalProps {
  initialQuestion: Question | null;
  defaultContext?: QuestionDefaultContext;
  availableModules?: IC3ModuleRecord[];
  availableCategories?: KnowledgeCategoryRecord[];
  availableParts?: KnowledgePart[];
  serverSupabaseActive?: boolean;
  onClose: () => void;
  onSave: (payload: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>, existingId?: string) => Promise<void>;
}

export const QuestionEditorModal: React.FC<QuestionEditorModalProps> = ({
  initialQuestion,
  defaultContext,
  availableModules = [],
  availableCategories = [],
  availableParts = [],
  serverSupabaseActive = false,
  onClose,
  onSave,
}) => {
  const isContextLocked = !initialQuestion && Boolean(defaultContext);
  const [serverEnvReady, setServerEnvReady] = useState(serverSupabaseActive);

  useEffect(() => {
    if (serverSupabaseActive || isSupabaseConfigured()) {
      setServerEnvReady(true);
      return;
    }
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (!cancelled && h.supabaseConfigured) {
          setServerEnvReady(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverSupabaseActive]);

  const [module, setModule] = useState<IC3Module>(
    initialQuestion?.module ?? defaultContext?.module ?? 'computing_fundamentals'
  );
  const [level, setLevel] = useState<IC3Level>(
    initialQuestion?.level ?? defaultContext?.level ?? 'LV1'
  );
  const [category, setCategory] = useState<KnowledgeCategory>(
    initialQuestion?.category ?? defaultContext?.category ?? 'GM'
  );
  const [contentCode, setContentCode] = useState<string>(
    initialQuestion?.contentCode ?? defaultContext?.contentCode ?? 'GM1'
  );
  const [topicOrder, setTopicOrder] = useState<number>(
    initialQuestion?.topicOrder ?? defaultContext?.topicOrder ?? 1
  );
  const [type, setType] = useState<QuestionType>(initialQuestion?.type ?? 'single');
  const [prompt, setPrompt] = useState(initialQuestion?.prompt ?? '');
  const [explanation, setExplanation] = useState(initialQuestion?.explanation ?? '');
  const [tips, setTips] = useState(initialQuestion?.tips ?? '');

  // Type-specific states
  const initialPayload = initialQuestion?.payload;
  const [options, setOptions] = useState<QuestionOption[]>(
    initialPayload && 'options' in initialPayload
      ? initialPayload.options
      : [
          { id: 'opt_1', text: '' },
          { id: 'opt_2', text: '' },
          { id: 'opt_3', text: '' },
          { id: 'opt_4', text: '' },
        ]
  );
  const [correctOptionId, setCorrectOptionId] = useState<string>(
    initialPayload && 'correctOptionId' in initialPayload
      ? initialPayload.correctOptionId
      : 'opt_1'
  );
  const [correctOptionIds, setCorrectOptionIds] = useState<string[]>(
    initialPayload && 'correctOptionIds' in initialPayload
      ? initialPayload.correctOptionIds
      : ['opt_1']
  );

  const [statements, setStatements] = useState<TrueFalseStatement[]>(
    initialPayload && 'statements' in initialPayload
      ? initialPayload.statements
      : [
          { id: 'st_1', text: '', isTrue: true },
          { id: 'st_2', text: '', isTrue: false },
        ]
  );

  const [matchingLeft, setMatchingLeft] = useState<MatchingItem[]>(
    initialPayload && 'matchingLeft' in initialPayload
      ? initialPayload.matchingLeft
      : [
          { id: 'l1', text: '' },
          { id: 'l2', text: '' },
          { id: 'l3', text: '' },
        ]
  );
  const [matchingRight, setMatchingRight] = useState<MatchingItem[]>(
    initialPayload && 'matchingRight' in initialPayload
      ? initialPayload.matchingRight
      : [
          { id: 'r1', text: '' },
          { id: 'r2', text: '' },
          { id: 'r3', text: '' },
        ]
  );
  const [correctPairs, setCorrectPairs] = useState<MatchingPair[]>(
    initialPayload && 'correctPairs' in initialPayload
      ? initialPayload.correctPairs
      : [
          { leftId: 'l1', rightId: 'r1' },
          { leftId: 'l2', rightId: 'r2' },
          { leftId: 'l3', rightId: 'r3' },
        ]
  );

  const hotspotFileInputRef = useRef<HTMLInputElement | null>(null);
  const [hotspotType, setHotspotType] = useState<HotspotType | undefined>(
    initialPayload && 'hotspotType' in initialPayload
      ? initialPayload.hotspotType
      : undefined
  );
  const [savedHotspotImageUrl, setSavedHotspotImageUrl] = useState<string>(
    initialPayload && 'imageUrl' in initialPayload && initialPayload.imageUrl
      ? initialPayload.imageUrl
      : ''
  );
  const [pendingHotspotFile, setPendingHotspotFile] = useState<File | null>(null);
  const [pendingHotspotPreviewUrl, setPendingHotspotPreviewUrl] = useState<string>('');
  const displayedHotspotImageUrl = pendingHotspotPreviewUrl || savedHotspotImageUrl;

  useEffect(() => {
    return () => {
      if (pendingHotspotPreviewUrl && pendingHotspotPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pendingHotspotPreviewUrl);
      }
    };
  }, [pendingHotspotPreviewUrl]);

  const [hotspotTarget, setHotspotTarget] = useState<HotspotTarget>(
    initialPayload && 'hotspotTarget' in initialPayload
      ? initialPayload.hotspotTarget
      : {
          label: 'Điểm đáp án đúng',
          minX: 46,
          minY: 44,
          maxX: 54,
          maxY: 56,
        }
  );
  const [hasHotspotTarget, setHasHotspotTarget] = useState<boolean>(
    Boolean(initialPayload && 'hotspotTarget' in initialPayload)
  );
  const [imageAlt, setImageAlt] = useState(
    initialPayload && 'imageAlt' in initialPayload
      ? initialPayload.imageAlt
      : 'Ảnh câu hỏi chọn điểm trên hình'
  );
  const [uploadingHotspotImage, setUploadingHotspotImage] = useState(false);
  const [hotspotUploadNote, setHotspotUploadNote] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleHotspotFileSelected(
    file: File | undefined,
    source: 'upload' | 'paste' = 'upload'
  ) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Vui lòng chọn đúng định dạng tệp hình ảnh (PNG, JPG, WebP...).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Ảnh tải lên không được vượt quá 10 MB.');
      return;
    }

    setError(null);
    const previewUrl = URL.createObjectURL(file);
    const actionVerb = source === 'paste' ? 'dán ảnh' : 'chọn ảnh';
    setPendingHotspotFile(file);
    setPendingHotspotPreviewUrl(previewUrl);
    setHotspotType(undefined);
    setHasHotspotTarget(false);
    setHotspotUploadNote(
      isSupabaseConfigured() || serverEnvReady
        ? `Đã ${actionVerb} xem trước (chưa lưu vào Storage). Hãy nhấp vào điểm đúng trên hình rồi bấm "Lưu Câu hỏi" để tải lên Supabase.`
        : `Đã ${actionVerb} xem trước. Hãy nhấp vào điểm đúng trên hình rồi bấm "Lưu Câu hỏi".`
    );
    if (!imageAlt.trim() || imageAlt === 'Ảnh câu hỏi chọn điểm trên hình') {
      const cleanName = (file.name || '').replace(/\.[^.]+$/, '').trim();
      if (cleanName && cleanName.toLowerCase() !== 'image') {
        setImageAlt(cleanName);
      }
    }
    if (hotspotFileInputRef.current) {
      hotspotFileInputRef.current.value = '';
    }
  }

  const pasteHandlerRef = useRef<(file: File) => void>(() => {});
  pasteHandlerRef.current = (file: File) => {
    if (uploadingHotspotImage || saving) return;
    void handleHotspotFileSelected(file, 'paste');
  };

  useEffect(() => {
    if (type !== 'hotspot') return;
    const onWindowPaste = (e: ClipboardEvent) => {
      const imageFile = extractImageFileFromClipboardData(e.clipboardData);
      if (!imageFile) return;
      e.preventDefault();
      pasteHandlerRef.current(imageFile);
    };
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [type]);

  function buildPayload(): QuestionPayload | null {
    if (type === 'single') {
      const cleanOpts = options.filter((o) => o.text.trim());
      if (cleanOpts.length < 2) {
        setError('Cần nhập ít nhất 2 phương án trả lời.');
        return null;
      }
      const validCorrect = cleanOpts.some((o) => o.id === correctOptionId)
        ? correctOptionId
        : cleanOpts[0].id;
      return { options: cleanOpts, correctOptionId: validCorrect };
    }

    if (type === 'multiple') {
      const cleanOpts = options.filter((o) => o.text.trim());
      if (cleanOpts.length < 2) {
        setError('Cần nhập ít nhất 2 phương án trả lời.');
        return null;
      }
      const validIds = correctOptionIds.filter((id) =>
        cleanOpts.some((o) => o.id === id)
      );
      if (validIds.length === 0) {
        setError('Phải chọn ít nhất 1 đáp án đúng.');
        return null;
      }
      return { options: cleanOpts, correctOptionIds: validIds };
    }

    if (type === 'true_false') {
      const cleanStmts = statements.filter((s) => s.text.trim());
      if (cleanStmts.length === 0) {
        setError('Cần nhập ít nhất 1 ý phát biểu Đúng/Sai.');
        return null;
      }
      return { statements: cleanStmts };
    }

    if (type === 'matching') {
      const cleanL = matchingLeft.filter((l) => l.text.trim());
      const cleanR = matchingRight.filter((r) => r.text.trim());
      if (cleanL.length < 2 || cleanR.length < 2) {
        setError('Cần ít nhất 2 mục ở mỗi cột A và B.');
        return null;
      }
      const pairs = cleanL.map((l) => {
        const found = correctPairs.find((p) => p.leftId === l.id);
        return {
          leftId: l.id,
          rightId:
            found && cleanR.some((r) => r.id === found.rightId)
              ? found.rightId
              : cleanR[0].id,
        };
      });
      return {
        matchingLeft: cleanL,
        matchingRight: cleanR,
        correctPairs: pairs,
      };
    }

    if (!displayedHotspotImageUrl && !hotspotType) {
      setError('Vui lòng tải lên hình ảnh cho câu hỏi chọn điểm trên hình.');
      return null;
    }
    if (!hasHotspotTarget) {
      setError('Vui lòng nhấp chuột hoặc kéo khoanh vùng để chỉ ra điểm đúng trên hình.');
      return null;
    }
    return {
      ...(savedHotspotImageUrl && !pendingHotspotFile
        ? { imageUrl: savedHotspotImageUrl }
        : {}),
      ...(hotspotType && !displayedHotspotImageUrl ? { hotspotType } : {}),
      hotspotTarget,
      imageAlt: imageAlt.trim() || 'Ảnh câu hỏi chọn điểm trên hình',
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!prompt.trim()) {
      setError('Vui lòng nhập nội dung câu hỏi.');
      return;
    }
    const basePayload = buildPayload();
    if (!basePayload) return;

    const cleanCategory = category.trim().toUpperCase();
    const cleanContentCode = (contentCode.trim() || `${cleanCategory}1`).toUpperCase();
    const matchedPart = availableParts.find(
      (p) =>
        p.module === module &&
        p.category.trim().toUpperCase() === cleanCategory &&
        p.code.trim().toUpperCase() === cleanContentCode
    );
    const resolvedTopic =
      matchedPart?.title?.trim() ||
      initialQuestion?.topic?.trim() ||
      cleanContentCode ||
      'Tổng hợp';

    setSaving(true);
    try {
      let finalPayload: QuestionPayload = basePayload;
      if (type === 'hotspot' && pendingHotspotFile) {
        setUploadingHotspotImage(true);
        try {
          let resolvedImageUrl = '';
          const browserReady = isSupabaseConfigured();
          const canUploadStorage = shouldUploadHotspotFileOnSave({
            questionType: type,
            hasPendingFile: Boolean(pendingHotspotFile),
            supabaseConfigured: browserReady || serverEnvReady,
            promptValid: Boolean(prompt.trim()),
            hotspotImageReady: Boolean(displayedHotspotImageUrl || hotspotType),
            hotspotTargetReady: hasHotspotTarget,
          });
          if (canUploadStorage && browserReady) {
            const uploaded = await uploadHotspotImageToSupabase(pendingHotspotFile);
            if (uploaded.ok && uploaded.url) {
              resolvedImageUrl = uploaded.url;
            } else {
              resolvedImageUrl = await fileToCompressedDataUrl(pendingHotspotFile);
            }
          } else if (canUploadStorage && serverEnvReady) {
            const compressed = await fileToCompressedDataUrl(pendingHotspotFile);
            try {
              const uploaded = await api.uploadHotspotImage({
                base64DataUrl: compressed,
                fileName: pendingHotspotFile.name,
                mimeType: pendingHotspotFile.type || 'image/webp',
              });
              resolvedImageUrl = uploaded.ok && uploaded.url ? uploaded.url : compressed;
            } catch {
              resolvedImageUrl = compressed;
            }
          } else {
            resolvedImageUrl = await fileToCompressedDataUrl(pendingHotspotFile);
          }
          finalPayload = {
            ...basePayload,
            imageUrl: resolvedImageUrl,
          };
        } finally {
          setUploadingHotspotImage(false);
        }
      }

      await onSave(
        {
          module,
          level,
          category: cleanCategory,
          contentCode: cleanContentCode,
          topicOrder: Math.max(1, Math.round(Number(topicOrder) || 1)),
          topic: resolvedTopic,
          type,
          prompt: prompt.trim(),
          instruction: getDefaultInstructionForQuestionType(type),
          payload: finalPayload,
          explanation: explanation.trim(),
          tips: tips.trim() || undefined,
        },
        initialQuestion?.id
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu câu hỏi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="question-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3
            id="question-modal-title"
            className="font-display text-lg font-semibold text-slate-900 dark:text-white"
          >
            {initialQuestion ? 'Chỉnh sửa Câu hỏi IC3' : 'Soạn Câu hỏi IC3 mới'}
          </h3>
          <button
            type="button"
            aria-label="Đóng trình soạn câu hỏi"
            disabled={saving}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-5">
          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {/* Metadata grid */}
          {(() => {
            const moduleOptions: Array<{ code: string; level: string; title: string }> =
              availableModules.length > 0
                ? availableModules.map((m) => ({
                    code: m.code,
                    level: m.level,
                    title: m.title,
                  }))
                : Object.entries(MODULE_LABELS).map(([code, title]) => ({
                    code,
                    level:
                      code === 'computing_fundamentals'
                        ? 'LV1'
                        : code === 'key_applications'
                          ? 'LV2'
                          : 'LV3',
                    title,
                  }));

            const hasCurrentModule = moduleOptions.some((m) => m.code === module);
            if (!hasCurrentModule && module) {
              moduleOptions.push({ code: module, level, title: `${module} (${level})` });
            }

            const matchedCategories = availableCategories.filter(
              (c) => c.module === module
            );
            const categoryOptions: Array<{ code: string; title: string }> =
              matchedCategories.length > 0
                ? matchedCategories.map((c) => ({ code: c.code, title: c.title }))
                : Object.entries(CATEGORY_LABELS).map(([code, info]) => ({
                    code,
                    title: info.name,
                  }));

            if (
              category &&
              !categoryOptions.some(
                (c) => c.code.toUpperCase() === category.toUpperCase()
              )
            ) {
              categoryOptions.push({ code: category, title: `Nhóm ${category}` });
            }

            const matchingParts = availableParts.filter(
              (p) => p.module === module && p.category === category
            );
            const hasCurrentPart = matchingParts.some(
              (p) => p.code.toLowerCase() === contentCode.trim().toLowerCase()
            );

            return (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-5">
                    <label htmlFor="q-module" className="block text-xs font-medium mb-1">
                      Mô-đun IC3
                    </label>
                    <select
                      id="q-module"
                      disabled={isContextLocked}
                      value={module}
                      onChange={(e) => {
                        const m = e.target.value as IC3Module;
                        setModule(m);
                        const modObj = moduleOptions.find((x) => x.code === m);
                        if (modObj) {
                          setLevel(modObj.level);
                        } else if (m === 'computing_fundamentals') {
                          setLevel('LV1');
                        } else if (m === 'key_applications') {
                          setLevel('LV2');
                        } else if (m === 'living_online') {
                          setLevel('LV3');
                        }
                        const nextCats = availableCategories.filter((c) => c.module === m);
                        const nextCatCode =
                          nextCats.length > 0 &&
                          !nextCats.some(
                            (c) => c.code.toUpperCase() === category.toUpperCase()
                          )
                            ? nextCats[0].code
                            : category;
                        if (nextCatCode !== category) {
                          setCategory(nextCatCode);
                        }
                        const matching = availableParts.filter(
                          (p) => p.module === m && p.category === nextCatCode
                        );
                        if (matching.length > 0) {
                          if (!matching.some((p) => p.code === contentCode)) {
                            setContentCode(matching[0].code);
                          }
                        } else {
                          setContentCode(`${nextCatCode}1`);
                        }
                      }}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                      {moduleOptions.map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label htmlFor="q-category" className="block text-xs font-medium mb-1">
                      Nhóm kiến thức
                    </label>
                    <select
                      id="q-category"
                      disabled={isContextLocked}
                      value={category}
                      onChange={(e) => {
                        const nextCat = e.target.value as KnowledgeCategory;
                        setCategory(nextCat);
                        const matching = availableParts.filter(
                          (p) => p.module === module && p.category === nextCat
                        );
                        if (matching.length > 0) {
                          setContentCode(matching[0].code);
                        } else {
                          setContentCode(`${nextCat}1`);
                        }
                      }}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                      {categoryOptions.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-4">
                    <label htmlFor="q-content-code" className="block text-xs font-medium mb-1">
                      Phần kiến thức
                    </label>
                    {matchingParts.length > 0 ? (
                      <select
                        id="q-content-code"
                        disabled={isContextLocked}
                        value={contentCode}
                        onChange={(e) => setContentCode(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
                      >
                        {matchingParts.map((p) => (
                          <option key={p.id} value={p.code}>
                            {p.code} — {p.title}
                          </option>
                        ))}
                        {!hasCurrentPart && contentCode.trim() && (
                          <option value={contentCode}>{contentCode}</option>
                        )}
                      </select>
                    ) : (
                      <input
                        id="q-content-code"
                        type="text"
                        required
                        disabled={isContextLocked}
                        value={contentCode}
                        onChange={(e) => setContentCode(e.target.value)}
                        placeholder={`${category}1`}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-8">
                    <label htmlFor="q-type" className="block text-xs font-medium mb-1">
                      Dạng câu hỏi
                    </label>
                    <select
                      id="q-type"
                      value={type}
                      onChange={(e) => setType(e.target.value as QuestionType)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      {Object.entries(QUESTION_TYPE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    <label htmlFor="q-topic-order" className="block text-xs font-medium mb-1">
                      STT câu hỏi
                    </label>
                    <input
                      id="q-topic-order"
                      type="number"
                      min={1}
                      required
                      value={topicOrder}
                      onChange={(e) =>
                        setTopicOrder(Math.max(1, Number(e.target.value) || 1))
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          <div>
            <label htmlFor="q-prompt" className="block text-xs font-medium mb-1">
              Nội dung câu hỏi
            </label>
            <textarea
              id="q-prompt"
              rows={2}
              required
              placeholder="Nhập đề bài hiển thị cho học sinh..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          {/* Specialized Form by QuestionType */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
            {(type === 'single' || type === 'multiple') && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {type === 'single'
                      ? 'Các lựa chọn (chọn 1 đáp án đúng)'
                      : 'Các lựa chọn (tích tất cả đáp án đúng)'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setOptions([
                        ...options,
                        { id: `opt_${options.length + 1}_${Date.now()}`, text: '' },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm phương án
                  </button>
                </div>
                <div className="space-y-2">
                  {options.map((opt, idx) => {
                    const checked =
                      type === 'single'
                        ? correctOptionId === opt.id
                        : correctOptionIds.includes(opt.id);
                    return (
                      <div key={opt.id} className="flex items-center gap-2">
                        <input
                          type={type === 'single' ? 'radio' : 'checkbox'}
                          name="correct-option"
                          checked={checked}
                          aria-label={`Đánh dấu phương án ${idx + 1} là đúng`}
                          onChange={() => {
                            if (type === 'single') {
                              setCorrectOptionId(opt.id);
                            } else {
                              setCorrectOptionIds((prev) =>
                                prev.includes(opt.id)
                                  ? prev.filter((x) => x !== opt.id)
                                  : [...prev, opt.id]
                              );
                            }
                          }}
                        />
                        <input
                          type="text"
                          placeholder={`Phương án ${idx + 1}`}
                          value={opt.text}
                          onChange={(e) => {
                            const next = [...options];
                            next[idx] = { ...opt, text: e.target.value };
                            setOptions(next);
                          }}
                          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                        {options.length > 2 && (
                          <button
                            type="button"
                            aria-label={`Xóa phương án ${idx + 1}`}
                            onClick={() =>
                              setOptions(options.filter((_, i) => i !== idx))
                            }
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {type === 'true_false' && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Danh sách ý phát biểu Đúng / Sai (học sinh phải đúng toàn bộ)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setStatements([
                        ...statements,
                        { id: `st_${Date.now()}`, text: '', isTrue: true },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm ý
                  </button>
                </div>
                <div className="space-y-2">
                  {statements.map((st, idx) => (
                    <div key={st.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`Phát biểu ${idx + 1}`}
                        value={st.text}
                        onChange={(e) => {
                          const next = [...statements];
                          next[idx] = { ...st, text: e.target.value };
                          setStatements(next);
                        }}
                        className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...statements];
                          next[idx] = { ...st, isTrue: !st.isTrue };
                          setStatements(next);
                        }}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer w-20 ${
                          st.isTrue
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'border-red-600 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        }`}
                      >
                        {st.isTrue ? 'Đúng' : 'Sai'}
                      </button>
                      {statements.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Xóa ý ${idx + 1}`}
                          onClick={() =>
                            setStatements(statements.filter((_, i) => i !== idx))
                          }
                          className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {type === 'matching' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Cột A (1, 2, 3...) — Cột B (A, B, C...) & Ánh xạ cặp đúng
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const lid = `l_${Date.now()}`;
                      const rid = `r_${Date.now()}`;
                      setMatchingLeft([...matchingLeft, { id: lid, text: '' }]);
                      setMatchingRight([...matchingRight, { id: rid, text: '' }]);
                      setCorrectPairs([...correctPairs, { leftId: lid, rightId: rid }]);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm cặp
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-500">Cột A</div>
                    {matchingLeft.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="font-mono text-xs w-5 text-slate-500">
                          {idx + 1}.
                        </span>
                        <input
                          type="text"
                          value={item.text}
                          placeholder={`Mục trái ${idx + 1}`}
                          onChange={(e) => {
                            const next = [...matchingLeft];
                            next[idx] = { ...item, text: e.target.value };
                            setMatchingLeft(next);
                          }}
                          className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-500">Cột B</div>
                    {matchingRight.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="font-mono text-xs w-5 text-slate-500">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                        <input
                          type="text"
                          value={item.text}
                          placeholder={`Mục phải ${String.fromCharCode(65 + idx)}`}
                          onChange={(e) => {
                            const next = [...matchingRight];
                            next[idx] = { ...item, text: e.target.value };
                            setMatchingRight(next);
                          }}
                          className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Đáp án ghép cặp đúng:
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {matchingLeft.map((left, idx) => {
                      const pair = correctPairs.find((p) => p.leftId === left.id);
                      return (
                        <div key={left.id} className="flex items-center gap-1.5 text-xs">
                          <span className="font-mono font-semibold">
                            {idx + 1} →
                          </span>
                          <select
                            aria-label={`Đáp án ghép cho mục ${idx + 1}`}
                            value={pair?.rightId ?? matchingRight[0]?.id ?? ''}
                            onChange={(e) => {
                              const rid = e.target.value;
                              setCorrectPairs((prev) => {
                                const without = prev.filter(
                                  (p) => p.leftId !== left.id
                                );
                                return [...without, { leftId: left.id, rightId: rid }];
                              });
                            }}
                            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            {matchingRight.map((r, rIdx) => (
                              <option key={r.id} value={r.id}>
                                {String.fromCharCode(65 + rIdx)}. {r.text || '(Trống)'}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {type === 'hotspot' && (
              <div className="space-y-3">
                <input
                  ref={hotspotFileInputRef}
                  id="hs-image-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => handleHotspotFileSelected(e.target.files?.[0])}
                  className="sr-only"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Ảnh câu hỏi &amp; Chọn điểm đáp án đúng
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Tải ảnh PNG/JPG/WebP lên hoặc nhấn <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px]">Ctrl + V</kbd> để dán ảnh trực tiếp, rồi nhấp vào điểm đúng trên hình.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={uploadingHotspotImage || saving}
                      onClick={() => hotspotFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {uploadingHotspotImage ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {uploadingHotspotImage
                          ? 'Đang tải ảnh lên...'
                          : displayedHotspotImageUrl || hotspotType
                            ? 'Đổi ảnh khác'
                            : 'Tải ảnh lên'}
                      </span>
                    </button>
                    {displayedHotspotImageUrl && (
                      <button
                        type="button"
                        disabled={uploadingHotspotImage || saving}
                        onClick={() => {
                          setPendingHotspotFile(null);
                          setPendingHotspotPreviewUrl('');
                          setSavedHotspotImageUrl('');
                          setHotspotType(undefined);
                          setHasHotspotTarget(false);
                          setHotspotUploadNote(null);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Xóa ảnh</span>
                      </button>
                    )}
                  </div>
                </div>

                {hotspotUploadNote && (
                  <div className="p-2.5 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 text-xs text-blue-800 dark:text-blue-200">
                    {hotspotUploadNote}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="hs-label" className="block text-xs font-medium mb-1">
                      Nhãn điểm / vùng đáp án đúng
                    </label>
                    <input
                      id="hs-label"
                      type="text"
                      value={hotspotTarget.label}
                      onChange={(e) =>
                        setHotspotTarget({ ...hotspotTarget, label: e.target.value })
                      }
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="hs-alt" className="block text-xs font-medium mb-1">
                      Mô tả ảnh (Alt text)
                    </label>
                    <input
                      id="hs-alt"
                      type="text"
                      value={imageAlt}
                      onChange={(e) => setImageAlt(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>

                {displayedHotspotImageUrl || hotspotType ? (
                  <HotspotCanvas
                    imageUrl={displayedHotspotImageUrl || undefined}
                    imageAlt={imageAlt}
                    hotspotType={hotspotType}
                    target={hotspotTarget}
                    hasTarget={hasHotspotTarget}
                    editable
                    onChangeTarget={(next) => {
                      setHotspotTarget(next);
                      setHasHotspotTarget(true);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={uploadingHotspotImage || saving}
                    onClick={() => hotspotFileInputRef.current?.click()}
                    className="w-full py-10 px-4 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-500 dark:hover:border-blue-500 transition-colors flex flex-col items-center justify-center gap-2 text-center cursor-pointer disabled:opacity-50"
                  >
                    {uploadingHotspotImage ? (
                      <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                    ) : (
                      <ImagePlus className="w-8 h-8 text-slate-400" />
                    )}
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {uploadingHotspotImage
                        ? 'Đang xử lý ảnh...'
                        : 'Bấm để chọn ảnh hoặc nhấn Ctrl + V để dán ảnh trực tiếp'}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Hỗ trợ PNG, JPG, WebP, GIF (tối đa 10 MB)
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Explanation & Tips */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="q-explanation" className="block text-xs font-medium mb-1">
                Giải thích đáp án (lưu DB)
              </label>
              <textarea
                id="q-explanation"
                rows={2}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="q-tips" className="block text-xs font-medium mb-1">
                Mẹo ghi nhớ (tùy chọn)
              </label>
              <textarea
                id="q-tips"
                rows={2}
                value={tips}
                onChange={(e) => setTips(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving || uploadingHotspotImage}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {uploadingHotspotImage
                  ? 'Đang tải ảnh lên Storage...'
                  : saving
                    ? 'Đang lưu & đồng bộ...'
                    : 'Lưu Câu hỏi'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
